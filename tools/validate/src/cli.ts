import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateRepo } from "./checks";
import { validateTodo } from "./todo";
import type { Finding } from "./types";

const USAGE = "usage: validate [repo-root] [--plugin <plugin-dir>] [--todo <TODO.md>]";

const args = process.argv.slice(2);
const positional: string[] = [];
let plugin: string | undefined;
let todo: string | undefined;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--plugin") plugin = args[++i];
  else if (arg === "--todo") todo = args[++i];
  else if (arg === "--help" || arg === "-h") {
    console.log(USAGE);
    process.exit(0);
  } else if (arg !== undefined) positional.push(arg);
}
if ((args.includes("--plugin") && !plugin) || (args.includes("--todo") && !todo)) {
  console.error(USAGE);
  process.exit(2);
}

let findings: Finding[];
if (todo !== undefined) {
  findings = validateTodo(readFileSync(resolve(todo), "utf8"), todo);
} else {
  findings = validateRepo(resolve(positional[0] ?? process.cwd()), plugin === undefined ? {} : { plugin });
}

for (const finding of findings) {
  console.error(`${finding.path}: [${finding.rule}] ${finding.message}`);
}
if (findings.length > 0) {
  console.error(`validate: ${findings.length} finding(s)`);
  process.exit(1);
}
console.log("validate: ok");
