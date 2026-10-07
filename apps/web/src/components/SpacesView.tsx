import { useState, type CSSProperties } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { GripVerticalIcon, MoreHorizontalIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  assignProjectSpace,
  createSpace,
  resolveProjectSpace,
} from "@t3tools/client-runtime/state/spaces";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { Space } from "@t3tools/contracts/settings";
import { useClientSettings } from "../hooks/useSettings";
import { reportSpaceError, updateSpaces, useSelectSpace } from "../hooks/useSpaces";
import { useTheme } from "../hooks/useTheme";
import { useCustomThemes } from "../hooks/useCustomThemes";
import { useEnvironmentThemeDefinitions } from "../hooks/useEnvironmentTheme";
import { spacePreviewColors } from "./Spaces";
import { useProjects } from "../state/entities";
import { useEnvironments } from "../state/environments";
import { randomUUID } from "../lib/utils";
import { isElectron } from "../env";
import { ProjectFavicon } from "./ProjectFavicon";
import { WorkspacePageHeader } from "./WorkspacePageHeader";
import { SidebarInset } from "./ui/sidebar";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogClose, DialogFooter, DialogPopup, DialogTitle } from "./ui/dialog";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const columnKey = (spaceId: string | null) => `space:${spaceId ?? "unassigned"}`;
const projectKey = (project: EnvironmentProject) =>
  scopedProjectKey(scopeProjectRef(project.environmentId, project.id));

