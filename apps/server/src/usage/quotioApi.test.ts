import { describe, expect, it } from "@effect/vitest";
import { UsageLimitSourceSnapshot, UsageLimitSourceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http";

import { makeQuotioApi, quotioReportToAccounts } from "./quotioApi.ts";

const decodeSnapshot = Schema.decodeUnknownEffect(UsageLimitSourceSnapshot);
const encodeSnapshot = Schema.encodeEffect(Schema.fromJsonString(UsageLimitSourceSnapshot));
const now = Date.parse("2026-09-08T12:00:00Z");
const config = {
  kind: "quotio",
  url: "http://quotio.test:8317",
  managementKey: "test-bearer-secret",
  enabled: true,
} as const;
type Report = Parameters<typeof quotioReportToAccounts>[0];
type Window = Report["providers"][number]["windows"][number];
const window = (label = "Session", overrides: Partial<Window> = {}): Window => ({
  label,
  quota: { state: "available", used_percent: 25, remaining_percent: 75 },
  fetched_at: "2026-09-08T11:59:00Z",
  resets_at: "2026-09-08T15:00:00Z",
  provenance: { source: "codex_app_server", confidence: "exact" },
  ...overrides,
});
const report = (overrides: Partial<Report> = {}): Report => ({
  schema_version: 1,
  generated_at: "2026-09-08T12:00:00Z",
  providers: [
    {
      provider: "codex",
      account_ref: { id: "owned-a", label: "Personal" },
      account: { id: "not-an-email", label: "Account", plan: "pro" },
      windows: [window(), window("Weekly"), window("Review", { metric_id: "review" })],
    },
    {
      provider: "claude",
      account: { id: "token-fingerprint", label: "Work" },
      windows: [
        window("Opus weekly", {
          consumption: { used: 25, unit: "percent" },
          amounts: { remaining: 75, limit: 100, unit: "percent" },
          provenance: { source: "claude_oauth_usage", confidence: "exact" },
        }),
      ],
    },
  ],
  failures: [],
  ...overrides,
});

function fixture(body: unknown = report(), status = 200) {
  const requests: string[] = [];
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      expect(request.method).toBe("GET");
      expect(request.url).toBe("http://quotio.test:8317/v1/usage");
      expect(request.headers.authorization).toBe(`Bearer ${config.managementKey}`);
      requests.push(request.url);
      return HttpClientResponse.fromWeb(
        request,
        typeof body === "string" ? new Response(body, { status }) : Response.json(body, { status }),
      );
    }),
  );
  return {
    requests,
    api: makeQuotioApi.pipe(Effect.provideService(HttpClient.HttpClient, client)),
  };
}

