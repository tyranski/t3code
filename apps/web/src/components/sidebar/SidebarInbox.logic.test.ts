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
  it("lists threads waiting on the user, finished unread or holding an unsent draft, newest first, and skips settled or quiet ones", () => {
    const threads = [
      { ...base, id: "quiet" },
      { ...base, id: "unsent", updatedAt: "2026-03-09T09:30:00.000Z" },
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

    const withDraft = new Set(["unsent", "approval", "settled"]);

    expect(
      selectSidebarInboxItems(threads, [], (thread) => withDraft.has(thread.id)).map((item) => [
        item.thread.id,
        item.reason,
        item.since,
      ]),
    ).toEqual([
      ["question", "input", "2026-03-09T10:05:00.000Z"],
      ["unread", "done", "2026-03-09T10:04:00.000Z"],
      ["guest", "request", "2026-03-09T10:03:00.000Z"],
      ["subagent", "input", "2026-03-09T10:02:00.000Z"],
      ["approval", "approval", "2026-03-09T10:01:00.000Z"],
      ["unsent", "draft", "2026-03-09T09:30:00.000Z"],
    ]);
  });

  it("lists side chats as their own items and shows a side chat's question once", () => {
    const asking = { ...base, id: "asking", pendingSubagentRequest: "user_input" as const };
    const ownApproval = {
      ...base,
      id: "own-approval",
      hasPendingApprovals: true,
      pendingSubagentRequest: "user_input" as const,
    };
    const quiet = { ...base, id: "quiet" };
    const sideChats = [
      {
        parent: asking,
        thread: {
          ...base,
          id: "btw-question",
          hasPendingUserInput: true,
          updatedAt: "2026-03-09T10:03:00.000Z",
        },
      },
      {
        parent: ownApproval,
        thread: {
          ...base,
          id: "btw-question-2",
          hasPendingUserInput: true,
          updatedAt: "2026-03-09T10:02:00.000Z",
        },
      },
      {
        parent: quiet,
        thread: {
          ...base,
          id: "btw-done",
          latestRun: doneRun("2026-03-09T10:04:00.000Z"),
          lastVisitedAt: "2026-03-09T09:00:00.000Z",
        },
      },
    ];

    expect(
      selectSidebarInboxItems([asking, ownApproval, quiet], sideChats).map((item) => [
        item.thread.id,
        item.reason,
        item.parent?.id ?? null,
      ]),
    ).toEqual([
      ["btw-done", "done", "quiet"],
      ["btw-question", "input", "asking"],
      ["btw-question-2", "input", "own-approval"],
      ["own-approval", "approval", null],
    ]);
  });
});
