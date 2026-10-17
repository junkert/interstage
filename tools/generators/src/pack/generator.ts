import type { Tree } from "nx/src/devkit-exports";
import { formatReport } from "../lib/files.ts";
import { scaffoldPack, type PackOptions } from "../lib/pack.ts";

export default function packGenerator(tree: Tree, options: PackOptions): () => void {
  const { files, notes } = scaffoldPack(tree, options);
  return () => console.log(formatReport(files, notes));
}
