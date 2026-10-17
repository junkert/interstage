import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkMarketplace, checkNotices, checkSkillsManifest, validateRepo } from "./checks";

const SHA = "5fe7152c66604a967e53ce3aa4882d3fce00072f";

let root: string;

function put(rel: string, content: string | object): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content, null, 2));
}

function rules(findings: { rule: string }[]): string[] {
  return findings.map((finding) => finding.rule).sort();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "interstage-validate-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("checkMarketplace", () => {
  test("no catalog yet is not a finding", () => {
    expect(checkMarketplace(root)).toEqual([]);
  });

  test("accepts a catalog whose plugin directory and package.json agree", () => {
    put(".omp-plugin/marketplace.json", {
      name: "interstage",
      owner: { name: "Levi" },
      plugins: [{ name: "interstage", source: "./plugins/interstage", version: "0.1.0" }],
    });
    put("plugins/interstage/package.json", { name: "interstage", version: "0.1.0" });
    expect(checkMarketplace(root)).toEqual([]);
  });

  test("reports a version that differs between catalog and package.json", () => {
    put(".omp-plugin/marketplace.json", {
      name: "interstage",
      owner: { name: "Levi" },
      plugins: [{ name: "interstage", source: "./plugins/interstage", version: "0.2.0" }],
    });
    put("plugins/interstage/package.json", { name: "interstage", version: "0.1.0" });
    expect(rules(checkMarketplace(root))).toEqual(["plugin-package"]);
  });

  test("rejects names OMP would refuse and case-insensitive duplicates", () => {
    put(".omp-plugin/marketplace.json", {
      name: "-bad",
      owner: { name: "Levi" },
      plugins: [
        { name: "under_score", source: "./plugins/a", version: "1.0.0" },
        { name: "Web", source: "./plugins/w", version: "1.0.0" },
        { name: "web", source: "./plugins/w", version: "1.0.0" },
      ],
    });
    put("plugins/w/package.json", { name: "Web", version: "1.0.0" });
    const found = rules(checkMarketplace(root));
    expect(found).toContain("marketplace-name");
    expect(found).toContain("plugin-name");
    expect(found).toContain("plugin-duplicate");
  });

  test("rejects sources that are absolute or missing", () => {
    put(".omp-plugin/marketplace.json", {
      name: "interstage",
      owner: { name: "Levi" },
      plugins: [
        { name: "abs", source: "/tmp/x", version: "1.0.0" },
        { name: "gone", source: "./plugins/gone", version: "1.0.0" },
      ],
    });
    expect(rules(checkMarketplace(root))).toEqual(["plugin-source", "plugin-source"]);
  });

  test("reports malformed JSON instead of throwing", () => {
    put(".omp-plugin/marketplace.json", "{ not json");
    expect(rules(checkMarketplace(root))).toEqual(["marketplace-json"]);
  });
});

describe("checkSkillsManifest", () => {
  test("requires the manifest", () => {
    expect(rules(checkSkillsManifest(root))).toEqual(["manifest-missing"]);
  });

  test("accepts an empty skill list with a pinned upstream commit", () => {
    put("skills.manifest.json", { upstream: { repo: "https://github.com/wojons/skills", sha: SHA, license: "MIT" }, skills: [] });
    expect(checkSkillsManifest(root)).toEqual([]);
  });

  test("rejects an abbreviated commit and a skill without the is- prefix or provenance", () => {
    put("plugins/interstage/skills/baby-steps/SKILL.md", "x");
    put("skills.manifest.json", {
      upstream: { repo: "https://github.com/wojons/skills", sha: "5fe7152", license: "MIT" },
      skills: [{ name: "baby-steps", path: "plugins/interstage/skills/baby-steps", origin: "upstream", modified: true }],
    });
    const found = checkSkillsManifest(root);
    expect(found.map((finding) => finding.message).join("\n")).toContain("40-character");
    expect(found.map((finding) => finding.message).join("\n")).toContain("`is-`");
    expect(found.map((finding) => finding.message).join("\n")).toContain("upstream skill names");
  });
  test("requires a size budget, a name that matches its path, and no duplicate paths", () => {
    put("plugins/interstage/skills/is-a/SKILL.md", "x");
    const entry = { name: "is-a", path: "plugins/interstage/skills/is-a", origin: "authored", modified: false };
    put("skills.manifest.json", {
      upstream: { repo: "https://github.com/wojons/skills", sha: SHA, license: "MIT" },
      skills: [entry, { ...entry, name: "is-b", budgetBytes: 100 }],
    });
    const messages = checkSkillsManifest(root).map((finding) => finding.message);
    expect(messages.some((message) => message.includes("budgetBytes"))).toBe(true);
    expect(messages.some((message) => message.includes("listed twice"))).toBe(true);
    expect(messages.some((message) => message.includes("last segment"))).toBe(true);
  });
});

describe("checkNotices", () => {
  const notice = `# Notices\n\nCopyright (c) 2025 lexykwaii\n\nSource commit ${SHA}\n`;

  test("passes when the upstream notice and the pinned commit are present", () => {
    put("skills.manifest.json", { upstream: { repo: "https://github.com/wojons/skills", sha: SHA, license: "MIT" }, skills: [] });
    put("THIRD_PARTY_NOTICES.md", notice);
    expect(checkNotices(root)).toEqual([]);
  });

  test("fails when the notice cites a different commit than the manifest", () => {
    put("skills.manifest.json", { upstream: { repo: "https://github.com/wojons/skills", sha: SHA, license: "MIT" }, skills: [] });
    put("THIRD_PARTY_NOTICES.md", notice.replace(SHA, "0".repeat(40)));
    expect(rules(checkNotices(root))).toEqual(["notices-sha"]);
  });

  test("fails when the license notice is dropped", () => {
    put("THIRD_PARTY_NOTICES.md", "# Notices\n");
    expect(rules(checkNotices(root))).toEqual(["notices-license"]);
  });
});

describe("validateRepo", () => {
  test("combines every check", () => {
    expect(rules(validateRepo(root))).toEqual(["manifest-missing", "notices-missing"]);
  });
});
