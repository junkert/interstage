import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { validateAgent } from "./agents";
import { validateRepo } from "./checks";

const SHA = "5fe7152c66604a967e53ce3aa4882d3fce00072f";
const PLUGIN = "plugins/interstage";

let root: string;

function put(rel: string, content: string | object): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content, null, 2));
}

function skill(name: string, body = "Use the project's test command.\n", extra = ""): void {
  put(`${PLUGIN}/skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: A skill\nlicense: MIT\n${extra}---\n\n${body}`);
}

function manifest(skills: { name: string; budgetBytes?: number }[]): void {
  put("skills.manifest.json", {
    upstream: { repo: "https://github.com/wojons/skills", sha: SHA, license: "MIT" },
    skills: skills.map((s) => ({ name: s.name, path: `${PLUGIN}/skills/${s.name}`, origin: "authored", modified: false, budgetBytes: s.budgetBytes ?? 1000 })),
  });
}

const AGENT_BODY = `# Agent

## Role
x

## Inputs
x

## Method
x

## Output
x

## Definition of done
x

## Operating rules

- You never talk to the user and have no \`ask\` tool. Return open questions.
- Every finding needs evidence: file:line.
- Severity is \`blocker\`, \`major\`, \`minor\` or \`nit\`.
- Report only what you observed.
- Stay inside your assignment.
- Mission artifacts live under the absolute directory in \`$INTERSTAGE_STATE_DIR\`.
`;

function agent(name: string, frontmatter: string, body = AGENT_BODY): void {
  put(`${PLUGIN}/agents/${name}.md`, `---\nname: ${name}\ndescription: An agent\n${frontmatter}---\n\n${body}`);
}

function rules(options: { plugin?: string } = {}): string[] {
  return validateRepo(root, options).map((finding) => finding.rule);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "interstage-plugin-"));
  put(".omp-plugin/marketplace.json", {
    name: "interstage",
    owner: { name: "Levi" },
    plugins: [{ name: "interstage", source: `./${PLUGIN}`, version: "0.1.0" }],
  });
  put(`${PLUGIN}/package.json`, { name: "interstage", version: "0.1.0", omp: { extensions: ["./extension/index.ts"] } });
  put(`${PLUGIN}/extension/index.ts`, "export default function () {}\n");
  put("THIRD_PARTY_NOTICES.md", `Copyright (c) 2025 lexykwaii\n${SHA}\n`);
  manifest([]);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("validateRepo with plugins", () => {
  test("a clean plugin passes", () => {
    skill("is-baby-steps");
    manifest([{ name: "is-baby-steps" }]);
    agent("curiosity", "tools: read, edit, bash\nmodel: \"@coder, @default\"\nautoload-skills: is-baby-steps\n");
    expect(validateRepo(root)).toEqual([]);
  });

  test("reports a missing extension file and a root mcp.json that OMP would ignore", () => {
    put(`${PLUGIN}/package.json`, { name: "interstage", version: "0.1.0", omp: { extensions: ["./extension/missing.ts"] } });
    put(`${PLUGIN}/mcp.json`, { mcpServers: {} });
    expect(rules().sort()).toEqual(["mcp-filename", "plugin-extension"]);
  });

  test("validates the Context7 style http server and rejects an insecure one", () => {
    put(`${PLUGIN}/.mcp.json`, { mcpServers: { context7: { type: "http", url: "https://mcp.context7.com/mcp" }, bad: { type: "http", url: "http://x" } } });
    expect(rules()).toEqual(["mcp-shape"]);
  });

  test("a skill must be in the manifest, named like its directory, and within budget", () => {
    skill("is-big", "x".repeat(2000));
    put(`${PLUGIN}/skills/is-big/SKILL.md`, `---\nname: is-other\ndescription: d\nlicense: MIT\ncompatibility: opencode\n---\n${"x".repeat(2000)}`);
    const found = rules();
    expect(found).toContain("skill-manifest");
    expect(found.filter((rule) => rule === "skill-frontmatter")).toHaveLength(2);
    expect(found).toContain("skill-budget");
  });

  test("a manifest budget allows 20 percent slack", () => {
    skill("is-edge", "x".repeat(60));
    const size = Buffer.byteLength(`---\nname: is-edge\ndescription: A skill\nlicense: MIT\n---\n\n${"x".repeat(60)}`);
    manifest([{ name: "is-edge", budgetBytes: Math.ceil(size / 1.2) }]);
    expect(rules()).toEqual([]);
    manifest([{ name: "is-edge", budgetBytes: Math.ceil(size / 1.2) - 5 }]);
    expect(rules()).toEqual(["skill-budget"]);
  });

  test("skill links must resolve", () => {
    skill("is-a", "See skill://is-missing and scripts/run.sh and references/guide.md.\n");
    manifest([{ name: "is-a" }]);
    const messages = validateRepo(root).map((finding) => finding.message);
    expect(messages.some((message) => message.includes("skill://is-missing"))).toBe(true);
    expect(messages.some((message) => message.includes("scripts/run.sh"))).toBe(true);
    expect(messages.some((message) => message.includes("references/guide.md"))).toBe(true);
  });

  test("lint findings inside a skill are reported with its path", () => {
    skill("is-lint", "Report: 88/100\n");
    manifest([{ name: "is-lint" }]);
    const findings = validateRepo(root);
    expect(findings.map((finding) => finding.rule)).toEqual(["lint-score"]);
    expect(findings[0]?.path).toBe(`${PLUGIN}/skills/is-lint/SKILL.md`);
  });

  test("per-plugin mode skips repo-level checks", () => {
    put("skills.manifest.json", "{ broken");
    expect(rules({ plugin: PLUGIN })).toEqual([]);
    expect(rules()).toContain("manifest-json");
  });
});

