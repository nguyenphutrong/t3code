import {
  ProviderDriverKind,
  TrimmedNonEmptyString,
  UsageLimitSourceError,
  type UsageLimitSourceAccount,
  type UsageLimitSourceConfig,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";

const Timestamp = Schema.String.check(
  Schema.makeFilter(
    (value) =>
      /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
      Number.isFinite(Date.parse(value)),
  ),
);
const Percent = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 }));
const Quota = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("available"),
    used_percent: Percent,
    remaining_percent: Percent,
  }),
  Schema.Struct({
    state: Schema.Literal("exhausted"),
    used_percent: Schema.Literal(100),
    remaining_percent: Schema.Literal(0),
  }),
  Schema.Struct({ state: Schema.Literals(["unknown", "unlimited", "disabled"]) }),
  Schema.Struct({ state: Schema.Literal("limit"), amount: Schema.Number, unit: Schema.String }),
]);
const AccountRef = Schema.Struct({ id: TrimmedNonEmptyString, label: TrimmedNonEmptyString });
const UsageReport = Schema.Struct({
  schema_version: Schema.Literal(1),
  generated_at: Timestamp,
  providers: Schema.Array(
    Schema.Struct({
      provider: TrimmedNonEmptyString,
      account_ref: Schema.optional(Schema.NullOr(AccountRef)),
      account: Schema.Struct({
        id: TrimmedNonEmptyString,
        label: TrimmedNonEmptyString,
        plan: Schema.optional(Schema.NullOr(Schema.String)),
      }),
      windows: Schema.Array(
        Schema.Struct({
          label: TrimmedNonEmptyString,
          metric_id: Schema.optional(TrimmedNonEmptyString),
          quota: Quota,
          fetched_at: Timestamp,
          resets_at: Schema.NullOr(Timestamp),
          consumption: Schema.optional(
            Schema.NullOr(Schema.Struct({ used: Schema.Number, unit: Schema.String })),
          ),
          amounts: Schema.optional(
            Schema.NullOr(
              Schema.Struct({
                remaining: Schema.Number,
                limit: Schema.NullOr(Schema.Number),
                unit: Schema.String,
              }),
            ),
          ),
          provenance: Schema.Struct({
            source: Schema.String,
            confidence: Schema.Literals(["exact", "estimated", "unknown"]),
          }),
        }),
      ),
    }),
  ),
  failures: Schema.Array(
    Schema.Struct({
      provider: TrimmedNonEmptyString,
      account_ref: Schema.optional(Schema.NullOr(AccountRef)),
      code: Schema.String,
      message: Schema.String,
    }),
  ),
});

// Quotio's default upstream cache TTL is five minutes. Never use generated_at
// as freshness: failed refreshes can retain windows indefinitely.
const MAX_WINDOW_AGE_MS = 5 * 60_000;

