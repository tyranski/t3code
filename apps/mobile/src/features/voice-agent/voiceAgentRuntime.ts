// @effect-diagnostics globalTimers:off - The voice agent schedules call timeouts outside an Effect runtime.
/* oxlint-disable t3code/no-untranslated-copy -- client tool replies are read by the ElevenLabs agent, not shown to the user */
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { PendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import {
  AuthOrchestrationOperateScope,
  CommandId,
  MessageId,
  type ProviderApprovalDecision,
} from "@t3tools/contracts";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { AppState, Platform } from "react-native";

import { uuidv4 } from "../../lib/uuid";
import { appAtomRegistry } from "../../state/atom-registry";
import { readEnvironmentScope } from "../../state/session";
import { enqueueThreadOutboxMessage } from "../../state/thread-outbox";
import {
  environmentThreadDetails,
  environmentThreadShells,
  threadEnvironment,
} from "../../state/threads";
import {
  resolveSpokenAnswer,
  voiceAgentBriefing,
  voiceAgentItems,
  type VoiceAgentItem,
} from "./voiceAgentInbox";
import type { VoiceAgentSettings } from "./voiceAgentSettings";

/** A run can end moments before its continuation starts; wait before calling about it. */
const SETTLE_MS = 3_000;
const REQUEST_DETAIL_TIMEOUT_MS = 5_000;
const MAX_CALL_MS = 5 * 60_000;
/** Lets the agent finish its confirmation before the call ends. */
const HANG_UP_AFTER_ACTION_MS = 6_000;

type ElevenLabsConversation = Awaited<
  ReturnType<(typeof import("@elevenlabs/client"))["Conversation"]["startSession"]>
>;

async function loadElevenLabs() {
  // Importing the React Native package installs WebRTC globals; only pay for that when a call starts.
  await import("@elevenlabs/react-native");
  const [{ Conversation }, { AudioSession }] = await Promise.all([
    import("@elevenlabs/client"),
    import("@livekit/react-native"),
  ]);
  return { Conversation, AudioSession };
}

async function conversationAuth(settings: VoiceAgentSettings) {
  if (settings.apiKey.length === 0) return { agentId: settings.agentId } as const;
  const response = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(settings.agentId)}`,
    { headers: { "xi-api-key": settings.apiKey } },
  );
  if (!response.ok) throw new Error(`ElevenLabs refused the API key (${response.status}).`);
  const body = (await response.json()) as { readonly token?: string };
  if (!body.token) throw new Error("ElevenLabs returned no conversation token.");
  return { conversationToken: body.token } as const;
}

function waitForPendingRequests(item: VoiceAgentItem): Promise<PendingThreadRequests | null> {
  const atom = environmentThreadDetails.pendingRequestsAtom({
    environmentId: item.environmentId,
    threadId: item.threadId,
  });
  return new Promise((resolve) => {
    let unsubscribe: (() => void) | undefined;
    const finish = (value: PendingThreadRequests | null) => {
      clearTimeout(timeout);
      unsubscribe?.();
      resolve(value);
    };
    const timeout = setTimeout(() => finish(appAtomRegistry.get(atom)), REQUEST_DETAIL_TIMEOUT_MS);
    // Subscribing opens the thread's detail stream; the summary alone lacks the question text.
    unsubscribe = appAtomRegistry.subscribe(atom, (value) => {
      if (value !== null) finish(value);
    });
    const current = appAtomRegistry.get(atom);
    if (current !== null) finish(current);
  });
}

/** iOS suspends a locked app unless audio is playing, which would also drop its server connection. */
function createKeepAlive() {
  let player: ReturnType<typeof createAudioPlayer> | null = null;
  return {
    async start() {
      if (Platform.OS !== "ios" || player) return;
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: "mixWithOthers",
        // Holding a record-capable session lets a call open the microphone while locked.
        allowsRecording: true,
      });
      player = createAudioPlayer(require("../../../assets/voice-agent/silence.wav"));
      player.loop = true;
      player.volume = 0;
      player.play();
    },
    resume() {
      player?.play();
    },
    stop() {
      if (!player) return;
      player.pause();
      player.release();
      player = null;
      void setAudioModeAsync({ shouldPlayInBackground: false, allowsRecording: false });
    },
  };
}

export function startVoiceAgent(
  settings: VoiceAgentSettings,
  callbacks: { readonly onError: (message: string) => void },
): () => void {
  const now = () => new Date().toISOString();
  const shellsAtom = environmentThreadShells.threadShellsAtom;
  const announced = new Set(
    voiceAgentItems(appAtomRegistry.get(shellsAtom), now()).map((i) => i.key),
  );
  const queue: VoiceAgentItem[] = [];
  const settleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const keepAlive = createKeepAlive();
  let active: ElevenLabsConversation | null = null;
  let stopped = false;

  const currentItem = (key: string) =>
    voiceAgentItems(appAtomRegistry.get(shellsAtom), now()).find((item) => item.key === key);

  const call = async (item: VoiceAgentItem) => {
    if (!readEnvironmentScope(item.environmentId, AuthOrchestrationOperateScope)) return;
    const shell = appAtomRegistry
      .get(shellsAtom)
      .find((thread) => thread.environmentId === item.environmentId && thread.id === item.threadId);
    const latest = shell?.source.latestVisibleMessage;
    const requests =
      item.kind === "approval" || item.kind === "question"
        ? await waitForPendingRequests(item)
        : null;
    const briefing = voiceAgentBriefing(item, {
      latestMessage: latest?.role === "assistant" ? latest.text : null,
      requests,
    });
    const scope = { environmentId: item.environmentId };
    const threadId = item.threadId;
    const approval = requests?.approvals[0];
    const userInput = requests?.userInputs[0];
    const answers: Record<string, string | ReadonlyArray<string>> = {};
    let hangUp: ReturnType<typeof setTimeout> | undefined;
    const finishAfterReply = () => {
      clearTimeout(hangUp);
      hangUp = setTimeout(() => void active?.endSession(), HANG_UP_AFTER_ACTION_MS);
    };

    const clientTools = {
      respond_to_approval: async (parameters: { decision?: string; feedback?: string }) => {
        if (!approval || approval.responseCapability !== "live") {
          return "There is no approval waiting any more.";
        }
        const decision: ProviderApprovalDecision =
          parameters.decision === "approve_for_session"
            ? "acceptForSession"
            : parameters.decision === "approve"
              ? "accept"
              : "decline";
        const result = await runAtomCommand(appAtomRegistry, threadEnvironment.respondToApproval, {
          ...scope,
          input: {
            threadId,
            requestId: approval.requestId,
            decision,
            ...(parameters.feedback ? { feedback: parameters.feedback } : {}),
          },
        });
        if (result._tag !== "Success") return "Sending the decision failed. Tell the user.";
        finishAfterReply();
        return `Sent: ${decision}. Confirm briefly, then end the call.`;
      },
      answer_question: async (parameters: { question_id?: string; answer?: string }) => {
        if (!userInput || userInput.responseCapability === "not_resumable") {
          return "There is no question waiting any more.";
        }
        const question =
          userInput.questions.find((candidate) => candidate.id === parameters.question_id) ??
          (userInput.questions.length === 1 ? userInput.questions[0] : undefined);
        if (!question) return "Pass question_id; several questions are waiting.";
        const answer = resolveSpokenAnswer(question, parameters.answer ?? "");
        if (answer === null) {
          return `That is not an allowed answer. Options: ${question.options.map((o) => o.label).join(", ")}.`;
        }
        answers[question.id] = answer;
        const missing = userInput.questions.filter((candidate) => !(candidate.id in answers));
        if (missing.length > 0) {
          return `Saved. Still to answer: ${missing.map((q) => `"${q.id}": ${q.question}`).join(" ")}`;
        }
        const result = await runAtomCommand(appAtomRegistry, threadEnvironment.respondToUserInput, {
          ...scope,
          input: { threadId, requestId: userInput.requestId, answers },
        });
        if (result._tag !== "Success") return "Sending the answers failed. Tell the user.";
        finishAfterReply();
        return "Answers sent. Confirm briefly, then end the call.";
      },
      send_message: async (parameters: { text?: string }) => {
        const text = parameters.text?.trim();
        if (!text) return "Pass the message text.";
        await enqueueThreadOutboxMessage({
          environmentId: item.environmentId,
          threadId,
          messageId: MessageId.make(uuidv4()),
          commandId: CommandId.make(uuidv4()),
          text,
          attachments: [],
          dispatchMode: "queue",
          createdAt: now(),
        });
        finishAfterReply();
        return "Message sent. Confirm briefly, then end the call.";
      },
      leave_for_later: () => {
        finishAfterReply();
        return "Left for later. Say goodbye briefly.";
      },
    };

    const { Conversation, AudioSession } = await loadElevenLabs();
    const auth = await conversationAuth(settings);
    if (stopped) return;
    await AudioSession.setAppleAudioConfiguration({
      audioCategory: "playAndRecord",
      audioCategoryOptions: ["allowBluetooth", "allowBluetoothA2DP", "mixWithOthers"],
      audioMode: "voiceChat",
    });
    await new Promise<void>((resolve) => {
      const maxCall = setTimeout(() => void active?.endSession(), MAX_CALL_MS);
      void Conversation.startSession({
        ...auth,
        connectionType: "webrtc",
        dynamicVariables: { ...briefing },
        clientTools,
        onDisconnect: () => {
          clearTimeout(maxCall);
          clearTimeout(hangUp);
          resolve();
        },
        onError: (message) => callbacks.onError(message),
      }).then(
        (conversation) => {
          active = conversation;
          if (stopped) void conversation.endSession();
        },
        (cause: unknown) => {
          clearTimeout(maxCall);
          callbacks.onError(cause instanceof Error ? cause.message : String(cause));
          resolve();
        },
      );
    });
    active = null;
    // Ending the call deactivates the shared session, which would pause the keep-alive.
    keepAlive.resume();
  };

  let draining = false;
  const drain = async () => {
    if (draining) return;
    draining = true;
    try {
      let item: VoiceAgentItem | undefined;
      while ((item = queue.shift()) !== undefined) {
        if (stopped) break;
        // The thread may have moved on while earlier calls ran.
        const current = currentItem(item.key);
        if (!current) continue;
        try {
          await call(current);
        } catch (cause) {
          callbacks.onError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    } finally {
      draining = false;
    }
  };

  const observe = () => {
    for (const item of voiceAgentItems(appAtomRegistry.get(shellsAtom), now())) {
      if (announced.has(item.key) || settleTimers.has(item.key)) continue;
      const wait = item.kind === "approval" || item.kind === "question" ? 0 : SETTLE_MS;
      settleTimers.set(
        item.key,
        setTimeout(() => {
          settleTimers.delete(item.key);
          if (stopped || !currentItem(item.key)) return;
          announced.add(item.key);
          queue.push(item);
          void drain();
        }, wait),
      );
    }
  };

  const unsubscribeShells = appAtomRegistry.subscribe(shellsAtom, observe);
  const syncKeepAlive = (state: string | null | undefined) => {
    if (state === "active") keepAlive.stop();
    else void keepAlive.start().catch((cause: unknown) => callbacks.onError(String(cause)));
  };
  const appState = AppState.addEventListener("change", syncKeepAlive);
  syncKeepAlive(AppState.currentState);

  return () => {
    stopped = true;
    unsubscribeShells();
    appState.remove();
    for (const timer of settleTimers.values()) clearTimeout(timer);
    settleTimers.clear();
    queue.length = 0;
    void active?.endSession();
    keepAlive.stop();
  };
}
