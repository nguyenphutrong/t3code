import {
  type EnvironmentId,
  type UsageLimitSourceConfig,
  UsageLimitSourceId,
} from "@t3tools/contracts";
import { useState } from "react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

const sourceKinds = [
  { value: "cliproxy", label: "CLIProxyAPI" },
  { value: "quotio", label: "Quotio" },
];

/**
 * Stable per hub and readable in settings.json. Dots and dashes in the host
 * are kept so `foo-bar.com` and `foo.bar.com` do not collide; anything else
 * (a port's colon, a path) is folded to a dash.
 */
function sourceIdFromUrl(url: string, kind: UsageLimitSourceConfig["kind"]): UsageLimitSourceId {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    // Keep the raw text; the server reports the bad URL on its row.
  }
  const slug = host
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return UsageLimitSourceId.make(`${kind}-${slug || "hub"}`);
}

/**
 * Adds a usage source from provider settings on one environment. The
 * Bearer secret is sent once and kept in that server's secret store;
 * settings only ever carry a redaction marker for it afterwards.
 */
export function AddUsageLimitSourceDialog({
  open,
  onOpenChange,
  environmentId,
  environmentLabel,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const [kind, setKind] = useState<UsageLimitSourceConfig["kind"]>("cliproxy");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [managementKey, setManagementKey] = useState("");
  const trimmedUrl = url.trim();
  const canSave = trimmedUrl.length > 0 && managementKey.trim().length > 0;

  const reset = () => {
    setKind("cliproxy");
    setLabel("");
    setUrl("");
    setManagementKey("");
  };

  const save = () => {
    if (!canSave) return;
    const id = sourceIdFromUrl(trimmedUrl, kind);
    // The patch names only this entry; the server merges it into its map.
    updateSettings({
      usageLimitSources: {
        [id]: {
          kind,
          ...(label.trim() ? { label: label.trim() } : {}),
          url: trimmedUrl,
          managementKey: managementKey.trim(),
          enabled: true,
        },
      },
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a usage provider</DialogTitle>
          <DialogDescription>
            Show subscription quota by account, next to the providers on {environmentLabel}. The key
            stays on that server.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-kind">Source type</Label>
              <Select
                items={sourceKinds}
                value={kind}
                onValueChange={(value) => {
                  if (value === "cliproxy" || value === "quotio") setKind(value);
                }}
              >
                <SelectTrigger id="usage-source-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {sourceKinds.map((source) => (
                    <SelectItem key={source.value} value={source.value}>
                      {source.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-url">
                {kind === "quotio" ? "Quotio URL" : "Hub URL"}
              </Label>
              <Input
                id="usage-source-url"
                placeholder={
                  kind === "quotio" ? "http://127.0.0.1:8317" : "https://hub.example.ts.net:8318"
                }
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                autoFocus
              />
            </div>
            {kind === "quotio" ? (
              <p className="text-xs text-muted-foreground">
                Run Quotio serve with QUOTIO_SERVER_TOKEN. Read-only access is enough; no --manage
                is needed. The URL is reached from {environmentLabel}'s T3 server, not your browser.
                Quotio binds to loopback by default: use this URL only on the same machine, or a
                secured forwarding endpoint reachable by that server.
              </p>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-key">
                {kind === "quotio" ? "Bearer token" : "Management key"}
              </Label>
              <Input
                id="usage-source-key"
                type="password"
                autoComplete="off"
                value={managementKey}
                onChange={(event) => setManagementKey(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-label">Label (optional)</Label>
              <Input
                id="usage-source-label"
                placeholder="Defaults to the source's host name"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            Add source
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
