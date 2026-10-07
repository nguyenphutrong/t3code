import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { SPACE_JUMP_KEYBINDING_COMMANDS } from "@t3tools/contracts";
import { primaryServerKeybindingsAtom } from "../state/server";
import { shortcutLabelForCommand } from "../keybindings";
import { getThemeDefinition, getThemeColorsForMode, getStandardThemeColors } from "../themePalette";
import { useTheme } from "../hooks/useTheme";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { useSidebar } from "./ui/sidebar";
import { LayoutGridIcon, PanelsTopLeftIcon, PlusIcon } from "lucide-react";
import type { ScopedProjectRef } from "@t3tools/contracts";
import {
  assignProjectSpace,
  createSpace,
  removeSpace,
  resolveProjectSpace,
  updateSpace,
} from "@t3tools/client-runtime/state/spaces";
import { useClientSettings } from "../hooks/useSettings";
import { reportSpaceError, updateSpaces, useSelectSpace } from "../hooks/useSpaces";
import { BUILT_IN_THEMES } from "@t3tools/shared/themePalettes";
import { randomUUID } from "../lib/utils";
import { useEnvironmentThemeDefinitions } from "../hooks/useEnvironmentTheme";
import { useCustomThemes } from "../hooks/useCustomThemes";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { SettingsRow, SettingsSection } from "./settings/settingsLayout";

export function spacePreviewColors(theme: string | null, appearance: "light" | "dark") {
  if (!theme) return null;
  if (theme === "light" || theme === "dark") return getStandardThemeColors(theme);
  if (theme === "system") return getStandardThemeColors(appearance);
  const definition = getThemeDefinition(theme);
  return definition ? (getThemeColorsForMode(definition, appearance) ?? definition.colors) : null;
}

export function SpaceDots() {
  const spaces = useClientSettings((settings) => settings.spaces);
  const selectedDot = useRef<HTMLButtonElement | null>(null);
  const selectSpace = useSelectSpace();
  const navigate = useNavigate();
  const overviewOpen = useLocation({ select: (location) => location.pathname === "/spaces" });
  useEffect(() => {
    selectedDot.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [spaces.activeSpaceId, overviewOpen]);
  const { isMobile, setOpenMobile } = useSidebar();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { resolvedTheme } = useTheme();
  useCustomThemes();
  useEnvironmentThemeDefinitions();
  const switchSpace = (id: string | null) => {
    if (isMobile) setOpenMobile(false);
    void selectSpace(id).catch(reportSpaceError);
  };
  return (
    <nav
      aria-label="Spaces"
      className="flex shrink-0 items-center gap-1 border-t border-sidebar-border/50 px-2 py-1.5"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="All Spaces"
              aria-pressed={spaces.activeSpaceId === null}
              onClick={() => switchSpace(null)}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-sidebar-row-active aria-pressed:text-sidebar-foreground"
            />
          }
        >
          <LayoutGridIcon aria-hidden className="size-4" />
        </TooltipTrigger>
        <TooltipPopup side="top">All Spaces</TooltipPopup>
      </Tooltip>
      <div className="flex min-w-0 flex-1 overflow-x-auto px-1">
        <div className="flex w-max min-w-full shrink-0 items-center justify-center gap-1">
          {spaces.spaces.map((space, index) => {
            const colors = spacePreviewColors(space.theme, resolvedTheme);
            const shortcut = SPACE_JUMP_KEYBINDING_COMMANDS[index];
            const label = shortcut ? shortcutLabelForCommand(keybindings, shortcut) : undefined;
            return (
              <Tooltip key={space.id}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={`Switch to ${space.name}`}
                      ref={spaces.activeSpaceId === space.id ? selectedDot : undefined}
                      aria-pressed={spaces.activeSpaceId === space.id}
                      onClick={() => switchSpace(space.id)}
                      className="group flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-sidebar-row-hover focus-visible:outline-2 focus-visible:outline-ring"
                    />
                  }
                >
                  <span
                    aria-hidden
                    className="size-2.5 rounded-full bg-sidebar-muted-foreground/40 group-aria-pressed:size-3 group-aria-pressed:ring-2 group-aria-pressed:ring-sidebar-foreground/30 group-aria-pressed:ring-offset-2 group-aria-pressed:ring-offset-sidebar"
                    style={colors ? { backgroundColor: colors.accent } : undefined}
                  />
                </TooltipTrigger>
                <TooltipPopup side="top">
                  {space.name}
                  {label ? ` · ${label}` : ""}
                </TooltipPopup>
              </Tooltip>
            );
          })}
        </div>
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Spaces view"
              aria-pressed={overviewOpen}
              onClick={() => {
                if (isMobile) setOpenMobile(false);
                void navigate({ to: "/spaces" });
              }}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-sidebar-row-active"
            />
          }
        >
          <PanelsTopLeftIcon aria-hidden className="size-4" />
        </TooltipTrigger>
        <TooltipPopup side="top">Spaces view</TooltipPopup>
      </Tooltip>
    </nav>
  );
}

