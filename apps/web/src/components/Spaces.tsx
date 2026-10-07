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
import { Columns3Icon, LayoutGridIcon, PlusIcon } from "lucide-react";
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

/** Arc-style switcher: the active Space reads as a labeled pill, the rest stay compact dots. */
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
  const items = [
    { id: null, name: "All Spaces", accent: null, shortcut: undefined },
    ...spaces.spaces.map((space, index) => {
      const command = SPACE_JUMP_KEYBINDING_COMMANDS[index];
      return {
        id: space.id,
        name: space.name,
        accent: spacePreviewColors(space.theme, resolvedTheme)?.accent ?? null,
        shortcut: command ? shortcutLabelForCommand(keybindings, command) : undefined,
      };
    }),
  ];
  return (
    <nav
      aria-label="Spaces"
      className="flex shrink-0 items-center gap-1 border-t border-sidebar-border/50 px-2 py-1.5"
    >
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {items.map((item) => {
          const active = spaces.activeSpaceId === item.id;
          return (
            <Tooltip key={item.id ?? "all"}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={item.id === null ? "All Spaces" : `Switch to ${item.name}`}
                    ref={active ? selectedDot : undefined}
                    aria-pressed={active}
                    onClick={() => switchSpace(item.id)}
                    className="flex h-7 min-w-7 shrink-0 items-center justify-center gap-1.5 rounded-full text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-ring aria-pressed:max-w-32 aria-pressed:bg-sidebar-row-active aria-pressed:px-2.5 aria-pressed:text-sidebar-foreground"
                  />
                }
              >
                {item.id === null ? (
                  <LayoutGridIcon aria-hidden className="size-3.5 shrink-0" />
                ) : (
                  <span
                    aria-hidden
                    className={`size-2 shrink-0 rounded-full ${active ? "bg-sidebar-foreground/70" : "bg-sidebar-muted-foreground/45"}`}
                    style={item.accent ? { backgroundColor: item.accent } : undefined}
                  />
                )}
                {active ? (
                  <span className="min-w-0 truncate text-xs font-medium">
                    {item.id === null ? "All" : item.name}
                  </span>
                ) : null}
              </TooltipTrigger>
              <TooltipPopup side="top">
                {item.name}
                {item.shortcut ? ` · ${item.shortcut}` : ""}
              </TooltipPopup>
            </Tooltip>
          );
        })}
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Spaces overview"
              aria-pressed={overviewOpen}
              onClick={() => {
                if (isMobile) setOpenMobile(false);
                void navigate({ to: "/spaces" });
              }}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-sidebar-row-active aria-pressed:text-sidebar-foreground"
            />
          }
        >
          <Columns3Icon aria-hidden className="size-4" />
        </TooltipTrigger>
        <TooltipPopup side="top">Spaces overview</TooltipPopup>
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
