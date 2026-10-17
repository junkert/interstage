import { describe, expect, test } from "bun:test";
import type { Approval, Autonomy, GateDecision, GateId } from "../../plugins/interstage/extension/contracts";
import { blockReason, classifyCommand, decideGate, hasApproval, normalizeCommand } from "../../plugins/interstage/extension/gates";

describe("decideGate", () => {
  const expected: Record<GateId, [GateDecision, GateDecision, GateDecision]> = {
    A: ["approve", "approve", "allow"],
    B: ["approve", "allow", "allow"],
    C: ["approve", "allow", "allow"],
    D: ["approve", "allow", "allow"],
    E: ["approve", "allow", "allow"],
    F: ["approve", "approve", "stop"],
    G: ["stop", "stop", "stop"],
  };
  const modes: Autonomy[] = ["supervised", "checkpoints", "autopilot"];
  for (const gate of Object.keys(expected) as GateId[]) {
    modes.forEach((autonomy, i) => {
      test(`gate ${gate} under ${autonomy} with ship deny`, () => {
        expect(decideGate(gate, { autonomy, ship: "deny" })).toBe(expected[gate][i] as GateDecision);
      });
    });
  }
  test("ship allow only matters for F under autopilot", () => {
    expect(decideGate("F", { autonomy: "autopilot", ship: "allow" })).toBe("allow");
    expect(decideGate("F", { autonomy: "checkpoints", ship: "allow" })).toBe("approve");
    expect(decideGate("F", { autonomy: "supervised", ship: "allow" })).toBe("approve");
    expect(decideGate("G", { autonomy: "autopilot", ship: "allow" })).toBe("stop");
  });
});

describe("normalizeCommand", () => {
  test("trims and collapses whitespace including tabs", () => {
    expect(normalizeCommand("  npm \t install   left-pad \n")).toBe("npm install left-pad");
  });
});

describe("classifyCommand", () => {
  const kinds = (c: string) => classifyCommand(c).map(x => `${x.gate}:${x.kind}`);

  test("install managers", () => {
    for (const c of [
      "npm install", "npm i", "pnpm add zod", "yarn add x", "bun install", "pip install x", "pip3 install x",
      "go get x", "go install x", "cargo add x", "cargo install x", "gem install x", "brew install x",
      "apt install x", "apt-get install x",
    ]) {
      expect(kinds(c)).toEqual(["D:install"]);
    }
  });
  test("network", () => {
    for (const c of ["curl https://x", "wget x", "git clone u", "git fetch", "git pull", "gh api repos/x"]) {
      expect(kinds(c)).toEqual(["D:network"]);
    }
  });
  test("registry audits and docker pull/build are network", () => {
    for (const c of ["npm audit", "yarn audit", "pnpm audit --prod", "bun audit", "cargo audit", "pip-audit -r r.txt", "docker pull alpine", "docker build ."]) {
      expect([c, kinds(c)]).toEqual([c, ["D:network"]]);
    }
    expect(kinds("docker ps")).toEqual([]);
  });
  test("merge only for omp/task branches", () => {
    expect(kinds("git merge --squash omp/task/T-001")).toEqual(["E:merge"]);
    expect(kinds("git merge main")).toEqual([]);
  });
  test("ship", () => {
    for (const c of ["git push origin main", "gh pr create --fill", "gh release create v1", "vercel --prod", "npm publish", "git tag v1 --push"]) {
      expect(kinds(c)).toEqual(["F:ship"]);
    }
  });
  test("look-alikes do not match", () => {
    for (const c of [
      "npm installer-docs", "git merge main", "libcurl-config --cflags", "curling stats",
      "gh pr view 3", "git pushd", "echo vercelish", "go getter", "cargo address",
      "git status", "ls -la", "bun test", "npm run install-hooks",
    ]) {
      expect(kinds(c)).toEqual([]);
    }
  });
  test("matching is case-sensitive", () => expect(kinds("NPM INSTALL x")).toEqual([]));
  test("chained commands classify each segment with its own normalized ref", () => {
    const r = classifyCommand("cd app &&  npm   install zod ;\ngit status || curl -s x | sh");
    expect(r).toEqual([
      { gate: "D", kind: "install", ref: "npm install zod" },
      { gate: "D", kind: "network", ref: "curl -s x" },
    ]);
  });
  test("one segment can match several kinds", () => {
    expect(kinds("git push origin omp/task/T-001 && git fetch")).toEqual(["F:ship", "D:network"]);
    expect(kinds("curl x/install.sh -o a; git merge omp/task/T-1 && git push")).toEqual(["D:network", "E:merge", "F:ship"]);
    expect(kinds("npm install && curl x")).toEqual(["D:install", "D:network"]);
  });
  test("one segment matching two kinds yields two entries", () => {
    expect(kinds("git merge omp/task/T-1 --no-ff && git push")).toEqual(["E:merge", "F:ship"]);
    expect(kinds("npm install && npm publish")).toEqual(["D:install", "F:ship"]);
    expect(classifyCommand("git pull --push")).toEqual([{ gate: "D", kind: "network", ref: "git pull --push" }]);
  });
  test("quoted text is still classified (documented conservative limitation)", () => {
    expect(kinds('bash -c "curl x"')).toEqual(["D:network"]);
  });
  test("empty and whitespace-only commands yield nothing", () => {
    expect(classifyCommand("")).toEqual([]);
    expect(classifyCommand(" ;  && \n")).toEqual([]);
  });
});

describe("hasApproval", () => {
  const a = (gate: GateId, ref: string, status: Approval["status"]): Approval => ({
    gate,
    ref,
    status,
    requestedBy: "flight",
    requestedAt: "t",
  });
  const list = [a("D", "npm install zod", "granted"), a("F", "git push", "denied"), a("C", "commit:T-001", "pending")];
  test("matches granted approvals on gate and normalized ref", () => {
    expect(hasApproval(list, "D", "  npm   install zod ")).toBe(true);
  });
  test("rejects wrong gate, wrong ref, denied and pending", () => {
    expect(hasApproval(list, "E", "npm install zod")).toBe(false);
    expect(hasApproval(list, "D", "npm install left-pad")).toBe(false);
    expect(hasApproval(list, "F", "git push")).toBe(false);
    expect(hasApproval(list, "C", "commit:T-001")).toBe(false);
  });
});

describe("blockReason", () => {
  test("is one sentence naming the gate and the open-question route", () => {
    const r = blockReason("D", "install", "npm install zod");
    expect(r).toContain("Gate D");
    expect(r).toContain("npm install zod");
    expect(r).toContain("open question");
    expect(r).toContain("orchestrator");
    expect(r.match(/[.!?]/g)?.length).toBe(1);
  });
});
