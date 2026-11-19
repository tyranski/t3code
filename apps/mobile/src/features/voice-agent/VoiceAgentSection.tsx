import { useAtomValue } from "@effect/atom-react";
import { requestRecordingPermissionsAsync } from "expo-audio";
import { useGT } from "gt-react-native";
import { useState } from "react";
import { TextInput, View } from "react-native";

import * as Dialog from "../../components/ui/Dialog";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import {
  updateVoiceAgentSettings,
  voiceAgentErrorAtom,
  voiceAgentSettingsAtom,
} from "./voiceAgentSettings";

export function VoiceAgentSection() {
  const gt = useGT();
  const settings = useAtomValue(voiceAgentSettingsAtom);
  const error = useAtomValue(voiceAgentErrorAtom);
  const [agentIdDraft, setAgentIdDraft] = useState<string | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  if (settings === null) return null;
  const agentId = agentIdDraft ?? settings.agentId;

  const setEnabled = async (enabled: boolean) => {
    if (enabled && !(await requestRecordingPermissionsAsync()).granted) {
      Dialog.alert(
        gt("Microphone access needed"),
        gt("Allow microphone access in Settings so you can answer the agent."),
      );
      return;
    }
    await updateVoiceAgentSettings({ enabled });
  };

  return (
    <SettingsSection
      title={gt("Realtime Conversational Agent")}
      footer={
        error
          ? gt("Last call failed: {error}", { error })
          : gt(
              "While this is on, an ElevenLabs agent calls you when a thread needs you, even with the phone locked. Speak your answer and it goes back to the thread.",
            )
      }
    >
      <SettingsSwitchRow
        label={gt("Realtime Conversational Agent")}
        subtitle={gt("Needs an ElevenLabs agent ID")}
        value={settings.enabled}
        disabled={settings.agentId.trim().length === 0}
        onValueChange={(enabled) => void setEnabled(enabled)}
      />
      <View className="gap-2 px-4 py-3">
        <TextInput
          accessibilityLabel={gt("ElevenLabs agent ID")}
          placeholder={gt("ElevenLabs agent ID")}
          autoCapitalize="none"
          autoCorrect={false}
          value={agentId}
          onChangeText={setAgentIdDraft}
          onEndEditing={() => {
            if (agentIdDraft === null) return;
            void updateVoiceAgentSettings({ agentId: agentIdDraft.trim() });
            setAgentIdDraft(null);
          }}
          className="rounded-lg bg-background px-3 py-2 text-foreground"
        />
        <TextInput
          accessibilityLabel={gt("ElevenLabs API key")}
          placeholder={
            settings.apiKey
              ? gt("Saved key · enter a new one to replace")
              : gt("ElevenLabs API key (for private agents)")
          }
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          importantForAutofill="no"
          maxLength={4096}
          returnKeyType="done"
          value={apiKeyDraft}
          onChangeText={setApiKeyDraft}
          onSubmitEditing={() => {
            void updateVoiceAgentSettings({ apiKey: apiKeyDraft.trim() });
            setApiKeyDraft("");
          }}
          className="rounded-lg bg-background px-3 py-2 text-foreground"
        />
      </View>
    </SettingsSection>
  );
}
