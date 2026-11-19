import { resolveSidebarRowStatus, type SidebarThreadStatus } from "../Sidebar.logic";

export type SidebarInboxReason = Extract<
  SidebarThreadStatus,
  "approval" | "input" | "request" | "failed" | "limited"
>;

const INBOX_REASONS: ReadonlySet<SidebarThreadStatus> = new Set<SidebarInboxReason>([
  "approval",
  "input",
  "request",
  "failed",
  "limited",
]);

type InboxThreadInput = Parameters<typeof resolveSidebarRowStatus>[0] & {
  readonly settledOverride: "settled" | "active" | null;
  readonly pendingUserInputAt?: string | null;
  readonly updatedAt: string;
};

export interface SidebarInboxItem<T> {
  readonly thread: T;
  readonly reason: SidebarInboxReason;
  /** When the thread started waiting on the user, as best the shell knows. */
  readonly since: string;
}

/** Threads across every project that wait on the user, newest first. Settled work is handled. */
export function selectSidebarInboxItems<T extends InboxThreadInput>(
  threads: readonly T[],
): SidebarInboxItem<T>[] {
  const items: SidebarInboxItem<T>[] = [];
  for (const thread of threads) {
    if (thread.settledOverride === "settled") continue;
    const status = resolveSidebarRowStatus(thread);
    if (!INBOX_REASONS.has(status)) continue;
    items.push({
      thread,
      reason: status as SidebarInboxReason,
      since: thread.pendingUserInputAt ?? thread.updatedAt,
    });
  }
  return items.toSorted((left, right) => right.since.localeCompare(left.since));
}
