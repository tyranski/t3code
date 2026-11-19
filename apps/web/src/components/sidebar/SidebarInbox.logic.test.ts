import { describe, expect, it } from "vite-plus/test";

import { selectSidebarInboxItems } from "./SidebarInbox.logic";

const doneRun = (completedAt: string) => ({
  runId: "run-1" as never,
  status: "completed" as const,
  assistantMessageId: null,
  requestedAt: "2026-03-09T09:59:00.000Z",
  startedAt: "2026-03-09T09:59:00.000Z",
  completedAt,
});

const base = {
  hasActionableProposedPlan: false,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  interactionMode: "default" as const,
  runtime: null,
  latestRun: null as ReturnType<typeof doneRun> | null,
  settledOverride: null,
  updatedAt: "2026-03-09T10:00:00.000Z",
};

describe("selectSidebarInboxItems", () => {
  it("lists threads waiting on the user or finished unread, newest first, and skips settled or quiet ones", () => {
    const threads = [
      { ...base, id: "quiet" },
      { ...base, id: "approval", hasPendingApprovals: true, updatedAt: "2026-03-09T10:01:00.000Z" },
      {
        ...base,
        id: "question",
        hasPendingUserInput: true,
        pendingUserInputAt: "2026-03-09T10:05:00.000Z",
      },
      { ...base, id: "guest", pendingGuestMessageCount: 2, updatedAt: "2026-03-09T10:03:00.000Z" },
      { ...base, id: "settled", hasPendingApprovals: true, settledOverride: "settled" as const },
      {
        ...base,
        id: "subagent",
        pendingSubagentRequest: "user_input" as const,
        updatedAt: "2026-03-09T10:02:00.000Z",
      },
      {
        ...base,
        id: "unread",
        latestRun: doneRun("2026-03-09T10:04:00.000Z"),
        lastVisitedAt: "2026-03-09T09:00:00.000Z",
      },
      {
        ...base,
        id: "read",
        latestRun: doneRun("2026-03-09T10:04:00.000Z"),
        lastVisitedAt: "2026-03-09T10:06:00.000Z",
      },
    ];

    expect(
      selectSidebarInboxItems(threads).map((item) => [item.thread.id, item.reason, item.since]),
    ).toEqual([
      ["question", "input", "2026-03-09T10:05:00.000Z"],
      ["unread", "done", "2026-03-09T10:04:00.000Z"],
      ["guest", "request", "2026-03-09T10:03:00.000Z"],
      ["subagent", "input", "2026-03-09T10:02:00.000Z"],
      ["approval", "approval", "2026-03-09T10:01:00.000Z"],
    ]);
  });
});
