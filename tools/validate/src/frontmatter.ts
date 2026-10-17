export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

const BLOCK = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

/** Parse a markdown file's YAML frontmatter. Returns `{ error }` when it is missing or malformed. */
export function parseFrontmatter(text: string): Frontmatter | { error: string } {
  const match = BLOCK.exec(text);
  if (!match) return { error: "missing frontmatter block (--- ... ---)" };
  let data: unknown;
  try {
    data = Bun.YAML.parse(match[1] ?? "");
  } catch (error) {
    return { error: `frontmatter is not valid YAML: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { error: "frontmatter must be a YAML mapping" };
  }
  return { data: data as Record<string, unknown>, body: match[2] ?? "" };
}

/** Accept a comma-separated string or an array of strings. `undefined` when the value is neither. */
export function toList(value: unknown): string[] | undefined {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return (value as string[]).map((item) => item.trim()).filter((item) => item !== "");
  }
  return undefined;
}