export function SpaceAssignment({ projectRef }: { projectRef: ScopedProjectRef }) {
  const spaces = useClientSettings((settings) => settings.spaces);
  const spaceId = resolveProjectSpace(spaces, projectRef);
  return (
    <Select
      value={spaceId ?? "none"}
      onValueChange={(next) => {
        if (next !== null)
          void updateSpaces((state) =>
            assignProjectSpace(state, projectRef, next === "none" ? null : next),
          ).catch(reportSpaceError);
      }}
    >
      <SelectTrigger size="sm" aria-label="Project Space">
        <SelectValue>
          {spaces.spaces.find((space) => space.id === spaceId)?.name ?? "No Space"}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup>
        <SelectItem value="none">No Space</SelectItem>
        {spaces.spaces.map((space) => (
          <SelectItem key={space.id} value={space.id}>
            {space.name}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export function SpacesSettings() {
  const spaces = useClientSettings((settings) => settings.spaces);
  const [name, setName] = useState("");
  const customThemes = useCustomThemes();
  const environmentThemes = useEnvironmentThemeDefinitions();
  const themes = [
    ...new Map(
      [...BUILT_IN_THEMES, ...customThemes, ...environmentThemes].map((theme) => [theme.id, theme]),
    ).values(),
  ];
  return (
    <SettingsSection id="spaces" title="Spaces">
      <p className="px-3 py-2 text-sm text-muted-foreground sm:px-4">
        Organize projects and threads into Spaces. Saved on this device.
      </p>
      {spaces.spaces.map((space) => (
        <SettingsRow
          key={space.id}
          title={space.name}
          control={
            <div className="flex flex-wrap items-center gap-2">
              <Input
                size="sm"
                className="w-36"
                key={`${space.id}:${space.name}`}
                aria-label={`Rename ${space.name}`}
                defaultValue={space.name}
                onBlur={(event) => {
                  const nextName = event.currentTarget.value.trim();
                  if (nextName && nextName !== space.name)
                    void updateSpaces((state) =>
                      updateSpace(state, space.id, { name: nextName }),
                    ).catch(reportSpaceError);
                  else event.currentTarget.value = space.name;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
              <Select
                value={space.theme ?? "global"}
                onValueChange={(theme) => {
                  if (theme !== null)
                    void updateSpaces((state) =>
                      updateSpace(state, space.id, { theme: theme === "global" ? null : theme }),
                    ).catch(reportSpaceError);
                }}
              >
                <SelectTrigger size="sm" className="w-40" aria-label={`Theme for ${space.name}`}>
                  <SelectValue>
                    {space.theme === null
                      ? "Global theme"
                      : (themes.find((theme) => theme.id === space.theme)?.label ?? space.theme)}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="global">Global theme</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                  {themes.map((theme) => (
                    <SelectItem key={theme.id} value={theme.id}>
                      {theme.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void updateSpaces((state) => removeSpace(state, space.id)).catch(reportSpaceError)
                }
                aria-label={`Delete ${space.name}`}
              >
                Delete
              </Button>
            </div>
          }
        />
      ))}
      <form
        className="flex items-center gap-2 px-3 py-3 sm:px-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          const nextName = name.trim();
          const id = randomUUID();
          void updateSpaces((state) => createSpace(state, { id, name: nextName, theme: null }))
            .then(() => setName(""))
            .catch(reportSpaceError);
        }}
      >
        <Input
          size="sm"
          aria-label="New Space name"
          placeholder="Space name"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <Button type="submit" size="sm" variant="outline" disabled={!name.trim()}>
          <PlusIcon aria-hidden />
          Create Space
        </Button>
      </form>
    </SettingsSection>
  );
}
