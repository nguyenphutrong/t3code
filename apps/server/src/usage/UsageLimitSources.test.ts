import { expect, it } from "@effect/vitest";
import { UsageLimitSourceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { BackgroundPolicy } from "../background/BackgroundPolicy.ts";
import { layerTest, ServerSettingsService } from "../serverSettings.ts";
import { make } from "./UsageLimitSources.ts";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

it.effect(
  "polls both source kinds, publishes failures, rejects Quotio reset credits and removes disabled/deleted sources",
  () => {
    const quotioId = UsageLimitSourceId.make("quotio-local");
    const hubId = UsageLimitSourceId.make("cliproxy-local");
    const requests: string[] = [];
    const http = HttpClient.make((request) =>
      Effect.sync(() => {
        const path = new URL(request.url).pathname;
        requests.push(path);
        expect(request.headers.authorization).toBe("Bearer secret");
        return HttpClientResponse.fromWeb(
          request,
          Response.json(
            path === "/v1/usage"
              ? {
                  schema_version: 1,
                  generated_at: "2026-09-08T12:00:00Z",
                  providers: [],
                  failures: [{ provider: "codex", code: "timeout", message: "secret" }],
                }
              : { files: [] },
          ),
        );
      }),
    );
    const unused = Effect.die("Unexpected background policy call");
    return Effect.gen(function* () {
      const sources = yield* make;
      const settings = yield* ServerSettingsService;
      yield* sources.refresh;
      const snapshots = yield* sources.current;
      expect(snapshots.map((source) => source.kind).sort()).toEqual(["cliproxy", "quotio"]);
      expect(snapshots.find((source) => source.kind === "quotio")?.error).toContain(
        "could not refresh",
      );
      expect(yield* encodeJson(snapshots)).not.toContain("secret");
      expect(requests).toContain("/v1/usage");
      expect(requests).toContain("/v0/management/auth-files");
      const error = yield* sources
        .consumeResetCredit({ sourceId: quotioId, accountId: "account", creditId: "credit" })
        .pipe(Effect.flip);
      expect(error.detail).toContain("does not support reset credits");
      expect(
        requests.every((path) => path === "/v1/usage" || path === "/v0/management/auth-files"),
      ).toBe(true);
      const current = yield* settings.getSettings;
      yield* settings.updateSettings({
        usageLimitSources: {
          [quotioId]: { ...current.usageLimitSources[quotioId]!, enabled: false },
          [hubId]: null,
        },
      });
      yield* sources.refresh;
      expect(yield* sources.current).toEqual([]);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerTest({
          usageLimitSources: {
            [quotioId]: {
              kind: "quotio",
              url: "http://quotio.test:8317",
              managementKey: "secret",
              enabled: true,
            },
            [hubId]: {
              kind: "cliproxy",
              url: "http://hub.test:8318",
              managementKey: "secret",
              enabled: true,
            },
          },
        }),
      ),
      Effect.provideService(HttpClient.HttpClient, http),
      Effect.provideService(BackgroundPolicy, {
        reportClientActivity: () => unused,
        removeRpcClient: () => unused,
        reportHostPowerState: () => unused,
        snapshot: unused,
        streamChanges: Stream.empty,
        subscribe: unused,
        hasDemand: () => unused,
        shouldRunScopeWork: () => Effect.succeed(true),
        shouldRunOpportunisticWork: unused,
      }),
    );
  },
);
