import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LayersIcon, PlusIcon, SettingsIcon } from "lucide-react";
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
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "./ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { SettingsRow, SettingsSection } from "./settings/settingsLayout";

export function SpaceSelector() {
  const spaces = useClientSettings((settings) => settings.spaces);
  const selectSpace = useSelectSpace();
  const navigate = useNavigate();
  const active = spaces.spaces.find((space) => space.id === spaces.activeSpaceId);
  return (
    <div className="px-3 pb-2">
      <Menu>
        <MenuTrigger render={<Button variant="ghost" size="sm" className="w-full" />}>
          <LayersIcon aria-hidden className="size-4" />
          <span className="min-w-0 flex-1 truncate text-left">{active?.name ?? "All Spaces"}</span>
        </MenuTrigger>
        <MenuPopup align="start">
          <MenuItem onClick={() => void selectSpace(null).catch(reportSpaceError)}>
            All Spaces
          </MenuItem>
          {spaces.spaces.map((space) => (
            <MenuItem
              key={space.id}
              onClick={() => void selectSpace(space.id).catch(reportSpaceError)}
            >
              {space.name}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem onClick={() => void navigate({ to: "/settings/general", hash: "spaces" })}>
            <SettingsIcon aria-hidden />
            Manage Spaces
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
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
