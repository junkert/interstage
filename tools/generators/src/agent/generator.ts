import type { Tree } from "nx/src/devkit-exports";
import { scaffoldAgent, type AgentOptions } from "../lib/agent.ts";
import { formatReport } from "../lib/files.ts";

export default function agentGenerator(tree: Tree, options: AgentOptions): () => void {
  const { files, notes } = scaffoldAgent(tree, options);
  return () => console.log(formatReport(files, notes));
}
