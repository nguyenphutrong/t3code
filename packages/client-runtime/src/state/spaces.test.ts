import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { ClientSettingsSchema, DEFAULT_SPACES_STATE } from "@t3tools/contracts/settings";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  assignProjectSpace,
  assignThreadSpace,
  createSpace,
  filterSpaceEntities,
  rememberSpaceThread,
  removeSpace,
  resolveProjectSpace,
  resolveThreadSpace,
  selectSpace,
  updateSpace,
} from "./spaces.ts";

const decodeClientSettings = Schema.decodeSync(ClientSettingsSchema);
const environmentId = EnvironmentId.make("local");
const remoteEnvironmentId = EnvironmentId.make("remote");
const projectId = ProjectId.make("project");
const threadId = ThreadId.make("thread");
const project = { environmentId, id: projectId };
const thread = { environmentId, id: threadId, projectId };
const projectRef = { environmentId, projectId };
const threadRef = { environmentId, threadId };
const state = {
  ...DEFAULT_SPACES_STATE,
  spaces: [
    { id: "work", name: "Work", theme: null },
    { id: "personal", name: "Personal", theme: "light" },
  ],
};

describe("Spaces membership", () => {
  it("defaults existing client settings to All Spaces", () => {
    expect(decodeClientSettings({}).spaces).toEqual(DEFAULT_SPACES_STATE);
  });

  it("inherits a project's membership dynamically", () => {
    const work = assignProjectSpace(state, projectRef, "work");
    expect(resolveProjectSpace(work, projectRef)).toBe("work");
    expect(resolveThreadSpace(work, thread)).toBe("work");
    expect(resolveThreadSpace(assignProjectSpace(work, projectRef, "personal"), thread)).toBe(
      "personal",
    );
  });

  it("keeps an explicit override or No Space until inheritance is restored", () => {
    const work = assignProjectSpace(state, projectRef, "work");
    const overridden = assignThreadSpace(work, threadRef, "personal");
    expect(resolveThreadSpace(overridden, thread)).toBe("personal");
    expect(resolveThreadSpace(assignThreadSpace(overridden, threadRef, null), thread)).toBeNull();
    expect(resolveThreadSpace(assignThreadSpace(overridden, threadRef, undefined), thread)).toBe(
      "work",
    );
  });

  it("keeps matching project and thread IDs in different environments independent", () => {
    const work = assignProjectSpace(state, projectRef, "work");
    const remote = { ...thread, environmentId: remoteEnvironmentId };
    const overridden = assignThreadSpace(
      work,
      { ...threadRef, environmentId: remoteEnvironmentId },
      "personal",
    );
    expect(resolveThreadSpace(overridden, thread)).toBe("work");
    expect(resolveThreadSpace(overridden, remote)).toBe("personal");
    expect(
      resolveProjectSpace(overridden, { ...projectRef, environmentId: remoteEnvironmentId }),
    ).toBeNull();
  });

  it("filters threads while retaining the parent project of a matching override", () => {
    const otherProject = { environmentId, id: ProjectId.make("other") };
    const otherThread = { ...thread, id: ThreadId.make("other"), projectId: otherProject.id };
    const assigned = assignThreadSpace(
      assignProjectSpace(state, projectRef, "work"),
      { environmentId, threadId: otherThread.id },
      "work",
    );
    expect(
      filterSpaceEntities(
        selectSpace(assigned, "work"),
        [project, otherProject],
        [thread, otherThread],
      ),
    ).toEqual({
      projects: [project, otherProject],
      threads: [thread, otherThread],
    });
    const excluded = assignThreadSpace(assigned, threadRef, "personal");
    expect(
      filterSpaceEntities(
        selectSpace(excluded, "work"),
        [project, otherProject],
        [thread, otherThread],
      ).threads,
    ).toEqual([otherThread]);
    expect(
      filterSpaceEntities(
        selectSpace(excluded, null),
        [project, otherProject],
        [thread, otherThread],
      ).threads,
    ).toEqual([thread, otherThread]);
  });

  it("deletes only Space configuration and prevents a removed override from reinheriting", () => {
    const assigned = assignThreadSpace(
      assignProjectSpace(state, projectRef, "personal"),
      threadRef,
      "work",
    );
    const remembered = rememberSpaceThread(selectSpace(assigned, "work"), threadRef);
    const removed = removeSpace(remembered, "work");
    expect(removed.spaces.map((space) => space.id)).toEqual(["personal"]);
    expect(removed.activeSpaceId).toBeNull();
    expect(removed.lastThreadBySpace.work).toBeUndefined();
    expect(resolveThreadSpace(removed, thread)).toBeNull();
    expect(resolveProjectSpace(removed, projectRef)).toBe("personal");
    expect(resolveProjectSpace(removeSpace(removed, "personal"), projectRef)).toBeNull();
  });

  it("creates, renames and themes Spaces and remembers a thread per selection", () => {
    const created = createSpace(DEFAULT_SPACES_STATE, { id: "work", name: " Work ", theme: null });
    const renamed = updateSpace(created, "work", { name: " Writing ", theme: "dark" });
    expect(renamed.spaces).toEqual([{ id: "work", name: "Writing", theme: "dark" }]);
    expect(
      rememberSpaceThread(selectSpace(renamed, "work"), threadRef).lastThreadBySpace.work,
    ).toEqual(threadRef);
    expect(
      rememberSpaceThread(selectSpace(renamed, null), threadRef).lastThreadBySpace.all,
    ).toEqual(threadRef);
    expect(selectSpace(renamed, "missing").activeSpaceId).toBeNull();
    expect(updateSpace(renamed, "work", { name: " " })).toEqual(renamed);
  });
});
