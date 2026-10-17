import type { Tree } from "nx/src/devkit-exports";
import { formatReport } from "../lib/files.ts";
import { scaffoldSkill, type SkillOptions } from "../lib/skill.ts";

export default function skillGenerator(tree: Tree, options: SkillOptions): () => void {
  const { files, notes } = scaffoldSkill(tree, options);
  return () => console.log(formatReport(files, notes));
}