function SpaceProject({
  project,
  environmentLabel,
}: {
  project: EnvironmentProject;
  environmentLabel: string;
}) {
  const spaces = useClientSettings((settings) => settings.spaces);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: projectKey(project),
  });
  const move = (spaceId: string | null) => {
    void updateSpaces((state) =>
      assignProjectSpace(state, scopeProjectRef(project.environmentId, project.id), spaceId),
    ).catch(reportSpaceError);
  };
  return (
    <div
      ref={setNodeRef}
      data-space-project={projectKey(project)}
      className="group flex items-center gap-2 rounded-lg border border-transparent bg-foreground/4 px-2 py-2.5 hover:bg-foreground/8"
      style={{ opacity: isDragging ? 0.25 : 1 }}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Drag ${project.title}`}
        className="flex size-7 shrink-0 touch-none cursor-grab items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing"
      >
        <GripVerticalIcon aria-hidden className="size-3.5" />
      </button>
      <ProjectFavicon project={project} className="size-5 shrink-0" />
      <Tooltip>
        <TooltipTrigger render={<div className="min-w-0 flex-1" />}>
          <p className="truncate text-sm font-medium">{project.title}</p>
          <p className="truncate text-xs text-muted-foreground">{environmentLabel}</p>
        </TooltipTrigger>
        <TooltipPopup>{project.workspaceRoot}</TooltipPopup>
      </Tooltip>
      <Menu>
        <MenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label={`Move ${project.title} to Space`} />
          }
        >
          <MoreHorizontalIcon aria-hidden />
        </MenuTrigger>
        <MenuPopup>
          <MenuItem onClick={() => move(null)}>No Space</MenuItem>
          {spaces.spaces.map((space) => (
            <MenuItem key={space.id} onClick={() => move(space.id)}>
              {space.name}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </div>
  );
}

function SpaceColumn({
  space,
  projects,
  environmentLabels,
}: {
  space: Space | null;
  projects: ReadonlyArray<EnvironmentProject>;
  environmentLabels: ReadonlyMap<string, string>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnKey(space?.id ?? null) });
  const selectSpace = useSelectSpace();
  const { resolvedTheme } = useTheme();
  const name = space?.name ?? "No Space";
  const colors = spacePreviewColors(space?.theme ?? null, resolvedTheme);
  const style: CSSProperties | undefined = colors
    ? ({
        background: `linear-gradient(165deg, ${colors.sidebar}, ${colors.accentSurface})`,
        color: colors.text,
        "--color-foreground": colors.text,
        "--color-muted-foreground": colors.textMuted,
        "--color-border": colors.border,
        "--color-ring": colors.focus,
      } as CSSProperties)
    : undefined;
  return (
    <section
      ref={setNodeRef}
      data-space-column={space?.id ?? "unassigned"}
      aria-label={`Projects in ${name}`}
      className={`flex h-full w-72 shrink-0 flex-col rounded-2xl border bg-sidebar/60 p-4 ${isOver ? "border-ring ring-2 ring-ring/35" : "border-border/60"}`}
      style={style}
    >
      <header className="mb-5 flex items-center justify-between gap-2">
        <h2 className="min-w-0 truncate text-sm font-semibold">
          {space ? (
            <button
              type="button"
              onClick={() => void selectSpace(space.id).catch(reportSpaceError)}
              className="cursor-pointer rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              aria-label={`Open Space ${name}`}
            >
              {name}
            </button>
          ) : (
            name
          )}
        </h2>
        <span className="text-xs text-muted-foreground">{projects.length}</span>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-2">
        {projects.map((project) => (
          <SpaceProject
            key={projectKey(project)}
            project={project}
            environmentLabel={
              environmentLabels.get(project.environmentId) ?? "Disconnected environment"
            }
          />
        ))}
        {projects.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">Drop a project here</p>
        ) : null}
      </div>
      <p className="mt-4 border-t border-border/40 pt-3 text-xs text-muted-foreground">
        {space ? "Projects and their inherited threads" : "Projects outside a Space"}
      </p>
    </section>
  );
}

export function SpacesView() {
  const spaces = useClientSettings((settings) => settings.spaces);
  const projects = useProjects();
  const { environments } = useEnvironments();
  const navigate = useNavigate();
  useCustomThemes();
  useEnvironmentThemeDefinitions();
  const [dragged, setDragged] = useState<EnvironmentProject | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor));
  const environmentLabels = new Map(
    environments.map((environment) => [environment.environmentId, environment.label]),
  );
  const columns = [...spaces.spaces, null];
  const dragEnd = (event: DragEndEvent) => {
    setDragged(null);
    const project = projects.find((entry) => projectKey(entry) === event.active.id);
    const destination =
      event.over && columns.find((space) => columnKey(space?.id ?? null) === event.over?.id);
    if (!project || destination === undefined || !event.over) return;
    const spaceId = destination?.id ?? null;
    void updateSpaces((state) =>
      assignProjectSpace(state, scopeProjectRef(project.environmentId, project.id), spaceId),
    ).catch(reportSpaceError);
  };
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <WorkspacePageHeader electron={isElectron}>
        <h1 className="min-w-0 flex-1 text-sm font-medium">Spaces</h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void navigate({ to: "/settings/general", hash: "spaces" })}
        >
          <SettingsIcon aria-hidden />
          Manage
        </Button>
        <Button size="sm" onClick={() => setCreating(true)}>
          <PlusIcon aria-hidden />
          New Space
        </Button>
      </WorkspacePageHeader>
      <p className="shrink-0 px-6 pt-4 text-sm text-muted-foreground">
        Drag projects between Spaces to move their context.
      </p>
      <DndContext
        accessibility={{
          announcements: {
            onDragStart: ({ active }) =>
              `Picked up ${projects.find((project) => projectKey(project) === active.id)?.title ?? "project"}.`,
            onDragMove: () => undefined,
            onDragOver: ({ over }) =>
              over
                ? `Over ${columns.find((space) => columnKey(space?.id ?? null) === over.id)?.name ?? "No Space"}.`
                : "Outside a Space.",
            onDragEnd: ({ over }) =>
              over
                ? `Dropped in ${columns.find((space) => columnKey(space?.id ?? null) === over.id)?.name ?? "No Space"}.`
                : "Project move canceled.",
            onDragCancel: () => "Project move canceled.",
          },
        }}
        sensors={sensors}
        collisionDetection={(args) =>
          args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)
        }
        onDragStart={(event) =>
          setDragged(projects.find((entry) => projectKey(entry) === event.active.id) ?? null)
        }
        onDragEnd={dragEnd}
        onDragCancel={() => setDragged(null)}
      >
        <div className="flex min-h-0 flex-1 gap-5 overflow-x-auto p-6" aria-label="Space projects">
          {columns.map((space) => (
            <SpaceColumn
              key={columnKey(space?.id ?? null)}
              space={space}
              projects={projects.filter(
                (project) =>
                  resolveProjectSpace(
                    spaces,
                    scopeProjectRef(project.environmentId, project.id),
                  ) === (space?.id ?? null),
              )}
              environmentLabels={environmentLabels}
            />
          ))}
          <button
            type="button"
            onClick={() => setCreating(true)}
            aria-label="Create a Space"
            className="flex w-24 shrink-0 items-center justify-center self-stretch rounded-2xl border border-dashed border-border text-muted-foreground hover:bg-accent/40 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <PlusIcon aria-hidden className="size-6" />
          </button>
        </div>
        <DragOverlay dropAnimation={null}>
          {dragged ? (
            <div className="w-64 rounded-lg border border-ring bg-popover px-4 py-3 text-sm font-medium text-popover-foreground shadow-lg">
              {dragged.title}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogPopup>
          <DialogTitle>Create a Space</DialogTitle>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim() || saving) return;
              setSaving(true);
              const space = { id: randomUUID(), name: name.trim(), theme: null };
              void updateSpaces((state) => createSpace(state, space))
                .then(() => {
                  setName("");
                  setCreating(false);
                })
                .catch(reportSpaceError)
                .finally(() => setSaving(false));
            }}
          >
            <label htmlFor="new-space-name" className="mb-2 block text-sm">
              Name
            </label>
            <Input
              id="new-space-name"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="Work, writing, personal…"
              autoFocus
            />
            <DialogFooter>
              <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
              <Button type="submit" disabled={!name.trim() || saving}>
                {saving ? "Creating…" : "Create Space"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </SidebarInset>
  );
}
