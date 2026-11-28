import {
  SKILL_FOLDER_FILES_MAX_BYTES,
  SKILL_FOLDER_FILES_MAX_COUNT,
  SKILL_FOLDER_MAX_FILES,
  SKILL_FOLDER_MAX_TEXT_CHARS,
  type ProviderInstanceId,
  type ServerProvider,
  type SkillFolder,
  type SkillFolderFiles,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

const SKIPPED_SEGMENTS = new Set(["node_modules", "__pycache__"]);
const textDecoder = new TextDecoder("utf-8", { fatal: true });

function decodeText(bytes: Uint8Array): string | undefined {
  if (bytes.includes(0)) return undefined;
  try {
    return textDecoder.decode(bytes);
  } catch {
    return undefined;
  }
}

/** The folder's files, SKILL.md first, without hidden and dependency folders. */
const listSkillFiles = Effect.fn("ClaudeSkillFolder.list")(function* (directory: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries = yield* fileSystem
    .readDirectory(directory, { recursive: true })
    .pipe(Effect.orElseSucceed(() => undefined));
  if (entries === undefined) return null;
  const files: Array<{ readonly relativePath: string; readonly size: number }> = [];
  for (const relativePath of entries
    .map((entry) => entry.split(path.sep).join("/"))
    .filter((entry) =>
      entry
        .split("/")
        .every((segment) => !segment.startsWith(".") && !SKIPPED_SEGMENTS.has(segment)),
    )
    .toSorted((left, right) =>
      left === "SKILL.md" ? -1 : right === "SKILL.md" ? 1 : left.localeCompare(right),
    )) {
    const info = yield* fileSystem.stat(path.join(directory, relativePath)).pipe(Effect.option);
    if (info._tag === "Some" && info.value.type === "File") {
      files.push({ relativePath, size: Number(info.value.size) });
    }
  }
  return files;
});

/** The folder as text within the record's limits. */
const readClaudeSkillFolder = Effect.fn("ClaudeSkillFolder.read")(function* (directory: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const candidates = yield* listSkillFiles(directory);
  if (candidates === null) return null;
  const files: Array<SkillFolder["files"][number]> = [];
  const omittedFiles: string[] = [];
  let textChars = 0;
  for (const { relativePath, size } of candidates) {
    const text =
      files.length >= SKILL_FOLDER_MAX_FILES ||
      // UTF-8 spends at most 3 bytes per UTF-16 code unit, so a larger file can never fit.
      size > SKILL_FOLDER_MAX_TEXT_CHARS * 3
        ? undefined
        : yield* fileSystem.readFile(path.join(directory, relativePath)).pipe(
            Effect.map(decodeText),
            Effect.orElseSucceed(() => undefined),
          );
    if (text === undefined || textChars + text.length > SKILL_FOLDER_MAX_TEXT_CHARS) {
      omittedFiles.push(relativePath);
      continue;
    }
    textChars += text.length;
    files.push({ path: relativePath, text });
  }
  return { directory, files, omittedFiles } satisfies SkillFolder;
});

/** The whole folder as bytes, for a client to pack into one attachment. */
const readClaudeSkillFiles = Effect.fn("ClaudeSkillFolder.readFiles")(function* (
  directory: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const candidates = yield* listSkillFiles(directory);
  if (candidates === null) return null;
  const files: Array<SkillFolderFiles["files"][number]> = [];
  const omittedFiles: string[] = [];
  let bytes = 0;
  for (const { relativePath, size } of candidates) {
    const content =
      files.length >= SKILL_FOLDER_FILES_MAX_COUNT || bytes + size > SKILL_FOLDER_FILES_MAX_BYTES
        ? undefined
        : yield* fileSystem
            .readFile(path.join(directory, relativePath))
            .pipe(Effect.orElseSucceed(() => undefined));
    if (content === undefined) {
      omittedFiles.push(relativePath);
      continue;
    }
    bytes += content.byteLength;
    files.push({ path: relativePath, base64: Buffer.from(content).toString("base64") });
  }
  return { directory, files, omittedFiles } satisfies SkillFolderFiles;
});

const listedSkillDirectory = (
  path: Path.Path,
  providers: ReadonlyArray<ServerProvider>,
  input: { readonly instanceId: ProviderInstanceId; readonly name: string },
) => {
  const skill = providers
    .find(
      (provider) => provider.instanceId === input.instanceId && provider.driver === "claudeAgent",
    )
    ?.skills.find((candidate) => candidate.name === input.name && candidate.enabled);
  return skill ? path.dirname(skill.path) : null;
};

/** Only a skill this machine lists for that Claude instance can be read, never an arbitrary path. */
export const readListedClaudeSkillFolder = Effect.fn("ClaudeSkillFolder.readListed")(function* (
  providers: ReadonlyArray<ServerProvider>,
  input: { readonly instanceId: ProviderInstanceId; readonly name: string },
) {
  const directory = listedSkillDirectory(yield* Path.Path, providers, input);
  return { folder: directory === null ? null : yield* readClaudeSkillFolder(directory) };
});

export const readListedClaudeSkillFiles = Effect.fn("ClaudeSkillFolder.readListedFiles")(function* (
  providers: ReadonlyArray<ServerProvider>,
  input: { readonly instanceId: ProviderInstanceId; readonly name: string },
) {
  const directory = listedSkillDirectory(yield* Path.Path, providers, input);
  return { folder: directory === null ? null : yield* readClaudeSkillFiles(directory) };
});
