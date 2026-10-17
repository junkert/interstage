import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { validatePlugin, type PluginContext } from "./plugin";
import { listSkillDirs } from "./skills";
import { isDict, type Dict, type Finding } from "./types";

export type { Finding } from "./types";

// OMP marketplace and plugin names: ASCII letters, digits, hyphens and dots,
// starting and ending with a letter or digit, at most 64 characters.
const NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,62}[A-Za-z0-9])?$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA_RE = /^[0-9a-f]{40}$/;

const UPSTREAM_COPYRIGHT = "Copyright (c) 2025 lexykwaii";

function readJson(root: string, rel: string): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(readFileSync(join(root, rel), "utf8")) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function isDir(root: string, rel: string): boolean {
  const full = join(root, rel);
  return existsSync(full) && statSync(full).isDirectory();
}

/** `.omp-plugin/marketplace.json` and the plugin directories it points at. */
export function checkMarketplace(root: string): Finding[] {
  const rel = ".omp-plugin/marketplace.json";
  if (!existsSync(join(root, rel))) return [];

  const parsed = readJson(root, rel);
  if ("error" in parsed) {
    return [{ rule: "marketplace-json", path: rel, message: `invalid JSON: ${parsed.error}` }];
  }
  const catalog = parsed.value;
  const findings: Finding[] = [];
  const add = (rule: string, message: string, path = rel) => findings.push({ rule, path, message });

  if (!isDict(catalog)) return [{ rule: "marketplace-shape", path: rel, message: "catalog must be an object" }];
  if (typeof catalog.name !== "string" || !NAME_RE.test(catalog.name)) {
    add("marketplace-name", "`name` must be 1-64 ASCII letters, digits, hyphens or dots, starting and ending with a letter or digit");
  }
  if (!isDict(catalog.owner) || typeof catalog.owner.name !== "string" || catalog.owner.name === "") {
    add("marketplace-owner", "`owner.name` is required");
  }
  if (!Array.isArray(catalog.plugins)) {
    add("marketplace-plugins", "`plugins` must be an array");
    return findings;
  }

  const seen = new Set<string>();
  catalog.plugins.forEach((plugin: unknown, index: number) => {
    const where = `plugins[${index}]`;
    if (!isDict(plugin)) return add("plugin-shape", `${where} must be an object`);
    const { name, source, version } = plugin;
    if (typeof name !== "string" || !NAME_RE.test(name)) return add("plugin-name", `${where}.name is invalid`);
    if (seen.has(name.toLowerCase())) add("plugin-duplicate", `plugin name \`${name}\` is duplicated (names are case-insensitive)`);
    seen.add(name.toLowerCase());
    if (typeof version !== "string" || !SEMVER_RE.test(version)) {
      add("plugin-version", `\`${name}\` needs a semver \`version\``);
    }
    if (typeof source !== "string" || !source.startsWith("./")) {
      return add("plugin-source", `\`${name}\`.source must be a relative path starting with ./`);
    }
    const dir = source.slice(2);
    if (!isDir(root, dir)) return add("plugin-source", `\`${name}\`.source \`${source}\` is not a directory`);

    const pkgRel = `${dir}/package.json`;
    const pkg = existsSync(join(root, pkgRel)) ? readJson(root, pkgRel) : { error: "missing" };
    if ("error" in pkg) {
      return add("plugin-package", `\`${name}\` needs a valid package.json (${pkg.error})`, pkgRel);
    }
    if (!isDict(pkg.value)) return add("plugin-package", "package.json must be an object", pkgRel);
    if (pkg.value.name !== name) add("plugin-package", `package.json name \`${String(pkg.value.name)}\` must equal catalog name \`${name}\``, pkgRel);
    if (pkg.value.version !== version) {
      add("plugin-package", `package.json version \`${String(pkg.value.version)}\` must equal catalog version \`${String(version)}\``, pkgRel);
    }
  });
  return findings;
}

