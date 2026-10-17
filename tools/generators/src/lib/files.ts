import type { Tree } from "nx/src/devkit-exports";
import { assertInsideRepo } from "./names.ts";

/** Read a text file that must exist. */
export function readText(tree: Tree, path: string): string {
  const text = tree.read(path, "utf-8");
  if (text === null) throw new Error(`${path} does not exist; run the generator from the Interstage repository root`);
  return text;
}

/** Write a new file; refuses to overwrite and refuses paths outside the repository. */
export function createFile(tree: Tree, path: string, content: string): void {
  assertInsideRepo(path);
  if (tree.exists(path)) throw new Error(`${path} already exists; refusing to overwrite it`);
  tree.write(path, content);
}

/** Lines of `text` that contain a `Replace:` marker, with 1-based line numbers. */
export function findReplaceMarkers(text: string): { line: number; text: string }[] {
  const markers: { line: number; text: string }[] = [];
  text.split("\n").forEach((line, index) => {
    if (line.includes("Replace:")) markers.push({ line: index + 1, text: line.trim() });
  });
  return markers;
}

/** Console report printed after a generator's files are flushed. */
export function formatReport(created: { path: string; content: string }[], notes: string[]): string {
  const lines = ["Created:", ...created.map((file) => `  ${file.path}`)];
  const markers = created.flatMap((file) => findReplaceMarkers(file.content).map((marker) => `  ${file.path}:${marker.line}: ${marker.text}`));
  if (markers.length > 0) lines.push("", "Replace every marker before the result is real content:", ...markers);
  lines.push("", ...notes);
  return lines.join("\n");
}
