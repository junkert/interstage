export interface SkillEntry {
  name: string;
  path: string;
  origin: "authored";
  modified: false;
  budgetBytes: number;
}

export interface MarketplaceEntry {
  name: string;
  description: string;
  source: string;
  version: string;
  category: string;
  keywords: string[];
  license: string;
}

function hasName(list: unknown[], name: string): boolean {
  return list.some((item) => typeof item === "object" && item !== null && (item as { name?: unknown }).name === name);
}

/** Insert before the first entry whose name sorts after `entry.name` (appends otherwise); existing order is kept. */
function insertSorted<T extends { name: string }>(list: unknown[], entry: T): unknown[] {
  const at = list.findIndex((item) => typeof item === "object" && item !== null && String((item as { name?: unknown }).name) > entry.name);
  return at === -1 ? [...list, entry] : [...list.slice(0, at), entry, ...list.slice(at)];
}

function parseObject(text: string, file: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${file} must be a JSON object`);
  return value as Record<string, unknown>;
}

/** Add an entry to the text of `skills.manifest.json`. Refuses a duplicate name or path. */
export function addSkillEntry(text: string, entry: SkillEntry): string {
  const manifest = parseObject(text, "skills.manifest.json");
  if (!Array.isArray(manifest.skills)) throw new Error("skills.manifest.json needs a `skills` array");
  if (hasName(manifest.skills, entry.name)) throw new Error(`skills.manifest.json already lists ${entry.name}`);
  if (manifest.skills.some((item: unknown) => typeof item === "object" && item !== null && (item as { path?: unknown }).path === entry.path)) {
    throw new Error(`skills.manifest.json already lists the path ${entry.path}`);
  }
  return `${JSON.stringify({ ...manifest, skills: insertSorted(manifest.skills, entry) }, null, 2)}\n`;
}

/** Add a plugin to the text of `.omp-plugin/marketplace.json`. Refuses a duplicate name (names are case-insensitive). */
export function addMarketplacePlugin(text: string, entry: MarketplaceEntry): string {
  const catalog = parseObject(text, ".omp-plugin/marketplace.json");
  if (!Array.isArray(catalog.plugins)) throw new Error(".omp-plugin/marketplace.json needs a `plugins` array");
  const lower = entry.name.toLowerCase();
  if (catalog.plugins.some((item: unknown) => typeof item === "object" && item !== null && String((item as { name?: unknown }).name).toLowerCase() === lower)) {
    throw new Error(`.omp-plugin/marketplace.json already lists ${entry.name}`);
  }
  return `${JSON.stringify({ ...catalog, plugins: insertSorted(catalog.plugins, entry) }, null, 2)}\n`;
}