export function quotioReportToAccounts(report: typeof UsageReport.Type, now: number) {
  const notices: string[] = [];
  const accounts: UsageLimitSourceAccount[] = [];
  const supported = (provider: string) => provider === "codex" || provider === "claude";
  for (const failure of report.failures.filter((failure) => supported(failure.provider))) {
    // Upstream error text is untrusted and can contain credentials. Do not publish it.
    notices.push(
      `${failure.provider}${failure.account_ref ? ` · ${failure.account_ref.label}` : ""}: Quotio could not refresh usage.`,
    );
  }
  for (const provider of report.providers.filter((provider) => supported(provider.provider))) {
    const label = provider.account_ref?.label ?? provider.account.label;
    const failed = report.failures.some(
      (failure) =>
        failure.provider === provider.provider &&
        (!failure.account_ref ||
          failure.account_ref.id === (provider.account_ref?.id ?? provider.account.id)),
    );
    const windows: UsageLimitSourceAccount["usageLimits"]["windows"][number][] = [];
    const fetched: number[] = [];
    const ids = new Set<string>();
    for (const window of provider.windows) {
      fetched.push(Date.parse(window.fetched_at));
      const subject = `${label} · ${window.label}`;
      if (failed) continue;
      const age = now - Date.parse(window.fetched_at);
      if (age < 0 || age >= MAX_WINDOW_AGE_MS) {
        notices.push(
          `${subject}: Stale or future-dated usage (fetched ${window.fetched_at}); excluded from quota totals.`,
        );
        continue;
      }
      // Claude supplies amounts/consumption in "percent" alongside quota;
      // token/currency quantities are not subscription windows.
      if (
        (window.consumption && window.consumption.unit !== "percent") ||
        (window.amounts && window.amounts.unit !== "percent")
      )
        continue;
      if (window.quota.state !== "available" && window.quota.state !== "exhausted") {
        notices.push(`${subject}: ${window.quota.state} (no subscription percentage).`);
        continue;
      }
      // Schema v1 Codex/Claude windows may omit metric_id. Labels are the only
      // stable fallback; array position and reset timestamps change on refresh.
      const id = `quotio:${window.metric_id ? `metric:${window.metric_id}` : `label:${window.label}`}`;
      if (ids.has(id)) {
        notices.push(`${subject}: Duplicate quota window omitted.`);
        continue;
      }
      ids.add(id);
      windows.push({
        id,
        kind: "other",
        label: window.label,
        usedPercent: window.quota.used_percent,
        ...(window.resets_at ? { resetsAt: window.resets_at } : {}),
      });
      if (window.provenance.confidence !== "exact") {
        notices.push(`${subject}: ${window.provenance.confidence} confidence.`);
      }
    }
    if (windows.length === 0 && !failed)
      notices.push(`${label}: No fresh subscription percentage windows reported.`);
    accounts.push({
      id: JSON.stringify([provider.provider, provider.account_ref?.id ?? provider.account.id]),
      driver: ProviderDriverKind.make(provider.provider === "codex" ? "codex" : "claudeAgent"),
      label,
      ...(provider.account.plan?.trim() ? { plan: provider.account.plan.trim() } : {}),
      usageLimits: {
        checkedAt: DateTime.formatIso(
          DateTime.makeUnsafe(fetched.length ? Math.min(...fetched) : now),
        ),
        windows,
        ...(failed
          ? {
              unavailable: {
                reason: "probeFailed" as const,
                message: "Quotio could not refresh this account; retained quota is excluded.",
              },
            }
          : {}),
      },
    });
  }
  return { accounts, ...(notices.length ? { error: [...new Set(notices)].join(" ") } : {}) };
}

export const makeQuotioApi = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const readAccounts = Effect.fn("QuotioApi.readAccounts")(function* (
    config: UsageLimitSourceConfig,
  ) {
    const url = yield* Effect.try({
      try: () => {
        const base = new URL(config.url);
        if (
          !["http:", "https:"].includes(base.protocol) ||
          base.username ||
          base.password ||
          base.search ||
          base.hash
        )
          throw new Error("Invalid URL");
        return new URL("/v1/usage", base).toString();
      },
      catch: () =>
        new UsageLimitSourceError({
          detail: "Enter a Quotio HTTP(S) URL without credentials, query or fragment.",
        }),
    });
    const response = yield* client
      .execute(
        HttpClientRequest.get(url).pipe(
          HttpClientRequest.setHeader("Authorization", `Bearer ${config.managementKey}`),
        ),
      )
      .pipe(
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
        Effect.timeout("15 seconds"),
        Effect.mapError(
          () =>
            new UsageLimitSourceError({
              detail: "The Quotio request failed. Check connectivity from the T3 server.",
            }),
        ),
      );
    if (response.status !== 200) {
      return yield* new UsageLimitSourceError({
        detail:
          response.status === 401
            ? "Quotio rejected the Bearer token (HTTP 401)."
            : response.status === 503
              ? "Quotio is not ready or is busy (HTTP 503). T3 will retry on the next poll."
              : `The Quotio request failed (HTTP ${response.status}).`,
      });
    }
    const report = yield* response.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(UsageReport)),
      Effect.timeout("15 seconds"),
      Effect.mapError(
        () =>
          new UsageLimitSourceError({
            detail:
              "Quotio returned invalid usage JSON or an unsupported schema version (expected 1).",
          }),
      ),
    );
    return quotioReportToAccounts(report, DateTime.toEpochMillis(yield* DateTime.now));
  });
  return { readAccounts };
});
