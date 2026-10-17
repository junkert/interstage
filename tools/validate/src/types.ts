export interface Finding {
  rule: string;
  path: string;
  message: string;
}

export type Dict = Record<string, unknown>;

export function isDict(value: unknown): value is Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
