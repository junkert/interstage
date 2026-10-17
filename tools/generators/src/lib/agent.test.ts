import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateAgent } from "../../../validate/src/agents";
import { REPO_ROOT, makeTempRepo } from "../testing.ts";
import { AGENT_TOOLS, parseSkills, parseTools, readOperatingRules, scaffoldAgent, type AgentOptions } from "./agent.ts";

const repo = makeTempRepo();
afterAll(repo.cleanup);

const options: AgentOptions = { name: "lint-bot", description: "Use when checking a diff for lint problems.", role: "reviewer", tools: "read, grep, glob" };

describe("tools", () => {
  test("the generator's tool list is the validator's known set minus mission", () => {
    const source = readFileSync(join(REPO_ROOT, "tools/validate/src/agents.ts"), "utf8");
    const body = /const KNOWN_TOOLS: Record<string, true> = \{([^}]*)\}/.exec(source)?.[1] ?? "";
    const validatorTools = [...body.matchAll(/^\s*([a-z_]+): true/gm)].map((match) => match[1] ?? "");
    expect(validatorTools).toContain("mission");
    expect(Object.keys(AGENT_TOOLS).sort()).toEqual(validatorTools.filter((tool) => tool !== "mission").sort());
  });
  test("parseTools normalizes and rejects", () => {
    expect(parseTools(" read ,grep,, glob ")).toEqual(["read", "grep", "glob"]);
    expect(() => parseTools("")).toThrow(/at least one tool/);
    expect(() => parseTools("read, ask")).toThrow(/specialists have no `ask`/);
    expect(() => parseTools("todo")).toThrow(/never get `todo`/);
    expect(() => parseTools("mission")).toThrow(/only `houston` and `flight`/);
    expect(() => parseTools("read, banana")).toThrow(/unknown tool `banana`/);
    expect(() => parseTools("read, read")).toThrow(/lists a name twice/);
  });
});

describe("parseSkills", () => {
  test("accepts none, and up to three is- names", () => {
    expect(parseSkills(undefined)).toEqual([]);
    expect(parseSkills("")).toEqual([]);
    expect(parseSkills("is-a, is-b, is-c")).toEqual(["is-a", "is-b", "is-c"]);
  });
  test("rejects more than three, bad names and a missing prefix", () => {
    expect(() => parseSkills("is-a, is-b, is-c, is-d")).toThrow(/at most 3/);
    expect(() => parseSkills("plain")).toThrow(/starting with `is-`/);
    expect(() => parseSkills("is-Bad")).toThrow(/kebab-case/);
  });
});

test("readOperatingRules copies the 7-bullet block from the existing agents", () => {
  const block = readOperatingRules(repo.newTree());
  expect(block.startsWith("## Operating rules\n\n- You never talk to the user")).toBe(true);
  expect(block.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(7);
  const booster = readFileSync(join(REPO_ROOT, "plugins/interstage/agents/booster.md"), "utf8");
  expect(booster).toContain(block);
});

describe("scaffoldAgent", () => {
  test("creates a validator-clean agent for every role", () => {
    for (const role of ["orchestrator", "planner", "coder", "reviewer", "scout"]) {
      const name = `gen-${role}`;
      const tree = repo.newTree();
      const { files } = scaffoldAgent(tree, { ...options, name, role });
      repo.flush(tree);
      const content = files[0]?.content ?? "";
      expect(content).toContain(`model: "@${role}, @default"`);
      expect(content.includes("`## Files changed`")).toBe(role === "coder");
      expect(repo.validate()).toEqual([]);
    }
  });

  test("autoloads existing core skills and stays validator-clean", () => {
    const tree = repo.newTree();
    const { files } = scaffoldAgent(tree, { ...options, name: "with-skills", skills: "is-adversarial-review" });
    repo.flush(tree);
    expect(files[0]?.content).toContain("autoload-skills: is-adversarial-review\n");
    expect(repo.validate()).toEqual([]);
  });

  test("every allowed tool passes the validator", () => {
    const tools = Object.keys(AGENT_TOOLS).join(", ");
    const tree = repo.newTree();
    const { files } = scaffoldAgent(tree, { ...options, name: "all-tools", tools });
    const findings = validateAgent("plugins/interstage/agents/all-tools.md", files[0]?.content ?? "", { skills: new Map(), agents: new Set(["all-tools"]) });
    expect(findings).toEqual([]);
  });

  test("notes the spawns requirement when the agent can delegate", () => {
    expect(scaffoldAgent(repo.newTree(), { ...options, name: "delegator", tools: "read, task" }).notes.join("\n")).toContain("set `spawns:`");
  });

  test("refuses to overwrite", () => {
    expect(() => scaffoldAgent(repo.newTree(), { ...options, name: "pogo" })).toThrow(/already exists/);
  });

  test("validates inputs", () => {
    const tree = repo.newTree();
    const bad: [Partial<AgentOptions>, RegExp][] = [
      [{ name: "Bad Name" }, /name must be lowercase kebab-case/],
      [{ name: "main" }, /reserved by OMP/],
      [{ description: "" }, /description is required/],
      [{ role: "capcom" }, /role must be one of/],
      [{ tools: "ask" }, /not allowed/],
      [{ skills: "is-no-such-skill" }, /does not exist in plugins\/interstage\/skills/],
      [{ skills: "is-forge" }, /does not exist in plugins\/interstage\/skills/],
    ];
    for (const [override, message] of bad) expect(() => scaffoldAgent(tree, { ...options, name: "fresh-one", ...override })).toThrow(message);
    expect(tree.listChanges()).toEqual([]);
  });
});
