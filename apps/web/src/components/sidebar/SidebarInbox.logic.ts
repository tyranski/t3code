import {
  hasUnseenCompletion,
  resolveSidebarRowStatus,
  type SidebarThreadStatus,
} from "../Sidebar.logic";

/**
 * `done` is a finished run the user has not opened yet, like an unread email.
 * `draft` is a prompt the user wrote and has not sent.
 */
export type SidebarInboxReason =
  | Extract<SidebarThreadStatus, "approval" | "input" | "request" | "failed" | "limited">
  | "done"
  | "draft";

const INBOX_REASONS: ReadonlySet<SidebarThreadStatus> = new Set<SidebarThreadStatus>([
  "approval",
  "input",
  "request",
  "failed",
  "limited",
]);

type InboxThreadInput = Parameters<typeof resolveSidebarRowStatus>[0] &
  Parameters<typeof hasUnseenCompletion>[0] & {
    readonly settledOverride: "settled" | "active" | null;
    readonly pendingUserInputAt?: string | null;
    readonly updatedAt: string;
  };

export interface SidebarInboxItem<T> {
  readonly thread: T;
  readonly reason: SidebarInboxReason;
  /** When the thread started waiting on the user, as best the shell knows. */
  readonly since: string;
  /** Set for a side chat: the thread it was started from. */
  readonly parent: T | null;
}

function inboxReason(
  thread: InboxThreadInput,
): { reason: SidebarInboxReason; since: string } | null {
  const status = resolveSidebarRowStatus(thread);
  if (INBOX_REASONS.has(status)) {
    return {
      reason: status as SidebarInboxReason,
      since: thread.pendingUserInputAt ?? thread.updatedAt,
    };
  }
  if (status === "ready" && hasUnseenCompletion(thread)) {
    return { reason: "done", since: thread.latestRun?.completedAt ?? thread.updatedAt };
  }
  return null;
}

/**
 * Threads across every project that wait on the user or finished unread, newest first.
 * Side chats get their own items; a parent waiting only because its side chat asks is
 * left out so the request shows once. A thread with nothing else to report but an unsent
 * draft is listed so the draft gets sent or discarded.
 */
export function selectSidebarInboxItems<T extends InboxThreadInput>(
  threads: readonly T[],
  sideChats: ReadonlyArray<{ readonly thread: T; readonly parent: T }> = [],
  hasUnsentDraft: (thread: T) => boolean = () => false,
): SidebarInboxItem<T>[] {
  const items: SidebarInboxItem<T>[] = [];
  const askedThroughSideChat = new Set<T>();
  for (const { thread, parent } of sideChats) {
    const inbox = inboxReason(thread);
    if (inbox === null) continue;
    items.push({ thread, parent, ...inbox });
    if (inbox.reason === "approval" || inbox.reason === "input") askedThroughSideChat.add(parent);
  }
  for (const thread of threads) {
    if (thread.settledOverride === "settled") continue;
    const inbox =
      inboxReason(thread) ??
      (hasUnsentDraft(thread) ? { reason: "draft" as const, since: thread.updatedAt } : null);
    if (inbox === null) continue;
    if (
      askedThroughSideChat.has(thread) &&
      !thread.hasPendingApprovals &&
      !thread.hasPendingUserInput &&
      (inbox.reason === "approval" || inbox.reason === "input")
    ) {
      continue;
    }
    items.push({ thread, parent: null, ...inbox });
  }
  return items.toSorted((left, right) => right.since.localeCompare(left.since));
}