function checkSkillEntries(root: string, skills: unknown[], rel: string, seenPaths: Set<string>): Finding[] {
  const findings: Finding[] = [];
  const add = (rule: string, message: string) => findings.push({ rule, path: rel, message });
  skills.forEach((skill: unknown, index: number) => {
    const where = `skills[${index}]`;
    if (!isDict(skill)) return add("manifest-skills", `${where} must be an object`);
    if (typeof skill.name !== "string" || !/^is-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name)) {
      add("manifest-skills", `${where}.name must start with \`is-\` and be lowercase kebab-case`);
    }
    if (typeof skill.path !== "string" || !isDir(root, skill.path)) {
      add("manifest-skills", `${where}.path must be an existing directory`);
    } else {
      if (seenPaths.has(skill.path)) add("manifest-skills", `${where}.path \`${skill.path}\` is listed twice`);
      seenPaths.add(skill.path);
      if (skill.name !== skill.path.split("/").pop()) add("manifest-skills", `${where}.name must equal the last segment of its path`);
    }
    if (typeof skill.modified !== "boolean") add("manifest-skills", `${where}.modified must be a boolean`);
    if (typeof skill.budgetBytes !== "number" || !Number.isInteger(skill.budgetBytes) || skill.budgetBytes <= 0) {
      add("manifest-skills", `${where}.budgetBytes must be a positive integer (the SKILL.md size target)`);
    }
    if (skill.origin !== "upstream" && skill.origin !== "authored") add("manifest-skills", `${where}.origin must be \`upstream\` or \`authored\``);
    if (skill.origin === "upstream" && !(Array.isArray(skill.from) && skill.from.length > 0 && skill.from.every((s: unknown) => typeof s === "string"))) {
      add("manifest-skills", `${where}.from must list the upstream skill names it derives from`);
    }
  });
  return findings;
}

/** `skills.manifest.json`: provenance and size budget of every vendored or authored skill. */
export function checkSkillsManifest(root: string): Finding[] {
  const rel = "skills.manifest.json";
  if (!existsSync(join(root, rel))) {
    return [{ rule: "manifest-missing", path: rel, message: "skills.manifest.json is required" }];
  }
  const parsed = readJson(root, rel);
  if ("error" in parsed) return [{ rule: "manifest-json", path: rel, message: `invalid JSON: ${parsed.error}` }];
  const manifest = parsed.value;
  if (!isDict(manifest)) return [{ rule: "manifest-shape", path: rel, message: "manifest must be an object" }];

  const findings: Finding[] = [];
  const add = (rule: string, message: string) => findings.push({ rule, path: rel, message });
  const upstream = manifest.upstream;
  if (!isDict(upstream)) {
    add("manifest-upstream", "`upstream` object is required");
  } else {
    if (typeof upstream.repo !== "string" || !upstream.repo.startsWith("https://")) add("manifest-upstream", "`upstream.repo` must be an https URL");
    if (typeof upstream.sha !== "string" || !SHA_RE.test(upstream.sha)) add("manifest-upstream", "`upstream.sha` must be a 40-character lowercase hex commit");
    if (upstream.license !== "MIT") add("manifest-upstream", "`upstream.license` must be `MIT`");
  }
  if (!Array.isArray(manifest.skills)) {
    add("manifest-skills", "`skills` must be an array");
    return findings;
  }
  findings.push(...checkSkillEntries(root, manifest.skills, rel, new Set<string>()));
  return findings;
}

/** Per-batch manifest fragments, merged into `skills.manifest.json` once a batch is integrated. */
const FRAGMENTS_DIR = "skills.manifest.fragments";

function fragmentFiles(root: string): string[] {
  if (!isDir(root, FRAGMENTS_DIR)) return [];
  return readdirSync(join(root, FRAGMENTS_DIR))
    .filter((file) => file.endsWith(".json"))
    .sort();
}

/** Each fragment is a JSON array of skill entries with the same shape as `skills.manifest.json#skills`. */
export function checkManifestFragments(root: string): Finding[] {
  const findings: Finding[] = [];
  const seenPaths = new Set<string>();
  for (const file of fragmentFiles(root)) {
    const rel = `${FRAGMENTS_DIR}/${file}`;
    const parsed = readJson(root, rel);
    if ("error" in parsed) {
      findings.push({ rule: "manifest-json", path: rel, message: `invalid JSON: ${parsed.error}` });
    } else if (!Array.isArray(parsed.value)) {
      findings.push({ rule: "manifest-shape", path: rel, message: "a fragment must be a JSON array of skill entries" });
    } else {
      findings.push(...checkSkillEntries(root, parsed.value, rel, seenPaths));
    }
  }
  return findings;
}

