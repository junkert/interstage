import { resolve } from "node:path";
import { validateRepo } from "./checks";

const root = resolve(process.argv[2] ?? process.cwd());
const findings = validateRepo(root);

for (const finding of findings) {
  console.error(`${finding.path}: [${finding.rule}] ${finding.message}`);
}
if (findings.length > 0) {
  console.error(`validate: ${findings.length} finding(s)`);
  process.exit(1);
}
console.log("validate: ok");
