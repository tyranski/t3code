import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { appAtomRegistry } from "../../state/atom-registry";
import { startVoiceAgent } from "./voiceAgentRuntime";
import {
  loadVoiceAgentSettings,
  voiceAgentErrorAtom,
  voiceAgentSettingsAtom,
} from "./voiceAgentSettings";

export function VoiceAgentController() {
  const settings = useAtomValue(voiceAgentSettingsAtom);
  const enabled = settings !== null && settings.enabled && settings.agentId.trim().length > 0;
  const agentId = settings?.agentId.trim() ?? "";
  const apiKey = settings?.apiKey.trim() ?? "";

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the saved settings from the keychain once per launch
  useEffect(() => {
    void loadVoiceAgentSettings();
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the agent subscribes to thread state and the app's audio session while enabled
  useEffect(() => {
    if (!enabled) return;
    appAtomRegistry.set(voiceAgentErrorAtom, null);
    return startVoiceAgent(
      { enabled, agentId, apiKey },
      { onError: (message) => appAtomRegistry.set(voiceAgentErrorAtom, message) },
    );
  }, [enabled, agentId, apiKey]);

  return null;
}