describe("validateAgent", () => {
  const ctx = { skills: new Map([["is-baby-steps", 5000], ["is-big", 25000]]), agents: new Set(["flight", "curiosity"]) };
  const base = (frontmatter: string) => `---\nname: curiosity\ndescription: d\n${frontmatter}---\n\n${AGENT_BODY}`;
  const found = (frontmatter: string, path = "agents/curiosity.md") => validateAgent(path, base(frontmatter), ctx).map((finding) => finding.rule).sort();

  test("accepts a valid agent", () => {
    expect(found("tools: read, grep\nmodel: \"@scout, @default\"\nautoload-skills: is-baby-steps\n")).toEqual([]);
  });

  test("rejects ask, todo, unknown tools and keys", () => {
    expect(found("tools: read, ask, todo, frobnicate\ncolor: red\n")).toEqual(["agent-frontmatter", "agent-tools", "agent-tools", "agent-tools"]);
  });

  test("requires a role fallback to @default", () => {
    expect(found("model: \"@coder\"\n")).toEqual(["agent-model"]);
    expect(found("model: \"@coder, @scout\"\n")).toEqual(["agent-model"]);
  });

  test("limits autoloaded skills by count, existence and total size", () => {
    expect(found("autoload-skills: is-baby-steps, is-baby-steps, is-baby-steps, is-baby-steps\n")).toContain("agent-autoload");
    expect(found("autoload-skills: is-nope\n")).toEqual(["agent-autoload"]);
    expect(found("autoload-skills: is-big\n")).toEqual(["agent-autoload"]);
  });

  test("spawns must name real agents and never use a wildcard", () => {
    expect(found("spawns: flight\n")).toEqual([]);
    expect(found("spawns: '*'\n")).toEqual(["agent-spawns"]);
    expect(found("spawns: ghost\n")).toEqual(["agent-spawns"]);
  });

  test("the name must match the file and not be reserved", () => {
    expect(found("", "agents/other.md")).toEqual(["agent-name"]);
    expect(validateAgent("agents/main.md", "---\nname: main\ndescription: d\n---\n\nx\n", ctx).map((finding) => finding.rule)).toContain("agent-name");
  });

  test("requires the prompt sections in order and the verbatim operating rules", () => {
    const noSections = `---\nname: curiosity\ndescription: d\n---\n\nJust a paragraph.\n`;
    const rules = validateAgent("agents/curiosity.md", noSections, ctx).map((finding) => finding.rule);
    expect(rules).toContain("agent-sections");
    expect(rules.filter((rule) => rule === "agent-rules")).toHaveLength(6);
    const shuffled = base("").replace("## Inputs", "## Tmp").replace("## Method", "## Inputs").replace("## Tmp", "## Method");
    expect(validateAgent("agents/curiosity.md", shuffled, ctx).map((finding) => finding.rule)).toContain("agent-sections");
  });

  test("skill links in the prompt must resolve when the repo skill list is known", () => {
    const withLinks = base("").replace("x\n\n## Inputs", "read skill://is-baby-steps and skill://is-ghost\n\n## Inputs");
    const known = { ...ctx, knownSkills: new Set(["is-baby-steps"]) };
    const findings = validateAgent("agents/curiosity.md", withLinks, known);
    expect(findings.map((finding) => finding.rule)).toEqual(["agent-skill-link"]);
    expect(findings[0]?.message).toContain("is-ghost");
  });
});

describe("manifest fragments", () => {
  const entry = (name: string, extra: object = {}) => ({ name, path: `${PLUGIN}/skills/${name}`, origin: "authored", modified: false, budgetBytes: 1000, ...extra });

  test("a skill listed only in a fragment counts as listed and gets its budget", () => {
    skill("is-frag");
    put("skills.manifest.fragments/S1.json", [entry("is-frag")]);
    expect(rules()).toEqual([]);
  });

  test("fragments are validated like the manifest", () => {
    skill("is-frag");
    put("skills.manifest.fragments/S1.json", [entry("is-frag", { budgetBytes: undefined })]);
    expect(rules().sort()).toEqual(["manifest-skills", "skill-budget"]);
  });

  test("the same path in two fragments is rejected", () => {
    skill("is-frag");
    put("skills.manifest.fragments/S1.json", [entry("is-frag")]);
    put("skills.manifest.fragments/S2.json", [entry("is-frag")]);
    expect(rules()).toEqual(["manifest-skills"]);
  });

  test("a fragment that is not an array is reported", () => {
    put("skills.manifest.fragments/S1.json", { skills: [] });
    expect(rules()).toEqual(["manifest-shape"]);
  });
});
