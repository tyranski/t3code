import {
  ComposerContextRecord,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ComposerContextId,
  type ServerProvider,
} from "@t3tools/contracts";
import { projectComposerContextForProvider } from "@t3tools/shared/composerContextReferences";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  buildHostSkillArchive,
  hostClaudeSkillSource,
  hostOnlySkills,
  hostSkillContextRecord,
  referenceHostSkillMentions,
} from "./hostSkills";

const decodeRecord = Schema.decodeSync(ComposerContextRecord);
const host = EnvironmentId.make("host");
const container = EnvironmentId.make("container");
const skill = (name: string, extra: object = {}) => ({
  name,
  path: `/home/user/.claude/skills/${name}/SKILL.md`,
  enabled: true,
  ...extra,
});
const provider = (driver: string, skills: ReadonlyArray<object>, enabled = true) =>
  ({
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    enabled,
    skills,
  }) as unknown as ServerProvider;

describe("hostClaudeSkillSource", () => {
  const hostProviders = [
    provider("claudeAgent", [
      skill("deck"),
      skill("off", { enabled: false }),
      skill("agent-only", { userInvocable: false }),
    ]),
    provider("codex", [skill("codex-only")]),
    provider("claudeAgent", [skill("disabled-instance")], false),
  ];

  it("offers the host's own invocable Claude skills only in threads on another machine", () => {
    const source = hostClaudeSkillSource({
      threadEnvironmentId: container,
      hostEnvironmentId: host,
      machine: "laptop",
      hostProviders,
    });
    expect(source?.skills.map(({ skill }) => skill.name)).toEqual(["deck"]);
    for (const hostEnvironmentId of [container, null]) {
      expect(
        hostClaudeSkillSource({
          threadEnvironmentId: container,
          hostEnvironmentId,
          machine: "laptop",
          hostProviders,
        }),
      ).toBeNull();
    }
  });
});

describe("referenceHostSkillMentions", () => {
  const source = {
    environmentId: host,
    machine: "laptop",
    skills: [
      { instanceId: ProviderInstanceId.make("claudeAgent"), skill: skill("deck") },
      { instanceId: ProviderInstanceId.make("claudeAgent"), skill: skill("shared") },
    ],
  };
  const hostOnly = hostOnlySkills(source, [skill("shared")]);

  it("references each host-only skill once and leaves the thread's own skills and prices alone", () => {
    const { text, mentions } = referenceHostSkillMentions(
      "$deck then $shared for $5, again $deck",
      hostOnly,
      (name) => `ctx_${name}` as ComposerContextId,
    );
    expect(text).toBe(
      "[$deck](t3-context://v1/host-skill/ctx_deck) then $shared for $5, again [$deck](t3-context://v1/host-skill/ctx_deck)",
    );
    expect(mentions.map((mention) => [mention.skill.name, mention.contextId])).toEqual([
      ["deck", "ctx_deck"],
    ]);
  });
});

describe("hostSkillContextRecord", () => {
  it("fits what any server keeps and reaches the agent, leaving out files past the limit", () => {
    const mention = {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      skill: skill("deck"),
      contextId: "ctx_deck" as ComposerContextId,
    };
    const record = hostSkillContextRecord(mention, "laptop", {
      directory: "/home/user/.claude/skills/deck",
      files: [
        { path: "SKILL.md", text: "# Deck\nRead references/style.md" },
        { path: "references/huge.md", text: "x".repeat(70_000) },
        { path: "references/style.md", text: "Use Arial." },
      ],
      omittedFiles: ["template.potx"],
    });
    // Decodes as an unknown kind, so servers released before host skills keep it.
    const decoded = decodeRecord(record);
    expect("payload" in decoded).toBe(true);
    const projected = projectComposerContextForProvider({
      text: "[$deck](t3-context://v1/host-skill/ctx_deck) review this",
      records: [decoded],
    });
    expect(projected).toContain('on the machine \\"laptop\\"');
    expect(projected).toContain("Use Arial.");
    expect(projected).toContain('"omittedFiles":["template.potx","references/huge.md"]');
  });
});

describe("buildHostSkillArchive", () => {
  it("packs the whole folder, binary files included, under the skill's name", async () => {
    const archive = await buildHostSkillArchive("deck", [
      { path: "SKILL.md", base64: btoa("# Deck") },
      { path: "assets/template.potx", base64: btoa("PK\u0000\u0003") },
    ]);
    expect(archive.name).toBe("deck.skill.zip");
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(await archive.arrayBuffer());
    expect(Object.keys(zip.files).filter((path) => !zip.files[path]!.dir)).toEqual([
      "deck/SKILL.md",
      "deck/assets/template.potx",
    ]);
    expect(await zip.file("deck/assets/template.potx")!.async("string")).toBe("PK\u0000\u0003");
  });
});
