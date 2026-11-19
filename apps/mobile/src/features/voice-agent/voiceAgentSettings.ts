import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";
import * as SecureStore from "expo-secure-store";

import { whenProtectedDataAvailable } from "../../lib/protectedData";
import { appAtomRegistry } from "../../state/atom-registry";

const key = "t3code.voice-agent.v1";
// The API key is read while the phone is locked, so it cannot be WHEN_UNLOCKED.
const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

const VoiceAgentSettings = Schema.Struct({
  enabled: Schema.Boolean,
  agentId: Schema.String,
  apiKey: Schema.String,
});
export type VoiceAgentSettings = typeof VoiceAgentSettings.Type;

const decode = Schema.decodeUnknownSync(Schema.fromJsonString(VoiceAgentSettings));
const EMPTY: VoiceAgentSettings = { enabled: false, agentId: "", apiKey: "" };

export const voiceAgentSettingsAtom = Atom.make<VoiceAgentSettings | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:voice-agent-settings"),
);

/** The last call failure, shown in settings because the phone is usually locked when it happens. */
export const voiceAgentErrorAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:voice-agent-error"),
);

let loading: Promise<VoiceAgentSettings> | null = null;

export function loadVoiceAgentSettings(): Promise<VoiceAgentSettings> {
  loading ??= whenProtectedDataAvailable()
    .then(() => SecureStore.getItemAsync(key, options))
    .then((raw) => (raw ? decode(raw) : EMPTY))
    .catch(() => EMPTY)
    .then((settings) => {
      appAtomRegistry.set(voiceAgentSettingsAtom, settings);
      return settings;
    });
  return loading;
}

export async function updateVoiceAgentSettings(
  change: Partial<VoiceAgentSettings>,
): Promise<VoiceAgentSettings> {
  const next = { ...(await loadVoiceAgentSettings()), ...change };
  await SecureStore.setItemAsync(key, JSON.stringify(next), options);
  appAtomRegistry.set(voiceAgentSettingsAtom, next);
  loading = Promise.resolve(next);
  return next;
}
