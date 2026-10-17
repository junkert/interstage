import { describe, expect, test } from "bun:test";
import { parseTodo, validateTodo } from "./todo";

const GOOD = `# Mission TODO

## T-001: Add JWT token generation
depends: none
spec: specs/A02-auth.md#tokens
done-when:
- generate_token(user_id, expiry) returns a signed token
- tests/test_tokens.py passes

## T-002: Add token verification
depends: T-001
spec: specs/A02-auth.md#tokens
done-when:
- verify_token rejects expired tokens
`;

function rules(text: string): string[] {
  return validateTodo(text).map((finding) => finding.rule);
}

describe("parseTodo", () => {
  test("reads ids, dependencies, spec and success conditions", () => {
    const { items } = parseTodo(GOOD);
    expect(items.map((item) => item.id)).toEqual(["T-001", "T-002"]);
    expect(items[1]?.depends).toEqual(["T-001"]);
    expect(items[0]?.doneWhen).toHaveLength(2);
    expect(items[0]?.spec).toBe("specs/A02-auth.md#tokens");
  });
});

describe("validateTodo", () => {
  test("accepts a well-formed TODO", () => {
    expect(rules(GOOD)).toEqual([]);
  });

  test("requires success conditions and a spec reference", () => {
    expect(rules("## T-001: Do the thing\ndepends: none\n").sort()).toEqual(["todo-done-when", "todo-spec"]);
  });

  test("rejects duplicate ids, unknown and self dependencies", () => {
    const text = GOOD + "\n## T-002: Again\ndepends: T-002, T-009\nspec: s\ndone-when:\n- x\n";
    const found = rules(text);
    expect(found).toContain("todo-duplicate");
    expect(found.filter((rule) => rule === "todo-depends")).toHaveLength(2);
  });

  test("detects a dependency cycle", () => {
    const text = "## T-001: A\ndepends: T-002\nspec: s\ndone-when:\n- x\n\n## T-002: B\ndepends: T-001\nspec: s\ndone-when:\n- x\n";
    const findings = validateTodo(text);
    expect(findings.map((finding) => finding.rule)).toEqual(["todo-cycle"]);
    expect(findings[0]?.message).toContain("T-001 -> T-002 -> T-001");
  });

  test("rejects a malformed item heading", () => {
    expect(rules("## Build the auth system\n")).toEqual(["todo-heading"]);
  });
});
