const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Throw unless `value` is lowercase kebab-case (letters and digits joined by single hyphens). */
export function assertKebab(label: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !KEBAB.test(value)) {
    throw new Error(`${label} must be lowercase kebab-case (letters and digits joined by single hyphens), got ${JSON.stringify(value)}`);
  }
}

/** Throw unless `value` is a non-empty single-line string of at most `max` characters. */
export function assertLine(label: string, value: unknown, max: number): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is required`);
  if (/[\r\n]/.test(value)) throw new Error(`${label} must be a single line`);
  if (value.length > max) throw new Error(`${label} is ${value.length} characters; the limit is ${max}`);
}

/** `my-skill` -> `My Skill`. */
export function titleCase(name: string): string {
  return name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Throw unless `path` is a normalized, repo-relative path that stays inside the repository. */
export function assertInsideRepo(path: string): void {
  if (path.startsWith("/") || path.split("/").some((segment) => segment === ".." || segment === "." || segment === "")) {
    throw new Error(`refusing to write outside the repository: ${path}`);
  }
}

/** Render a string as a YAML scalar: plain when that parses back to the same string, otherwise double-quoted. */
export function yamlScalar(value: string): string {
  const plain = /^[A-Za-z][A-Za-z0-9 .,()/_+'-]*[A-Za-z0-9.)]$/.test(value) && !/^(?:true|false|null|yes|no|on|off)$/i.test(value);
  return plain ? value : JSON.stringify(value);
}
