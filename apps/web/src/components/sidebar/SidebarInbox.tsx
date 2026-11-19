import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { Schema } from "effect";
import { useGT, useMessages } from "gt-react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useNowMinute } from "../../hooks/useNowMinute";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { selectSidebarInboxItems, type SidebarInboxReason } from "./SidebarInbox.logic";

const INBOX_EXPANDED_KEY = "t3code:sidebar:inbox-expanded";

/** Cross-project list of threads waiting on the user, above the thread list. */
export function SidebarInbox(props: {
  readonly threads: readonly EnvironmentThreadShell[];
  readonly projectName: (thread: EnvironmentThreadShell) => string | null;
  readonly onOpen: (thread: EnvironmentThreadShell) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const nowMinute = useNowMinute();
  const [expanded, setExpanded] = useLocalStorage(INBOX_EXPANDED_KEY, true, Schema.Boolean);
  const items = selectSidebarInboxItems(props.threads);
  if (items.length === 0) return null;
  const reasonLabel = (reason: SidebarInboxReason) => {
    switch (reason) {
      case "approval":
        return gt("Needs approval");
      case "input":
        return gt("Asked a question");
      case "request":
        return gt("Guest is waiting");
      case "failed":
        return gt("Failed", { $context: "thread status in the sidebar inbox" });
      case "limited":
        return gt("Hit a usage limit");
    }
  };
  const nowMs = Date.parse(nowMinute);
  return (
    <section aria-label={gt("Inbox")} className="mx-0.5 mb-1 flex flex-col">
      <CollapsibleSectionHeader
        data-testid="sidebar-inbox-toggle"
        expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        tone="accent"
        accessory={<span className="font-normal tabular-nums">{items.length}</span>}
      >
        {gt("Inbox", { $context: "sidebar section of threads that need the user" })}
      </CollapsibleSectionHeader>
      {expanded ? (
        <ul className="flex flex-col gap-px">
          {items.map(({ thread, reason, since }) => {
            const project = props.projectName(thread);
            const age = formatRelativeTimeLabel(since, nowMs, messages);
            return (
              <li key={`${thread.environmentId}:${thread.id}`}>
                <button
                  type="button"
                  data-testid="sidebar-inbox-item"
                  onClick={() => props.onOpen(thread)}
                  className="flex w-full min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-sidebar-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
                >
                  <span className="flex min-w-0 items-baseline gap-2 text-xs">
                    <span
                      className={
                        reason === "failed" || reason === "limited"
                          ? "shrink-0 font-medium text-destructive"
                          : "shrink-0 font-medium text-primary"
                      }
                    >
                      {reasonLabel(reason)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sidebar-muted-foreground">
                      {project}
                    </span>
                    <span className="shrink-0 text-sidebar-muted-foreground tabular-nums">
                      {age}
                    </span>
                  </span>
                  <span className="truncate text-sm text-sidebar-foreground">{thread.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
