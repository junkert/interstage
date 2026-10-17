import type { Tree } from "nx/src/devkit-exports";
import { createFile, readText } from "./files.ts";
import { addSkillEntry } from "./manifest.ts";
import { assertKebab, assertLine, titleCase, yamlScalar } from "./names.ts";

export interface SkillOptions {
  /** Plugin directory name under `plugins/`, for example `interstage-web`. */
  plugin: string;
  /** Skill name without the `is-` prefix. */
  name: string;
  /** Trigger statement: when to use the skill. */
  description: string;
  /** SKILL.md size target recorded in `skills.manifest.json`. */
  budgetBytes: number;
}

export interface Scaffolded {
  files: { path: string; content: string }[];
  notes: string[];
}

const MAX_DESCRIPTION_CHARS = 1024;
const MANIFEST = "skills.manifest.json";

/**
 * SKILL.md skeleton for a method skill. Every `Replace:` line is a placeholder the author must rewrite;
 * the lines are written to stay clean under the validator's content lints.
 */
export function renderSkill(options: Pick<SkillOptions, "name" | "description">): string {
  return `---
name: is-${options.name}
description: ${yamlScalar(options.description)}
license: MIT
---

# ${titleCase(options.name)}

Replace: one paragraph on what this skill does and where its scope ends. Say that open questions go to the orchestrator.

## Method

1. Replace: the first step, stated as an action with an observable result.
2. Replace: the next step. Add steps until the method is complete.

## Decision rules

- Replace: a rule of the form "when <condition>, do <action>", with the evidence that decides it.

## Checklist

- [ ] Replace: one checkable item per line.

## Output

Replace: the exact report format. Findings carry a severity (\`blocker\`, \`major\`, \`minor\` or \`nit\`) and evidence (\`file:line\`, a command with its real output, or a quoted spec clause). There is no findings quota; "no findings" is a valid result.
`;
}

/** Names of every `is-*` skill directory under every plugin, to keep skill names unique across the repository. */
function allSkillDirs(tree: Tree): string[] {
  return tree.children("plugins").flatMap((plugin) => tree.children(`plugins/${plugin}/skills`));
}

/** Validate the options, then create `SKILL.md` and its `skills.manifest.json` entry in `tree`. */
export function scaffoldSkill(tree: Tree, options: SkillOptions): Scaffolded {
  assertKebab("plugin", options.plugin);
  assertKebab("name", options.name);
  if (options.name.startsWith("is-")) throw new Error(`name must not include the \`is-\` prefix (got ${options.name}); the generator adds it`);
  assertLine("description", options.description, MAX_DESCRIPTION_CHARS);
  if (!Number.isInteger(options.budgetBytes) || options.budgetBytes <= 0) throw new Error(`budgetBytes must be a positive integer, got ${String(options.budgetBytes)}`);

  const pluginRel = `plugins/${options.plugin}`;
  if (!tree.exists(`${pluginRel}/package.json`)) throw new Error(`${pluginRel}/package.json does not exist; create the plugin first (the pack generator does)`);
  const dirName = `is-${options.name}`;
  if (allSkillDirs(tree).includes(dirName)) throw new Error(`a skill named ${dirName} already exists in the repository; skill names are unique across plugins`);

  const skillRel = `${pluginRel}/skills/${dirName}`;
  const content = renderSkill(options);
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > options.budgetBytes) throw new Error(`the scaffold is ${bytes} bytes, over budgetBytes ${options.budgetBytes}; choose a larger budget`);

  createFile(tree, `${skillRel}/SKILL.md`, content);
  tree.write(MANIFEST, addSkillEntry(readText(tree, MANIFEST), { name: dirName, path: skillRel, origin: "authored", modified: false, budgetBytes: options.budgetBytes }));
  return {
    files: [{ path: `${skillRel}/SKILL.md`, content }],
    notes: [`Registered ${dirName} in ${MANIFEST} (origin authored, budgetBytes ${options.budgetBytes}).`, "Check with: bun run tools/validate/src/cli.ts ."],
  };
}
