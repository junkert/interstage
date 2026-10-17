import type { Tree } from "nx/src/devkit-exports";
import { createFile, readText } from "./files.ts";
import { addMarketplacePlugin } from "./manifest.ts";
import { assertKebab, assertLine } from "./names.ts";
import { scaffoldSkill, type Scaffolded } from "./skill.ts";

export interface PackOptions {
  /** Pack name; the plugin is `interstage-<name>`. */
  name: string;
  description: string;
  /** First skill name without `is-`; defaults to the pack name. */
  skill?: string | undefined;
  /** Trigger statement of the first skill. */
  skillDescription: string;
  budgetBytes: number;
}

const MARKETPLACE = ".omp-plugin/marketplace.json";
const VERSION = "0.1.0";

/** `package.json` of a skills-only pack: no `omp` key, a `validate` script scoped to the pack. */
export function renderPackPackage(plugin: string, description: string): string {
  const pkg = {
    name: plugin,
    version: VERSION,
    description,
    license: "MIT",
    scripts: { validate: `bun run ../../tools/validate/src/cli.ts ../.. --plugin plugins/${plugin}` },
  };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

/** Validate the options, then create the pack, its first skill and its marketplace entry in `tree`. */
export function scaffoldPack(tree: Tree, options: PackOptions): Scaffolded {
  assertKebab("name", options.name);
  if (options.name === "interstage" || options.name.startsWith("interstage-")) throw new Error(`name must not include the \`interstage\` prefix (got ${options.name}); the generator adds it`);
  assertLine("description", options.description, 300);
  const plugin = `interstage-${options.name}`;
  const pluginRel = `plugins/${plugin}`;
  if (tree.exists(pluginRel)) throw new Error(`${pluginRel} already exists; refusing to overwrite it`);

  const packageContent = renderPackPackage(plugin, options.description);
  createFile(tree, `${pluginRel}/package.json`, packageContent);
  tree.write(
    MARKETPLACE,
    addMarketplacePlugin(readText(tree, MARKETPLACE), {
      name: plugin,
      description: options.description,
      source: `./${pluginRel}`,
      version: VERSION,
      category: "development",
      keywords: ["agents", "skills", options.name],
      license: "MIT",
    }),
  );
  const skill = scaffoldSkill(tree, { plugin, name: options.skill ?? options.name, description: options.skillDescription, budgetBytes: options.budgetBytes });
  return {
    files: [{ path: `${pluginRel}/package.json`, content: packageContent }, ...skill.files],
    notes: [
      `Listed ${plugin} in ${MARKETPLACE} (version ${VERSION}).`,
      ...skill.notes,
      "The workspace glob `plugins/*` already includes the pack; run `bun install` to link it and update bun.lock.",
    ],
  };
}
