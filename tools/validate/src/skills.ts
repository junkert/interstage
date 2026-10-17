import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter";
import { lintMarkdown } from "./lint";
import type { Finding } from "./types";

const ALLOWED_KEYS: Record<string, true> = {
  name: true,
  description: true,
  license: true,
  metadata: true,
  hide: true,
  "disable-model-invocation": true,
};

/** A skill may use up to this much over its manifest budget before the validator objects. */
export const BUDGET_SLACK = 1.2;
const MAX_DESCRIPTION_CHARS = 1024;
const MAX_REFERENCE_BYTES = 16 * 1024;

export interface SkillInfo {
  name: string;
  skillMdBytes: number;
}

/** Names of the `is-*` skill directories directly under a plugin's `skills/` directory. */
export function listSkillDirs(root: string, pluginRel: string): string[] {
  const dir = join(root, pluginRel, "skills");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Validate one skill directory. `knownSkills` is every skill name in the repo, used to resolve `skill://` links.
 * `budgetBytes` comes from `skills.manifest.json`.
 */
export function validateSkill(root: string, skillRel: string, knownSkills: Set<string>, budgetBytes: number | undefined): { findings: Finding[]; info?: SkillInfo } {
  const findings: Finding[] = [];
  const dirName = skillRel.split("/").pop() ?? "";
  const skillMdRel = `${skillRel}/SKILL.md`;
  const add = (rule: string, message: string, path = skillMdRel) => findings.push({ rule, path, message });

  if (!/^is-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(dirName)) {
    findings.push({ rule: "skill-dir", path: skillRel, message: "skill directories must be named `is-<kebab-case-name>`" });
  }
  const skillMdPath = join(root, skillMdRel);
  if (!existsSync(skillMdPath)) {
    findings.push({ rule: "skill-md", path: skillRel, message: "SKILL.md is missing" });
    return { findings };
  }
  const text = readFileSync(skillMdPath, "utf8");
  const bytes = Buffer.byteLength(text, "utf8");

  const parsed = parseFrontmatter(text);
  if ("error" in parsed) {
    add("skill-frontmatter", parsed.error);
    return { findings };
  }
  const { data } = parsed;
  for (const key of Object.keys(data)) {
    if (!ALLOWED_KEYS[key]) add("skill-frontmatter", `unknown frontmatter key \`${key}\` (\`compatibility\` is not used by Interstage)`);
  }
  if (data.name !== dirName) add("skill-frontmatter", `\`name\` \`${String(data.name)}\` must equal the directory name \`${dirName}\``);
  if (typeof data.description !== "string" || data.description.trim() === "") {
    add("skill-frontmatter", "`description` is required");
  } else if (data.description.length > MAX_DESCRIPTION_CHARS) {
    add("skill-frontmatter", `\`description\` is ${data.description.length} characters; the limit is ${MAX_DESCRIPTION_CHARS}`);
  }
  if (data.license !== "MIT") add("skill-frontmatter", "`license` must be `MIT`");

  if (budgetBytes === undefined) {
    add("skill-budget", "no `budgetBytes` in skills.manifest.json for this skill");
  } else if (bytes > Math.ceil(budgetBytes * BUDGET_SLACK)) {
    add("skill-budget", `SKILL.md is ${bytes} bytes, over its budget of ${budgetBytes} bytes (+${Math.round((BUDGET_SLACK - 1) * 100)}% allowed)`);
  }

  for (const match of text.matchAll(/skill:\/\/(is-[a-z0-9-]+)/g)) {
    const target = match[1] ?? "";
    if (!knownSkills.has(target)) add("skill-link", `\`skill://${target}\` does not match any skill`);
  }
  for (const match of text.matchAll(/\b(?:scripts|references)\/[A-Za-z0-9._-]+/g)) {
    if (!existsSync(join(root, skillRel, match[0]))) add("skill-link", `\`${match[0]}\` is referenced but does not exist`);
  }
  for (const match of text.matchAll(/\]\((?!https?:|#|skill:|mailto:)([^)\s]+)\)/g)) {
    const target = (match[1] ?? "").split("#")[0] ?? "";
    if (target !== "" && !existsSync(join(root, skillRel, target))) add("skill-link", `link target \`${target}\` does not exist`);
  }

  const referencesDir = join(root, skillRel, "references");
  if (existsSync(referencesDir)) {
    for (const file of readdirSync(referencesDir)) {
      const full = join(referencesDir, file);
      if (!statSync(full).isFile()) continue;
      if (statSync(full).size > MAX_REFERENCE_BYTES) add("skill-reference", `references/${file} is over ${MAX_REFERENCE_BYTES} bytes`, `${skillRel}/references/${file}`);
      if (file.endsWith(".md")) findings.push(...lintMarkdown(`${skillRel}/references/${file}`, readFileSync(full, "utf8")));
    }
  }

  findings.push(...lintMarkdown(skillMdRel, text));
  return { findings, info: { name: dirName, skillMdBytes: bytes } };
}
