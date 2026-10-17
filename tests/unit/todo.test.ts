import { describe, expect, test } from "bun:test";
import { parseTodo, validateTodo } from "../../plugins/interstage/extension/todo";

const ITEM = (id: string, depends = "none", extra = "") => `## ${id}: Do ${id}\ndepends: ${depends}\nspec: specs/a.md#x\ndone-when:\n- ${id} works\n${extra}\n`;

const rules = (text: string) => validateTodo(text).map(f => f.rule);

describe("parseTodo", () => {
  test("reads id, title, depends, spec and done-when bullets", () => {
    const { items, findings } = parseTodo(`# Plan\n\n${ITEM("T-001")}${ITEM("T-002", "T-001, T-003", "- second\n")}`);
    expect(findings).toEqual([]);
    expect(items.map(i => i.id)).toEqual(["T-001", "T-002"]);
    expect(items[1]).toMatchObject({ title: "Do T-002", depends: ["T-001", "T-003"], spec: "specs/a.md#x" });
    expect(items[1]?.doneWhen).toEqual(["T-002 works", "second"]);
    expect(items[0]?.depends).toEqual([]);
  });

  test("a malformed item heading is reported with its line and ends the item", () => {
    const { items, findings } = parseTodo("## T-1: short id\ndepends: none\n");
    expect(items).toEqual([]);
    expect(findings).toEqual([{ rule: "todo-heading", path: "TODO.md", message: expect.stringContaining("line 1") }]);
  });
});

describe("validateTodo", () => {
  test("a complete acyclic plan has no findings", () => {
    expect(validateTodo(`${ITEM("T-001")}${ITEM("T-002", "T-001")}`)).toEqual([]);
  });

  test("reports duplicates, unknown and self dependencies, missing spec and done-when", () => {
    expect(rules(`${ITEM("T-001")}${ITEM("T-001")}`)).toContain("todo-duplicate");
    expect(rules(ITEM("T-001", "T-009"))).toContain("todo-depends");
    expect(rules(ITEM("T-001", "T-001"))).toContain("todo-depends");
    expect(rules("## T-001: x\ndepends: none\ndone-when:\n- ok\n")).toContain("todo-spec");
    expect(rules("## T-001: x\ndepends: none\nspec: s.md\n")).toContain("todo-done-when");
  });

  test("reports a dependency cycle with its path", () => {
    const findings = validateTodo(`${ITEM("T-001", "T-002")}${ITEM("T-002", "T-001")}`);
    expect(findings.find(f => f.rule === "todo-cycle")?.message).toContain("T-001 -> T-002 -> T-001");
  });
});
