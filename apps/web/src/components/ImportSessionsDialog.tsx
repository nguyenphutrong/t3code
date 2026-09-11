import { CommandId, parseCodexSessionLink, type EnvironmentId } from "@t3tools/contracts";
import { useRef, useState } from "react";

import { newProjectId } from "../lib/utils";
import { resolveOnboardingProjectId } from "../onboarding/projectImport.logic";
import { agentSessionImport, agentSessionScan } from "../state/agentSessions";
import { readProjects } from "../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { projectEnvironment } from "../state/projects";
import { useAtomCommand } from "../state/use-atom-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import { Button } from "./ui/button";
import { Dialog, DialogPopup, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { toastManager } from "./ui/toast";

export function ImportSessionsDialog({ onClose }: { readonly onClose: () => void }) {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(
    primaryEnvironmentId ?? environments[0]?.environmentId ?? null,
  );
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const pending = useRef(false);
  const scan = useAtomQueryRunner(agentSessionScan, { reportFailure: false, refresh: true });
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const importSession = useAtomCommand(agentSessionImport, { reportFailure: false });

  const submit = async () => {
    if (pending.current) return;
    const codexSessionId = parseCodexSessionLink(link);
    if (codexSessionId === null) {
      setError("Enter a Codex session link: codex://threads/<session-id>.");
      return;
    }
    if (environmentId === null) {
      setError("Connect the computer that holds this Codex session first.");
      return;
    }
    pending.current = true;
    setIsImporting(true);
    setError("");
    try {
      const scanned = await scan({ environmentId, input: { codexSessionId } });
      if (scanned._tag !== "Success") {
        setError("Could not look up the session. Check the computer's connection and try again.");
        return;
      }
      const candidates = scanned.value.candidates;
      if (candidates.length !== 1) {
        setError(
          candidates.length === 0
            ? "Session not found. Check that this computer has the Codex transcript and its project folder still exists."
            : "This session was found in multiple project folders. Check the Codex homes configured on this computer.",
        );
        return;
      }
      const candidate = candidates[0]!;
      let projectId = resolveOnboardingProjectId(readProjects(), environmentId, candidate);
      if (projectId === null) {
        projectId = newProjectId();
        const created = await createProject({
          environmentId,
          input: {
            projectId,
            commandId: CommandId.make(`session-import:project:create:${projectId}`),
            title: candidate.title,
            workspaceRoot: candidate.path,
            createWorkspaceRootIfMissing: false,
            defaultModelSelection: null,
          },
        });
        if (created._tag !== "Success") {
          setError("Could not create the project. Try importing again.");
          return;
        }
      }
      const imported = await importSession({
        environmentId,
        input: { projectId, expectedWorkspaceRoot: candidate.path, codexSessionId },
      });
      if (
        imported._tag !== "Success" ||
        imported.value.importedCount === 0 ||
        imported.value.skippedCount > 0
      ) {
        setError(
          "Could not import the session history. The transcript may be missing, unreadable, or too large.",
        );
        return;
      }
      toastManager.add({
        type: "success",
        title: "Session imported",
        description: candidate.title,
      });
      onClose();
    } catch {
      setError("Import failed. Check the computer's connection and try again.");
    } finally {
      pending.current = false;
      setIsImporting(false);
    }
  };

  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open, event) => {
        if (pending.current) event.cancel();
        else if (!open) onClose();
      }}
    >
      <DialogPopup className="p-6" showCloseButton={!isImporting}>
        <DialogTitle>Import sessions</DialogTitle>
        <p className="mt-2 text-sm text-muted-foreground">
          Paste a Codex session link. Its history must be on the selected computer. The project is
          created automatically if needed.
        </p>
        <form
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {environments.length > 1 ? (
            <Select value={environmentId} onValueChange={setEnvironmentId} disabled={isImporting}>
              <SelectTrigger aria-label="Computer">
                <SelectValue>
                  {environments.find((entry) => entry.environmentId === environmentId)?.label ??
                    "Choose a computer"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {environments.map((entry) => (
                  <SelectItem key={entry.environmentId} value={entry.environmentId}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : null}
          <label className="block space-y-2 text-sm">
            <span>Session link</span>
            <Input
              autoFocus
              value={link}
              onChange={(event) => setLink(event.target.value)}
              disabled={isImporting}
              placeholder="codex://threads/019f9271-04da-7151-b23e-523c535a0a16"
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={isImporting} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isImporting || !link.trim()}>
              {isImporting ? "Importing…" : "Import session"}
            </Button>
          </div>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
