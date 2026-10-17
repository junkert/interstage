import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { validateAgent, type AgentContext } from "./agents";
import { parseFrontmatter } from "./frontmatter";
import { lintMarkdown } from "./lint";
import { listSkillDirs, validateSkill } from "./skills";
import { isDict, type Finding } from "./types";

export interface PluginContext {
  /** Every skill directory name in the repo, for `skill://` links. */
  knownSkills: Set<string>;
  /** `skills.manifest.json` entries by repo-relative path. */
  manifestSkills: Map<string, { budgetBytes: number | undefined }>;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function listMarkdown(root: string, rel: string): string[] {
  const dir = join(root, rel);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .sort();
}

function validateMcp(root: string, pluginRel: string): Finding[] {
  const findings: Finding[] = [];
  const rel = `${pluginRel}/.mcp.json`;
  if (existsSync(join(root, pluginRel, "mcp.json"))) {
    findings.push({ rule: "mcp-filename", path: `${pluginRel}/mcp.json`, message: "marketplace plugins only load `.mcp.json`; a root `mcp.json` is silently ignored" });
  }
  if (!existsSync(join(root, rel))) return findings;
  let config: unknown;
  try {
    config = readJson(join(root, rel));
  } catch (error) {
    return [...findings, { rule: "mcp-json", path: rel, message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` }];
  }
  if (!isDict(config) || !isDict(config.mcpServers)) {
    return [...findings, { rule: "mcp-shape", path: rel, message: "must be an object with an `mcpServers` object" }];
  }
  for (const [name, server] of Object.entries(config.mcpServers)) {
    if (!isDict(server)) {
      findings.push({ rule: "mcp-shape", path: rel, message: `server \`${name}\` must be an object` });
    } else if (typeof server.command === "string") {
      continue;
    } else if ((server.type === "http" || server.type === "sse") && typeof server.url === "string" && server.url.startsWith("https://")) {
      continue;
    } else {
      findings.push({ rule: "mcp-shape", path: rel, message: `server \`${name}\` needs a \`command\`, or \`type\` http/sse with an https \`url\`` });
    }
  }
  return findings;
}

/** Validate one plugin directory: manifest, MCP config, commands, skills and agents. */
export function validatePlugin(root: string, pluginRel: string, ctx: PluginContext): Finding[] {
  const findings: Finding[] = [];
  const pkgRel = `${pluginRel}/package.json`;
  if (!existsSync(join(root, pkgRel))) return [{ rule: "plugin-package", path: pkgRel, message: "package.json is required" }];

  try {
    const pkg = readJson(join(root, pkgRel));
    const extensions = isDict(pkg) && isDict(pkg.omp) ? pkg.omp.extensions : undefined;
    if (extensions !== undefined) {
      if (!Array.isArray(extensions) || !extensions.every((entry) => typeof entry === "string")) {
        findings.push({ rule: "plugin-extension", path: pkgRel, message: "`omp.extensions` must be an array of paths" });
      } else {
        for (const entry of extensions) {
          if (!existsSync(join(root, pluginRel, entry))) findings.push({ rule: "plugin-extension", path: pkgRel, message: `extension entry \`${entry}\` does not exist` });
        }
      }
    }
  } catch (error) {
    return [{ rule: "plugin-package", path: pkgRel, message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` }];
  }

  findings.push(...validateMcp(root, pluginRel));

  for (const file of listMarkdown(root, `${pluginRel}/commands`)) {
    const rel = `${pluginRel}/commands/${file}`;
    const text = readFileSync(join(root, rel), "utf8");
    const parsed = parseFrontmatter(text);
    if ("error" in parsed) findings.push({ rule: "command-frontmatter", path: rel, message: parsed.error });
    else if (typeof parsed.data.description !== "string" || parsed.data.description.trim() === "") findings.push({ rule: "command-frontmatter", path: rel, message: "`description` is required" });
    findings.push(...lintMarkdown(rel, text));
  }

  const skills = new Map<string, number>();
  for (const dir of listSkillDirs(root, pluginRel)) {
    const skillRel = `${pluginRel}/skills/${dir}`;
    const entry = ctx.manifestSkills.get(skillRel);
    if (!entry) findings.push({ rule: "skill-manifest", path: skillRel, message: "skill is not listed in skills.manifest.json" });
    const result = validateSkill(root, skillRel, ctx.knownSkills, entry?.budgetBytes);
    findings.push(...result.findings);
    if (result.info) skills.set(result.info.name, result.info.skillMdBytes);
  }

  const agentFiles = listMarkdown(root, `${pluginRel}/agents`);
  const agentCtx: AgentContext = { skills, agents: new Set(agentFiles.map((file) => file.replace(/\.md$/, ""))) };
  for (const file of agentFiles) {
    const rel = `${pluginRel}/agents/${file}`;
    findings.push(...validateAgent(rel, readFileSync(join(root, rel), "utf8"), agentCtx));
  }
  return findings;
}