/** `THIRD_PARTY_NOTICES.md` must carry the upstream notice and the pinned commit. */
export function checkNotices(root: string): Finding[] {
  const rel = "THIRD_PARTY_NOTICES.md";
  if (!existsSync(join(root, rel))) return [{ rule: "notices-missing", path: rel, message: "THIRD_PARTY_NOTICES.md is required" }];
  const text = readFileSync(join(root, rel), "utf8");
  const findings: Finding[] = [];
  if (!text.includes(UPSTREAM_COPYRIGHT)) {
    findings.push({ rule: "notices-license", path: rel, message: `must include the upstream notice \`${UPSTREAM_COPYRIGHT}\` and the MIT license text` });
  }
  const manifest = existsSync(join(root, "skills.manifest.json")) ? readJson(root, "skills.manifest.json") : undefined;
  if (manifest && "value" in manifest && isDict(manifest.value) && isDict(manifest.value.upstream)) {
    const sha = manifest.value.upstream.sha;
    if (typeof sha === "string" && SHA_RE.test(sha) && !text.includes(sha)) {
      findings.push({ rule: "notices-sha", path: rel, message: "must cite the same upstream commit as skills.manifest.json" });
    }
  }
  return findings;
}

/** Plugin directories listed by the marketplace catalog (repo-relative). */
function catalogPluginDirs(root: string): string[] {
  const parsed = existsSync(join(root, ".omp-plugin/marketplace.json")) ? readJson(root, ".omp-plugin/marketplace.json") : undefined;
  if (!parsed || "error" in parsed || !isDict(parsed.value) || !Array.isArray(parsed.value.plugins)) return [];
  return parsed.value.plugins
    .filter((plugin: unknown): plugin is Dict & { source: string } => isDict(plugin) && typeof plugin.source === "string" && plugin.source.startsWith("./"))
    .map((plugin: { source: string }) => plugin.source.slice(2))
    .filter((dir: string) => isDir(root, dir));
}

function pluginContext(root: string): PluginContext {
  const knownSkills = new Set<string>();
  if (isDir(root, "plugins")) {
    for (const plugin of readdirSync(join(root, "plugins"))) for (const skill of listSkillDirs(root, `plugins/${plugin}`)) knownSkills.add(skill);
  }
  const manifestSkills = new Map<string, { budgetBytes: number | undefined }>();
  const entries: unknown[] = [];
  const manifest = existsSync(join(root, "skills.manifest.json")) ? readJson(root, "skills.manifest.json") : undefined;
  if (manifest && "value" in manifest && isDict(manifest.value) && Array.isArray(manifest.value.skills)) entries.push(...manifest.value.skills);
  for (const file of fragmentFiles(root)) {
    const fragment = readJson(root, `${FRAGMENTS_DIR}/${file}`);
    if ("value" in fragment && Array.isArray(fragment.value)) entries.push(...fragment.value);
  }
  for (const skill of entries) {
    if (isDict(skill) && typeof skill.path === "string") {
      manifestSkills.set(skill.path, { budgetBytes: typeof skill.budgetBytes === "number" ? skill.budgetBytes : undefined });
    }
  }
  return { knownSkills, manifestSkills };
}

/**
 * Validate the repository. With `options.plugin` (a repo-relative plugin directory) only that
 * plugin is checked; this is what each plugin's Nx `validate` target runs.
 */
export function validateRepo(root: string, options: { plugin?: string } = {}): Finding[] {
  const ctx = pluginContext(root);
  if (options.plugin !== undefined) return validatePlugin(root, options.plugin, ctx);
  const plugins = catalogPluginDirs(root).flatMap((dir) => validatePlugin(root, dir, ctx));
  return [...checkMarketplace(root), ...checkSkillsManifest(root), ...checkManifestFragments(root), ...checkNotices(root), ...plugins];
}
