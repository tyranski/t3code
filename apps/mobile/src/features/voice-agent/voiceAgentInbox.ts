import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  type PendingUserInputAnswer,
  resolvePendingUserInputAnswer,
} from "@t3tools/client-runtime/state/pending-user-input";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import type {
  PendingThreadRequests,
  ThreadUserInputQuestion,
} from "@t3tools/client-runtime/state/thread-requests";

export type VoiceAgentItemKind = "approval" | "question" | "plan" | "failed" | "finished";

export interface VoiceAgentItem {
  /** Changes whenever the thread needs the user for a new reason, so each reason is announced once. */
  readonly key: string;
  readonly kind: VoiceAgentItemKind;
  readonly environmentId: EnvironmentThreadShell["environmentId"];
  readonly threadId: EnvironmentThreadShell["id"];
  readonly title: string;
}

type VoiceAgentThread = Pick<
  EnvironmentThreadShell,
  | "environmentId"
  | "id"
  | "title"
  | "archivedAt"
  | "deletedAt"
  | "settledOverride"
  | "snoozedAt"
  | "snoozedUntil"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "hasActionableProposedPlan"
  | "pendingSubagentRequest"
  | "interactionMode"
  | "latestRun"
  | "runtime"
> & {
  readonly source: Pick<EnvironmentThreadShell["source"], "pendingRuntimeRequest">;
};

export function voiceAgentItem(thread: VoiceAgentThread, now: string): VoiceAgentItem | null {
  if (
    thread.archivedAt !== null ||
    thread.deletedAt !== null ||
    thread.settledOverride === "settled" ||
    effectiveSnoozed(thread, { now })
  ) {
    return null;
  }
  const base = { environmentId: thread.environmentId, threadId: thread.id, title: thread.title };
  const scope = `${thread.environmentId}:${thread.id}`;
  const request = thread.source.pendingRuntimeRequest;
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) {
    if (request === null) return null;
    const kind = thread.hasPendingApprovals ? "approval" : "question";
    return { ...base, kind, key: `${scope}:request:${request.id}` };
  }
  if (isThreadWorking(thread)) return null;
  const run = thread.latestRun;
  if (run === null) return null;
  if (thread.interactionMode === "plan" && thread.hasActionableProposedPlan) {
    return { ...base, kind: "plan", key: `${scope}:plan:${run.runId}` };
  }
  if (run.status === "failed" || thread.runtime?.lastError != null) {
    return { ...base, kind: "failed", key: `${scope}:failed:${run.runId}` };
  }
  if (run.status === "completed") {
    return { ...base, kind: "finished", key: `${scope}:finished:${run.runId}` };
  }
  return null;
}

export function voiceAgentItems(
  threads: ReadonlyArray<VoiceAgentThread>,
  now: string,
): VoiceAgentItem[] {
  return threads.flatMap((thread) => voiceAgentItem(thread, now) ?? []);
}

/** Text an ElevenLabs agent prompt can reference as dynamic variables. */
export interface VoiceAgentBriefing {
  readonly thread_title: string;
  readonly item_kind: VoiceAgentItemKind;
  readonly announcement: string;
  readonly details: string;
}

const MAX_DETAIL_CHARS = 2_000;

function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= MAX_DETAIL_CHARS ? trimmed : `${trimmed.slice(0, MAX_DETAIL_CHARS)}…`;
}

export function voiceAgentBriefing(
  item: VoiceAgentItem,
  context: {
    readonly latestMessage: string | null;
    readonly requests: PendingThreadRequests | null;
  },
): VoiceAgentBriefing {
  const lines: string[] = [];
  const approval = item.kind === "approval" ? context.requests?.approvals[0] : undefined;
  const userInput = item.kind === "question" ? context.requests?.userInputs[0] : undefined;
  if (approval) {
    lines.push(`Approval requested (${approval.requestKind}).`);
    if (approval.reason) lines.push(`Reason: ${approval.reason}`);
    if (approval.detail) lines.push(`Detail: ${clip(approval.detail)}`);
  }
  if (userInput) {
    for (const question of userInput.questions) {
      const options = question.options.map((option) => option.label).join(" | ");
      lines.push(
        `Question id "${question.id}": ${question.question}` +
          (options ? ` Options: ${options}.` : "") +
          (question.multiSelect ? " Several options may be chosen." : ""),
      );
    }
  }
  if (context.latestMessage) lines.push(`Agent's latest message: ${clip(context.latestMessage)}`);
  const announcement = {
    approval: `${item.title} needs your approval.`,
    question: `${item.title} has a question for you.`,
    plan: `${item.title} has a plan ready for review.`,
    failed: `${item.title} stopped with an error.`,
    finished: `${item.title} is done.`,
  }[item.kind];
  return {
    thread_title: item.title,
    item_kind: item.kind,
    announcement,
    details: lines.join("\n") || "No further details.",
  };
}

/** Maps a spoken answer onto a question's options, or a free-text answer where one is allowed. */
export function resolveSpokenAnswer(
  question: ThreadUserInputQuestion,
  spoken: string,
): PendingUserInputAnswer | null {
  const normalize = (text: string) => text.trim().toLowerCase();
  const optionValue = (part: string) => {
    const option = question.options.find(
      (candidate) =>
        normalize(candidate.label) === normalize(part) ||
        (candidate.value !== undefined && normalize(candidate.value) === normalize(part)),
    );
    return option === undefined ? null : (option.value ?? option.label);
  };
  const parts = question.multiSelect ? spoken.split(",") : [spoken];
  const selected = parts.map(optionValue);
  if (selected.every((value) => value !== null)) {
    return resolvePendingUserInputAnswer(question, { selectedOptionValues: selected });
  }
  return resolvePendingUserInputAnswer(question, { customAnswer: spoken });
}
