import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export default function interstage(pi: ExtensionAPI): void {
  pi.setLabel("Interstage");
  pi.registerFlag("interstage", {
    description: "Run this session as Interstage: CAPCOM talks to you and delegates to the specialist agents",
    type: "boolean",
    default: false,
  });
}
