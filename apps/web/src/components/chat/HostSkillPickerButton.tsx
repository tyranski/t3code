import { T, useGT } from "gt-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuSearchInput,
  MenuTrigger,
} from "~/components/ui/menu";
import { Spinner } from "~/components/ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import type { HostSkill } from "../../lib/hostSkills";
import { SkillChipIcon } from "./SkillInlineText";

/** Lists the skills of the computer the app runs on, for a thread that runs on another. */
export function HostSkillPickerButton(props: {
  readonly machine: string;
  readonly skills: ReadonlyArray<HostSkill>;
  readonly busy: boolean;
  readonly onPick: (skill: HostSkill) => void;
}) {
  const gt = useGT();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = props.skills.filter(
    ({ skill }) =>
      needle === "" ||
      skill.name.toLowerCase().includes(needle) ||
      (skill.description ?? "").toLowerCase().includes(needle),
  );
  const label = gt("Skills from {machine}", { machine: props.machine });
  return (
    <Menu onOpenChange={(open) => (open ? undefined : setQuery(""))}>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={props.busy}
                  onPointerDown={(event) => event.preventDefault()}
                  aria-label={label}
                />
              }
            />
          }
        >
          {props.busy ? <Spinner tone="muted" /> : <SkillChipIcon />}
        </TooltipTrigger>
        <TooltipPopup>{label}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="start" side="top">
        <MenuSearchInput
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={label}
          aria-label={label}
        />
        {visible.length === 0 ? (
          <MenuItem disabled>
            <T>No matching skills</T>
          </MenuItem>
        ) : (
          visible.map((hostSkill) => (
            <MenuItem key={hostSkill.skill.name} onClick={() => props.onPick(hostSkill)}>
              <MenuItemLabel>{hostSkill.skill.name}</MenuItemLabel>
            </MenuItem>
          ))
        )}
      </MenuPopup>
    </Menu>
  );
}
