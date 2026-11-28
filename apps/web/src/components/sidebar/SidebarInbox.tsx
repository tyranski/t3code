import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { Schema } from "effect";
import { useGT, useMessages } from "gt-react";
import { useShallow } from "zustand/react/shallow";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { composerDraftHasUserContent, useComposerDraftStore } from "../../composerDraftStore";
import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { useUiStateStore } from "../../uiStateStore";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { resolveThreadLastVisitedAt } from "../Sidebar.logic";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { ScrollArea } from "../ui/scroll-area";
import { selectSidebarInboxItems, type SidebarInboxReason } from "./SidebarInbox.logic";

const INBOX_EXPANDED_KEY = "t3code:sidebar:inbox-expanded";

/** Cross-project list of threads waiting on the user or finished unread, above the thread list. */
export function SidebarInbox(props: {
  readonly threads: readonly EnvironmentThreadShell[];
  readonly sideChats: readonly SidebarSideChat[];
  /** The open thread; its draft is in front of the user, so it is not listed for that. */
  readonly routeThreadKey: string | null;
  readonly projectName: (thread: EnvironmentThreadShell) => string | null;
  readonly onOpen: (thread: EnvironmentThreadShell) => void;
  readonly onOpenSideChat: (sideChat: SidebarSideChat) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const nowMinute = useNowMinute();
  const [expanded, setExpanded] = useLocalStorage(INBOX_EXPANDED_KEY, true, Schema.Boolean);
  const localLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const unsentDraftThreadKeys = useComposerDraftStore(
    useShallow((store) => {
      const keys: string[] = [];
      for (const [key, draft] of Object.entries(store.draftsByThreadKey)) {
        if (!composerDraftHasUserContent(draft)) continue;
        const session = store.draftThreadsByThreadKey[key];
        keys.push(
          session ? scopedThreadKey(scopeThreadRef(session.environmentId, session.threadId)) : key,
        );
      }
      return keys.toSorted();
    }),
  );
  const threadKey = (thread: EnvironmentThreadShell) =>
    scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
  const withLocalVisit = (thread: EnvironmentThreadShell) => ({
    ...thread,
    lastVisitedAt:
      resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAtById[threadKey(thread)]) ??
      null,
  });
  const visitedByThread = new Map(props.threads.map((thread) => [thread, withLocalVisit(thread)]));
  const items = selectSidebarInboxItems(
    [...visitedByThread.values()],
    props.sideChats.map(({ thread, parent }) => ({
      thread: withLocalVisit(thread),
      parent: visitedByThread.get(parent) ?? withLocalVisit(parent),
    })),
    (thread) => {
      const key = threadKey(thread);
      return key !== props.routeThreadKey && unsentDraftThreadKeys.includes(key);
    },
  );
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
      case "done":
        return gt("Finished", { $context: "unread finished thread in the sidebar inbox" });
      case "draft":
        return gt("Unsent draft");
    }
  };
  const nowMs = Date.parse(nowMinute);
  return (
    <section
      aria-label={gt("Needs you", { $context: "sidebar section of threads that need the user" })}
      className="mx-0.5 mb-3 flex max-h-[30vh] flex-col"
    >
      <CollapsibleSectionHeader
        data-testid="sidebar-inbox-toggle"
        expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        tone="accent"
        accessory={
          items.length > 0 ? (
            <span className="font-normal tabular-nums">{items.length}</span>
          ) : undefined
        }
      >
        {gt("Needs you", { $context: "sidebar section of threads that need the user" })}
      </CollapsibleSectionHeader>
      {expanded && items.length === 0 ? (
        <p className="px-2 py-1 text-xs text-sidebar-muted-foreground">
          {gt("You're all caught up")}
        </p>
      ) : null}
      {expanded && items.length > 0 ? (
        <ScrollArea hideScrollbars scrollFade viewportTabIndex={-1} className="min-h-0 flex-1">
          <ul className="flex flex-col gap-px">
            {items.map(({ thread, reason, since, parent }) => (
              <li key={`${thread.environmentId}:${thread.id}`}>
                <SidebarInboxRow
                  reason={reasonLabel(reason)}
                  tone={
                    reason === "failed" || reason === "limited"
                      ? "destructive"
                      : reason === "done"
                        ? "success"
                        : "primary"
                  }
                  project={props.projectName(parent ?? thread)}
                  age={reason === "draft" ? null : formatRelativeTimeLabel(since, nowMs, messages)}
                  title={thread.title}
                  parentTitle={parent?.title ?? null}
                  onClick={() =>
                    parent === null
                      ? props.onOpen(thread)
                      : props.onOpenSideChat({ thread, parent })
                  }
                />
              </li>
            ))}
          </ul>
        </ScrollArea>
      ) : null}
    </section>
  );
}

export interface SidebarSideChat {
  readonly thread: EnvironmentThreadShell;
  readonly parent: EnvironmentThreadShell;
}

const ROW_TONES = {
  primary: "text-primary",
  success: "text-success",
  destructive: "text-destructive",
} as const;

/** A compact row that opens a thread; a side chat names the thread it belongs to. */
export function SidebarInboxRow(props: {
  readonly reason: string;
  readonly tone: keyof typeof ROW_TONES;
  readonly project: string | null;
  readonly age: string | null;
  readonly title: string;
  /** Set for a side chat. */
  readonly parentTitle: string | null;
  readonly onClick: () => void;
}) {
  const gt = useGT();
  return (
    <button
      type="button"
      data-testid="sidebar-inbox-item"
      onClick={props.onClick}
      className="flex w-full min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-sidebar-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
    >
      <span className="flex min-w-0 items-baseline gap-2 text-xs">
        <span className={cn("shrink-0 font-medium", ROW_TONES[props.tone])}>{props.reason}</span>
        {props.parentTitle === null ? null : (
          <span className="shrink-0 rounded-sm border border-sidebar-border px-1 text-2xs leading-4 text-sidebar-muted-foreground">
            {gt("Side chat")}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sidebar-muted-foreground">
          {props.project}
        </span>
        {props.age === null ? null : (
          <span className="shrink-0 text-sidebar-muted-foreground tabular-nums">{props.age}</span>
        )}
      </span>
      <span className="truncate text-sm text-sidebar-foreground">
        {props.parentTitle === null ? (
          props.title
        ) : (
          <>
            {props.parentTitle}
            <span className="text-sidebar-muted-foreground"> · {props.title}</span>
          </>
        )}
      </span>
    </button>
  );
}
