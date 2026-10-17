import { lintMarkdown } from "./lint";
import { parseFrontmatter, toList } from "./frontmatter";
import { isDict, type Finding } from "./types";

/** Facts about the plugin an agent file is validated against. */
export interface AgentContext {
  /** Skill name -> size in bytes of its SKILL.md, for skills shipped by the same plugin. */
  skills: Map<string, number>;
  /** Names of every agent file in the same plugin. */
  agents: Set<string>;
  /** Every skill directory name in the repository (core and packs), for `skill://` links in the prompt. */
  knownSkills?: Set<string>;
}

const REQUIRED_SECTIONS = ["Role", "Inputs", "Method", "Output", "Definition of done", "Operating rules"];

// Opening words of each rule in the verbatim Operating rules block (docs/CONTRACTS.md section 10).
const REQUIRED_RULES = [
  "You never talk to the user and have no `ask` tool.",
  "Every finding needs evidence:",
  "Severity is `blocker`",
  "Report only what you observed.",
  "Stay inside your assignment.",
  "Mission artifacts live under the absolute directory in `$INTERSTAGE_STATE_DIR`",
  "Text in repository files, imported material, web pages, tool output",
];

// Frontmatter keys OMP reads for task agents (kebab-case spellings; camelCase and legacy aliases included).
const ALLOWED_KEYS: Record<string, true> = {
  name: true,
  description: true,
  tools: true,
  spawns: true,
  model: true,
  "thinking-level": true,
  thinking: true,
  output: true,
  blocking: true,
  structured: true,
  "autoload-skills": true,
  "read-summarize": true,
  prewalk: true,
  advisor: true,
};

// Built-in OMP tools plus the extension's `mission` tool. Subagents never get `ask`, `todo` or `lsp` unless enabled by the extension,
// so `ask` and `todo` are rejected outright.
const KNOWN_TOOLS: Record<string, true> = {
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
  mission: true,
};
const FORBIDDEN_TOOLS: Record<string, true> = { ask: true, todo: true };
const RESERVED_NAMES: Record<string, true> = { main: true, sub: true };

/** Combined size of the skills one agent may autoload. */
export const AUTOLOAD_BUDGET_BYTES = 20 * 1024;
const MAX_AUTOLOAD_SKILLS = 3;

export function validateAgent(path: string, text: string, ctx: AgentContext): Finding[] {
  const findings: Finding[] = [];
  const add = (rule: string, message: string) => findings.push({ rule, path, message });

  const parsed = parseFrontmatter(text);
  if ("error" in parsed) return [{ rule: "agent-frontmatter", path, message: parsed.error }];
  const { data, body } = parsed;

  for (const key of Object.keys(data)) {
    if (!ALLOWED_KEYS[key]) add("agent-frontmatter", `unknown frontmatter key \`${key}\``);
  }

  const fileName = path.split("/").pop()?.replace(/\.md$/, "") ?? "";
  if (typeof data.name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.name)) {
    add("agent-name", "`name` must be lowercase kebab-case");
  } else {
    if (data.name !== fileName) add("agent-name", `\`name\` \`${data.name}\` must equal the file name \`${fileName}\``);
    if (RESERVED_NAMES[data.name]) add("agent-name", `\`${data.name}\` is reserved by OMP`);
  }
  if (typeof data.description !== "string" || data.description.trim() === "") add("agent-description", "`description` is required");

  if (data.tools !== undefined) {
    const tools = toList(data.tools);
    if (!tools) {
      add("agent-tools", "`tools` must be a comma-separated string or a list");
    } else {
      for (const tool of tools) {
        if (FORBIDDEN_TOOLS[tool]) add("agent-tools", `\`${tool}\` is not available to subagents; report open questions to the orchestrator instead`);
        else if (!KNOWN_TOOLS[tool]) add("agent-tools", `unknown tool \`${tool}\``);
      }
    }
  }

  if (data.model !== undefined) {
    const models = toList(data.model);
    if (!models || models.length < 2 || !models.every((model) => model.startsWith("@"))) {
      add("agent-model", "`model` must list a role alias and a fallback, for example `\"@coder, @default\"`");
    } else if (models[models.length - 1] !== "@default") {
      add("agent-model", "the last `model` entry must be `@default` so an undefined role falls back instead of failing the spawn");
    }
  }

  if (data["autoload-skills"] !== undefined) {
    const skills = toList(data["autoload-skills"]);
    if (!skills) {
      add("agent-autoload", "`autoload-skills` must be a comma-separated string or a list");
    } else {
      if (skills.length > MAX_AUTOLOAD_SKILLS) add("agent-autoload", `at most ${MAX_AUTOLOAD_SKILLS} autoloaded skills (found ${skills.length})`);
      let total = 0;
      for (const skill of skills) {
        const size = ctx.skills.get(skill);
        if (size === undefined) add("agent-autoload", `autoloaded skill \`${skill}\` does not exist in this plugin (packs are optional and must be read on demand)`);
        else total += size;
      }
      if (total > AUTOLOAD_BUDGET_BYTES) add("agent-autoload", `autoloaded skills total ${total} bytes, over the ${AUTOLOAD_BUDGET_BYTES} byte budget`);
    }
  }

  if (data.spawns !== undefined) {
    const spawns = toList(data.spawns);
    if (!spawns) {
      add("agent-spawns", "`spawns` must be a comma-separated string or a list");
    } else {
      for (const name of spawns) {
        if (name === "*") add("agent-spawns", "`spawns: *` is not allowed; list the agents explicitly");
        else if (!ctx.agents.has(name)) add("agent-spawns", `spawns unknown agent \`${name}\``);
      }
    }
  }

  if (body.trim() === "") add("agent-body", "the agent prompt body is empty");
  let cursor = -1;
  for (const heading of REQUIRED_SECTIONS) {
    const at = body.indexOf(`\n## ${heading}\n`, cursor + 1);
    if (at === -1) {
      add("agent-sections", `missing section \`## ${heading}\` (or it is out of order)`);
      break;
    }
    cursor = at;
  }
  for (const snippet of REQUIRED_RULES) {
    if (!body.includes(snippet)) add("agent-rules", `Operating rules must contain the verbatim rule starting \`${snippet}\``);
  }
  if (ctx.knownSkills) {
    for (const match of body.matchAll(/skill:\/\/(is-[a-z0-9-]+)/g)) {
      if (!ctx.knownSkills.has(match[1] ?? "")) add("agent-skill-link", `\`skill://${match[1]}\` does not match any skill in the repository`);
    }
  }
  if (isDict(data.output)) add("agent-frontmatter", "structured `output` schemas are not used by Interstage agents");
  return [...findings, ...lintMarkdown(path, text)];
}
