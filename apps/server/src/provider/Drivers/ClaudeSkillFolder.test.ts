import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { readListedClaudeSkillFiles, readListedClaudeSkillFolder } from "./ClaudeSkillFolder.ts";

const instanceId = ProviderInstanceId.make("claudeAgent");

it.layer(NodeServices.layer)("readListedClaudeSkillFolder", (it) => {
  it.effect("reads a listed skill's text files and names the ones it leaves out", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const skillDir = path.join(
        yield* fs.makeTempDirectoryScoped({ prefix: "t3-skill-folder-" }),
        "deck",
      );
      yield* fs.makeDirectory(path.join(skillDir, "references"), { recursive: true });
      yield* fs.makeDirectory(path.join(skillDir, ".git"), { recursive: true });
      yield* fs.writeFileString(
        path.join(skillDir, "SKILL.md"),
        "# Deck\nRead references/style.md",
      );
      yield* fs.writeFileString(path.join(skillDir, "references", "style.md"), "Use Arial.");
      yield* fs.writeFileString(path.join(skillDir, ".git", "HEAD"), "ref: main");
      yield* fs.writeFile(path.join(skillDir, "template.potx"), new Uint8Array([80, 75, 0, 3]));
      const providers = [
        {
          instanceId,
          driver: ProviderDriverKind.make("claudeAgent"),
          skills: [
            { name: "deck", path: path.join(skillDir, "SKILL.md"), enabled: true },
            { name: "off", path: path.join(skillDir, "SKILL.md"), enabled: false },
          ],
        } as unknown as ServerProvider,
      ];

      const { folder } = yield* readListedClaudeSkillFolder(providers, {
        instanceId,
        name: "deck",
      });
      assert.deepStrictEqual(folder, {
        directory: skillDir,
        files: [
          { path: "SKILL.md", text: "# Deck\nRead references/style.md" },
          { path: "references/style.md", text: "Use Arial." },
        ],
        omittedFiles: ["template.potx"],
      });
      for (const name of ["off", "missing"]) {
        const result = yield* readListedClaudeSkillFolder(providers, { instanceId, name });
        assert.strictEqual(result.folder, null);
        const bytes = yield* readListedClaudeSkillFiles(providers, { instanceId, name });
        assert.strictEqual(bytes.folder, null);
      }
      // The byte read keeps the binary template that the text read leaves out.
      const { folder: files } = yield* readListedClaudeSkillFiles(providers, {
        instanceId,
        name: "deck",
      });
      assert.deepStrictEqual(
        files?.files.map((file) => [file.path, Buffer.from(file.base64, "base64").length]),
        [
          ["SKILL.md", 31],
          ["references/style.md", 10],
          ["template.potx", 4],
        ],
      );
    }),
  );
});