describe("Quotio usage API", () => {
  it.effect(
    "reads v1 usage with Bearer auth, maps every subscription window and validates the published snapshot",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(now);
        const test = fixture();
        const result = yield* (yield* test.api).readAccounts(config);
        expect(test.requests).toHaveLength(1);
        expect(result.error).toBeUndefined();
        expect(
          result.accounts.map((account) => [
            account.id,
            account.driver,
            account.label,
            account.email,
            account.plan,
          ]),
        ).toEqual([
          ['["codex","owned-a"]', "codex", "Personal", undefined, "pro"],
          ['["claude","token-fingerprint"]', "claudeAgent", "Work", undefined, undefined],
        ]);
        expect(result.accounts.map((account) => account.usageLimits.windows.length)).toEqual([
          3, 1,
        ]);
        expect(result.accounts[0]?.usageLimits.checkedAt).toBe("2026-09-08T11:59:00.000Z");
        expect(result.accounts.every((account) => !account.usageLimits.resetCredits)).toBe(true);
        const snapshot = yield* decodeSnapshot({
          id: UsageLimitSourceId.make("quotio"),
          kind: "quotio",
          label: "Quotio",
          checkedAt: "2026-09-08T12:00:00.000Z",
          ...result,
        });
        expect(yield* encodeSnapshot(snapshot)).not.toContain(config.managementKey);
      }),
  );

  it("keeps account/window IDs stable across ordering, label edits with metric IDs, and account identity edits with account_ref", () => {
    const original = report();
    const changed = report({
      providers: original.providers
        .map((provider) => ({
          ...provider,
          account: { ...provider.account, ...(provider.account_ref ? { id: "changed" } : {}) },
          windows: provider.windows
            .toReversed()
            .map((window) => ({ ...window, ...(window.metric_id ? { label: "Renamed" } : {}) })),
        }))
        .toReversed(),
    });
    const ids = (value: Report) =>
      quotioReportToAccounts(value, now)
        .accounts.map((account) => [
          account.id,
          account.usageLimits.windows.map((window) => window.id).sort(),
        ])
        .sort();
    expect(ids(changed)).toEqual(ids(original));
  });

  it("does not invent percentages for categorical quotas or mix token/cost consumption into subscription quota", () => {
    const quotas: Window["quota"][] = [
      { state: "unknown" },
      { state: "unlimited" },
      { state: "disabled" },
      { state: "limit", amount: 10, unit: "USD" },
      { state: "exhausted", used_percent: 100, remaining_percent: 0 },
    ];
    const result = quotioReportToAccounts(
      report({
        providers: [
          {
            ...report().providers[0]!,
            windows: [
              ...quotas.map((quota) => window(quota.state, { quota })),
              window("Tokens", { consumption: { used: 1000, unit: "tokens" } }),
              window("Cost", { amounts: { remaining: 5, limit: 10, unit: "USD" } }),
            ],
          },
        ],
      }),
      now,
    );
    expect(result.accounts[0]?.usageLimits.windows).toMatchObject([
      { label: "exhausted", usedPercent: 100 },
    ]);
    for (const state of ["unknown", "unlimited", "disabled", "limit"])
      expect(result.error).toContain(`${state} (no subscription percentage)`);
  });

  it("excludes failed retained accounts but preserves successes and omits unsafe upstream failure messages", () => {
    const result = quotioReportToAccounts(
      report({
        failures: [
          {
            provider: "codex",
            account_ref: { id: "owned-a", label: "Personal" },
            code: "authentication",
            message: config.managementKey,
          },
        ],
      }),
      now,
    );
    expect(result.accounts[0]?.usageLimits.windows).toEqual([]);
    expect(result.accounts[0]?.usageLimits.unavailable?.reason).toBe("probeFailed");
    expect(result.accounts[1]?.usageLimits.windows).toHaveLength(1);
    expect(result.error).toContain("could not refresh");
    expect(JSON.stringify(result)).not.toContain(config.managementKey);
  });

  it("checks each fetched_at, not generated_at, including the TTL boundary and future timestamps", () => {
    const result = quotioReportToAccounts(
      report({
        providers: [
          {
            ...report().providers[0]!,
            windows: [
              window("Fresh"),
              window("Old", { fetched_at: "2026-09-08T11:55:00Z" }),
              window("Future", { fetched_at: "2026-09-08T12:01:00Z" }),
            ],
          },
        ],
      }),
      now,
    );
    expect(result.accounts[0]?.usageLimits.windows.map((window) => window.label)).toEqual([
      "Fresh",
    ]);
    expect(result.accounts[0]?.usageLimits.checkedAt).toBe("2026-09-08T11:55:00.000Z");
    expect(result.error).toContain("Old: Stale");
    expect(result.error).toContain("Future: Stale");
  });

  it("reports failures without snapshots, ignores other providers, and handles empty accounts", () => {
    expect(
      quotioReportToAccounts(
        report({
          providers: [],
          failures: [{ provider: "claude", code: "timeout", message: "timeout" }],
        }),
        now,
      ),
    ).toMatchObject({ accounts: [], error: "claude: Quotio could not refresh usage." });
    const result = quotioReportToAccounts(
      report({
        providers: [
          { ...report().providers[0]!, provider: "amp" },
          { ...report().providers[1]!, windows: [] },
        ],
      }),
      now,
    );
    expect(result.accounts).toHaveLength(1);
    expect(result.error).toContain("No fresh subscription percentage");
  });

  it.effect(
    "disables redirects in the production Fetch transport and sanitizes transport failures",
    () =>
      Effect.gen(function* () {
        const api = yield* makeQuotioApi;
        const error = yield* api.readAccounts(config).pipe(Effect.flip);
        expect(error.detail).toContain("Check connectivity");
        expect(error.detail).not.toContain(config.managementKey);
      }).pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.provideService(
          FetchHttpClient.Fetch,
          Object.assign(
            (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
              expect(init?.redirect).toBe("manual");
              return Promise.reject(new Error(config.managementKey));
            },
            { preconnect: () => undefined },
          ),
        ),
      ),
  );

  for (const status of [401, 503, 500, 302]) {
    it.effect(
      `handles HTTP ${status} without leaking the response body or following redirects`,
      () =>
        Effect.gen(function* () {
          const test = fixture({ error: config.managementKey }, status);
          const error = yield* (yield* test.api).readAccounts(config).pipe(Effect.flip);
          expect(error.detail).toContain(`HTTP ${status}`);
          expect(error.detail).not.toContain(config.managementKey);
          expect(test.requests).toHaveLength(1);
        }),
    );
  }

  for (const [label, body] of [
    ["malformed JSON", "{"],
    ["version", { ...report(), schema_version: 2 }],
    ["missing fields", { schema_version: 1 }],
    [
      "percentage",
      {
        ...report(),
        providers: [
          {
            ...report().providers[0],
            windows: [
              window("Bad", {
                quota: { state: "available", used_percent: 101, remaining_percent: 0 },
              }),
            ],
          },
        ],
      },
    ],
    [
      "timestamp",
      {
        ...report(),
        providers: [
          { ...report().providers[0], windows: [window("Bad", { fetched_at: "yesterday" })] },
        ],
      },
    ],
  ] as const) {
    it.effect(`rejects invalid ${label}`, () =>
      Effect.gen(function* () {
        const error = yield* (yield* fixture(body).api).readAccounts(config).pipe(Effect.flip);
        expect(error.detail).toContain("invalid usage JSON");
      }),
    );
  }
});
