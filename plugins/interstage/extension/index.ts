import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { createRuntime, registerActivation } from "./activation";
import { registerCommands } from "./commands";
import { registerHooks } from "./hooks";
import { registerMissionTool } from "./tools";

export default function interstage(pi: ExtensionAPI): void {
  pi.setLabel("Interstage");
  const runtime = createRuntime();
  registerActivation(pi, runtime);
  registerMissionTool(pi);
  registerHooks(pi, runtime);
  registerCommands(pi, runtime);
}
