import type { Tree } from "nx/src/devkit-exports";
import { createFile } from "./files.ts";
import { assertKebab, assertLine, titleCase, yamlScalar } from "./names.ts";
import type { Scaffolded } from "./skill.ts";

export const ROLES = ["orchestrator", "planner", "coder", "reviewer", "scout"];

/**
 * Tools a generated agent may list. This is the validator's known set (tools/validate/src/agents.ts) without `mission`,
 * which only `houston` and `flight` carry; a test compares the two lists. The generators run under Node, which cannot
 * import the validator's extensionless sources, so the list is repeated here.
 */
export const AGENT_TOOLS: Record<string, true> = {
  read: true,
  bash: true,
  edit: true,
  write: true,
  grep: true,
  glob: true,
  find: true,
  lsp: true,
  ast_grep: true,
  ast_edit: true,
  debug: true,
  eval: true,
  github: true,
  task: true,
  wait: true,
  web_search: true,
  think: true,
  recall: true,
  retain: true,
  reflect: true,
};

const FORBIDDEN_TOOLS: Record<string, string> = {
  ask: "specialists have no `ask`; they report open questions to the orchestrator",
  todo: "agents never get `todo`",
  mission: "only `houston` and `flight` carry `mission`",
};
const RESERVED_NAMES: Record<string, true> = { main: true, sub: true };
const MAX_AUTOLOAD_SKILLS = 3;
const AUTOLOAD_BUDGET_BYTES = 20 * 1024;
const AGENTS_DIR = "plugins/interstage/agents";
const CORE_SKILLS_DIR = "plugins/interstage/skills";
const OPERATING_RULES_HEADING = "## Operating rules";

export interface AgentOptions {
  name: string;
  description: string;
  role: string;
  /** Comma-separated tool names. */
  tools: string;
  /** Comma-separated autoload skill names (`is-<name>`), at most three, all in the core plugin. */
  skills?: string | undefined;
}

function splitList(label: string, value: unknown): string[] {
  if (typeof value !== "string") throw new Error(`${label} must be a comma-separated list`);
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  if (new Set(items).size !== items.length) throw new Error(`${label} lists a name twice`);
  return items;
}

/** Validate a comma-separated tool list and return the names. */
export function parseTools(value: unknown): string[] {
  const tools = splitList("tools", value);
  if (tools.length === 0) throw new Error("tools needs at least one tool");
  for (const tool of tools) {
    const reason = FORBIDDEN_TOOLS[tool];
    if (reason !== undefined) throw new Error(`tool \`${tool}\` is not allowed: ${reason}`);
    if (!AGENT_TOOLS[tool]) throw new Error(`unknown tool \`${tool}\`; known tools: ${Object.keys(AGENT_TOOLS).join(", ")}`);
  }
  return tools;
}

/** Validate the autoload skill list shape and return the names (existence and size are checked against the tree). */
export function parseSkills(value: unknown): string[] {
  const skills = value === undefined || value === "" ? [] : splitList("skills", value);
  if (skills.length > MAX_AUTOLOAD_SKILLS) throw new Error(`at most ${MAX_AUTOLOAD_SKILLS} autoload skills (got ${skills.length})`);
  for (const skill of skills) {
    assertKebab("skill", skill);
    if (!skill.startsWith("is-")) throw new Error(`skill ${skill} must be a skill directory name starting with \`is-\``);
  }
  return skills;
}

/**
 * The Operating rules block, read from the shortest block found in the existing agent files (extensions only add to it),
 * so the agents stay the single source of truth for the verbatim text.
 */
export function readOperatingRules(tree: Tree): string {
  let shortest: string | undefined;
  for (const file of tree.children(AGENTS_DIR).filter((entry) => entry.endsWith(".md"))) {
    const text = tree.read(`${AGENTS_DIR}/${file}`, "utf-8") ?? "";
    const start = text.indexOf(`\n${OPERATING_RULES_HEADING}\n`);
    if (start === -1) continue;
    const rest = text.slice(start + 1);
    const next = rest.indexOf("\n## ", OPERATING_RULES_HEADING.length);
    const block = (next === -1 ? rest : rest.slice(0, next)).trim();
    if (shortest === undefined || block.length < shortest.length) shortest = block;
  }
  if (shortest === undefined) throw new Error(`no agent in ${AGENTS_DIR} has an "${OPERATING_RULES_HEADING}" section to copy`);
  return shortest;
}

/** Agent prompt skeleton. Every `Replace:` line is a placeholder the author must rewrite. */
export function renderAgent(options: Omit<AgentOptions, "tools" | "skills"> & { tools: string[]; skills: string[] }, operatingRules: string): string {
  const frontmatter = [
    "---",
    `name: ${options.name}`,
    `description: ${yamlScalar(options.description)}`,
    `tools: ${options.tools.join(", ")}`,
    `model: "@${options.role}, @default"`,
  ];
  if (options.skills.length > 0) frontmatter.push(`autoload-skills: ${options.skills.join(", ")}`);
  frontmatter.push("---");
  const filesChanged = options.role === "coder" ? "`## Files changed`, " : "";
  return `${frontmatter.join("\n")}

# ${titleCase(options.name)}

## Role

Replace: who you are in one paragraph, what you decide, and what you never do. State that you report open questions to your orchestrator.

## Inputs

- Replace: what the assignment provides and what you read from the repository.

## Method

1. Replace: the first step, stated as an action with an observable result.
2. Replace: the next step. Add steps until the method is complete.

## Output

End with the final report: \`## Result\` (one paragraph), \`## Evidence\` (bullets with \`file:line\` or command output), ${filesChanged}\`## Open questions\`.

Replace: anything specific to this agent that comes before the final report.

## Definition of done

- Replace: one observable condition per bullet.

${operatingRules}
`;
}

/** Validate the options, then create `plugins/interstage/agents/<name>.md` in `tree`. */
export function scaffoldAgent(tree: Tree, options: AgentOptions): Scaffolded {
  assertKebab("name", options.name);
  if (RESERVED_NAMES[options.name]) throw new Error(`${options.name} is reserved by OMP`);
  assertLine("description", options.description, 1024);
  if (!ROLES.includes(options.role)) throw new Error(`role must be one of ${ROLES.join(", ")}, got ${JSON.stringify(options.role)}`);
  const tools = parseTools(options.tools);
  const skills = parseSkills(options.skills);

  let skillBytes = 0;
  for (const skill of skills) {
    const text = tree.read(`${CORE_SKILLS_DIR}/${skill}/SKILL.md`, "utf-8");
    if (text === null) throw new Error(`autoload skill ${skill} does not exist in ${CORE_SKILLS_DIR} (pack skills are read on demand, not autoloaded)`);
    skillBytes += Buffer.byteLength(text, "utf8");
  }
  if (skillBytes > AUTOLOAD_BUDGET_BYTES) throw new Error(`autoload skills total ${skillBytes} bytes, over the ${AUTOLOAD_BUDGET_BYTES} byte budget`);

  const path = `${AGENTS_DIR}/${options.name}.md`;
  const content = renderAgent({ ...options, tools, skills }, readOperatingRules(tree));
  createFile(tree, path, content);
  const notes = ["Add the agent to the `spawns` list of each orchestrator that delegates to it, then check with: bun run tools/validate/src/cli.ts ."];
  if (tools.includes("task")) notes.push("This agent has the `task` tool: set `spawns:` in its frontmatter to explicit agent names (`*` is rejected).");
  return { files: [{ path, content }], notes };
}
