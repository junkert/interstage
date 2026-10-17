import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FsTree, flushChanges } from "nx/src/generators/tree";
import { validateRepo } from "../../validate/src/checks";
import type { Finding } from "../../validate/src/types";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const COPIED = ["plugins", ".omp-plugin", "skills.manifest.json", "THIRD_PARTY_NOTICES.md"];

/** A temporary copy of the files the validator reads, so tests never touch the real repository. */
export function makeTempRepo(): { root: string; newTree: () => FsTree; flush: (tree: FsTree) => void; validate: () => Finding[]; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "interstage-generators-"));
  for (const entry of COPIED) cpSync(join(REPO_ROOT, entry), join(root, entry), { recursive: true });
  return {
    root,
    newTree: () => new FsTree(root, false),
    flush: (tree) => flushChanges(root, tree.listChanges()),
    validate: () => validateRepo(root),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export { REPO_ROOT };
