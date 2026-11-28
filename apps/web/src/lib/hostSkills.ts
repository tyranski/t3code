import {
  type ComposerContextId,
  type ComposerContextRecord,
  type EnvironmentId,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerProviderSkill,
  type SkillFolder,
  type SkillFolderFiles,
} from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { SKILL_MENTION_PATTERN } from "@t3tools/shared/composerInlineTokens";

/**
 * No server knows this kind, so every version keeps the record and hands its payload to the
 * agent as JSON. A known kind would be dropped by a server released before it.
 */
export const HOST_SKILL_CONTEXT_KIND = "host-skill";
// Files fill up to here; the rest of a server's 64,000-character limit lists what was left out.
const HOST_SKILL_PAYLOAD_MAX_CHARS = 60_000;
const HOST_SKILL_PAYLOAD_LIMIT_CHARS = 64_000;
const HOST_SKILL_OMITTED_LISTED = 100;

export interface HostSkill {
  readonly instanceId: ProviderInstanceId;
  readonly skill: ServerProviderSkill;
}

/** The Claude skills of the machine this client runs on, for threads that run on another. */
export interface HostSkillSource {
  readonly environmentId: EnvironmentId;
  readonly machine: string;
  readonly skills: ReadonlyArray<HostSkill>;
}

export function hostClaudeSkillSource(input: {
  readonly threadEnvironmentId: EnvironmentId;
  readonly hostEnvironmentId: EnvironmentId | null;
  readonly machine: string;
  readonly hostProviders: ReadonlyArray<ServerProvider>;
}): HostSkillSource | null {
  if (input.hostEnvironmentId === null || input.hostEnvironmentId === input.threadEnvironmentId) {
    return null;
  }
  const byName = new Map<string, HostSkill>();
  for (const provider of input.hostProviders) {
    if (provider.driver !== "claudeAgent" || !provider.enabled) continue;
    for (const skill of provider.skills) {
      if (!skill.enabled || skill.userInvocable === false || byName.has(skill.name)) continue;
      byName.set(skill.name, { instanceId: provider.instanceId, skill });
    }
  }
  return byName.size === 0
    ? null
    : {
        environmentId: input.hostEnvironmentId,
        machine: input.machine,
        skills: [...byName.values()],
      };
}

/** Host skills the thread's own machine does not have; its own skill wins a shared name. */
export function hostOnlySkills(
  source: HostSkillSource | null,
  threadSkills: ReadonlyArray<Pick<ServerProviderSkill, "name">>,
): ReadonlyMap<string, HostSkill> {
  if (source === null) return new Map();
  const threadNames = new Set(threadSkills.map((skill) => skill.name));
  return new Map(
    source.skills
      .filter(({ skill }) => !threadNames.has(skill.name))
      .map((hostSkill) => [hostSkill.skill.name, hostSkill]),
  );
}

/** Replaces each `$name` of a host-only skill with a reference to the record its read will fill. */
export function referenceHostSkillMentions(
  text: string,
  hostSkills: ReadonlyMap<string, HostSkill>,
  contextIdFor: (name: string) => ComposerContextId,
): { readonly text: string; readonly mentions: ReadonlyArray<HostSkillMention> } {
  const mentions = new Map<string, HostSkillMention>();
  const replaced = text.replace(SKILL_MENTION_PATTERN, (match, leading: string, name: string) => {
    const hostSkill = hostSkills.get(name);
    if (hostSkill === undefined) return match;
    const mention = mentions.get(name) ?? { ...hostSkill, contextId: contextIdFor(name) };
    mentions.set(name, mention);
    return `${leading}${formatComposerContextReference({
      kind: HOST_SKILL_CONTEXT_KIND,
      contextId: mention.contextId,
      label: `$${name}`,
    })}`;
  });
  return { text: replaced, mentions: [...mentions.values()] };
}

export interface HostSkillMention extends HostSkill {
  readonly contextId: ComposerContextId;
}

/** The skill's text files, in order, until the payload would pass what a server keeps. */
export function hostSkillContextRecord(
  mention: HostSkillMention,
  machine: string,
  folder: SkillFolder,
): ComposerContextRecord {
  const name = mention.skill.name;
  const payload = {
    instructions: `The user invoked the skill ${JSON.stringify(name)}. It is on the machine ${JSON.stringify(machine)} at ${folder.directory}, which you cannot reach, so do not look for it. Its text files are in "files": follow SKILL.md. If an attachment named ${hostSkillArchiveName(name)} came with this message, it holds the whole folder, binary files included: unzip it into a new temporary directory, use that as the skill's folder, and delete the directory when you are done.`,
    files: [] as Array<SkillFolder["files"][number]>,
    omittedFiles: [] as string[],
  };
  const omitted = [...folder.omittedFiles];
  for (const file of folder.files) {
    payload.files.push(file);
    if (JSON.stringify(payload).length > HOST_SKILL_PAYLOAD_MAX_CHARS) {
      payload.files.pop();
      omitted.push(file.path);
    }
  }
  payload.omittedFiles = omitted.slice(0, HOST_SKILL_OMITTED_LISTED);
  if (omitted.length > HOST_SKILL_OMITTED_LISTED) {
    payload.omittedFiles.push(`and ${omitted.length - HOST_SKILL_OMITTED_LISTED} more`);
  }
  while (JSON.stringify(payload).length > HOST_SKILL_PAYLOAD_LIMIT_CHARS)
    payload.omittedFiles.pop();
  return {
    version: 1,
    contextId: mention.contextId,
    kind: HOST_SKILL_CONTEXT_KIND,
    label: `$${name}`,
    payload,
  };
}

function hostSkillArchiveName(name: string): string {
  return `${name}.skill.zip`;
}

/** The skill's folder as one zip attachment, so binary files such as templates reach the agent too. */
export async function buildHostSkillArchive(
  name: string,
  files: SkillFolderFiles["files"],
): Promise<File> {
  // Loaded on use: the composer should not carry a zip library for a rare action.
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const file of files) zip.file(`${name}/${file.path}`, file.base64, { base64: true });
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  return new File([blob], hostSkillArchiveName(name), { type: "application/zip" });
}
