import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ThreadUserInputQuestion } from "@t3tools/client-runtime/state/thread-requests";
import { RunId, RuntimeRequestId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadShellFixture } from "../../test-fixtures";
import { resolveSpokenAnswer, voiceAgentItem } from "./voiceAgentInbox";

const NOW = "2026-11-19T12:00:00.000Z";

function run(status: NonNullable<EnvironmentThreadShell["latestRun"]>["status"]) {
  return {
    runId: RunId.make("run-1"),
    status,
    requestedAt: NOW,
    startedAt: NOW,
    completedAt: status === "running" ? null : NOW,
    assistantMessageId: null,
  };
}

function withRequest(overrides: Partial<EnvironmentThreadShell>): EnvironmentThreadShell {
  const thread = makeThreadShellFixture(overrides);
  return {
    ...thread,
    source: {
      ...thread.source,
      pendingRuntimeRequest: {
        id: RuntimeRequestId.make("request-1"),
        kind: "command",
        createdAt: thread.source.createdAt,
      },
    },
  };
}

describe("voiceAgentItem", () => {
  it.each([
    ["approval", withRequest({ hasPendingApprovals: true, latestRun: run("waiting") }), "request"],
    ["question", withRequest({ hasPendingUserInput: true, latestRun: run("waiting") }), "request"],
    [
      "plan",
      makeThreadShellFixture({
        interactionMode: "plan",
        hasActionableProposedPlan: true,
        latestRun: run("completed"),
      }),
      "plan",
    ],
    ["failed", makeThreadShellFixture({ latestRun: run("failed") }), "failed"],
    ["finished", makeThreadShellFixture({ latestRun: run("completed") }), "finished"],
  ] as const)("announces a thread that needs the user: %s", (kind, thread, keyPart) => {
    const item = voiceAgentItem(thread, NOW);
    expect(item?.kind).toBe(kind);
    expect(item?.key).toContain(`:${keyPart}:`);
  });

  it.each([
    ["is running", makeThreadShellFixture({ latestRun: run("running") })],
    ["was interrupted", makeThreadShellFixture({ latestRun: run("interrupted") })],
    ["is archived", makeThreadShellFixture({ latestRun: run("completed"), archivedAt: NOW })],
    [
      "is settled",
      makeThreadShellFixture({ latestRun: run("completed"), settledOverride: "settled" }),
    ],
    [
      "is snoozed",
      makeThreadShellFixture({
        latestRun: run("completed"),
        snoozedAt: NOW,
        snoozedUntil: "2026-11-20T12:00:00.000Z",
      }),
    ],
  ])("stays quiet when the thread %s", (_, thread) => {
    expect(voiceAgentItem(thread, NOW)).toBeNull();
  });
});

describe("resolveSpokenAnswer", () => {
  const question = (overrides: Partial<ThreadUserInputQuestion> = {}): ThreadUserInputQuestion => ({
    id: "q1",
    header: "Pick",
    question: "Which database?",
    options: [
      { label: "Postgres", description: "SQL", value: "pg" },
      { label: "SQLite", description: "File" },
    ],
    multiSelect: false,
    ...overrides,
  });

  it.each([
    ["matches an option label, sending its value", question(), " postgres ", "pg"],
    ["matches an option without a value by label", question(), "SQLite", "SQLite"],
    ["sends free text that names no option", question(), "Use MySQL", "Use MySQL"],
    [
      "selects several options",
      question({ multiSelect: true }),
      "postgres, sqlite",
      ["pg", "SQLite"],
    ],
  ] as const)("%s", (_, input, spoken, expected) => {
    expect(resolveSpokenAnswer(input, spoken)).toEqual(expected);
  });

  it("refuses free text when the question allows only its options", () => {
    expect(resolveSpokenAnswer(question({ allowCustomAnswer: false }), "MySQL")).toBeNull();
  });
});
