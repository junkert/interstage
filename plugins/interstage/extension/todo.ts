// Canonical parser and validator for a mission TODO.md. Pure: no I/O. tools/validate re-exports it.

export interface TodoFinding {
  rule: string;
  path: string;
  message: string;
}

export interface TodoItem {
  id: string;
  title: string;
  depends: string[];
  spec: string | undefined;
  doneWhen: string[];
  line: number;
}

const HEADING = /^##\s+(T-\d{3,}):\s+(\S.*)$/;

/**
 * Parse a mission TODO. Each item is `## T-NNN: <imperative title>` followed by
 * `depends:`, `spec:` and a `done-when:` bullet list.
 */
export function parseTodo(text: string, path = "TODO.md"): { items: TodoItem[]; findings: TodoFinding[] } {
  const findings: TodoFinding[] = [];
  const items: TodoItem[] = [];
  let current: TodoItem | undefined;
  let inDoneWhen = false;

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trimEnd();
    const lineNo = index + 1;
    if (line.startsWith("## ")) {
      const match = HEADING.exec(line);
      if (!match) {
        findings.push({ rule: "todo-heading", path, message: `line ${lineNo}: item heading must be \`## T-NNN: <title>\`` });
        current = undefined;
        return;
      }
      current = { id: match[1] ?? "", title: match[2] ?? "", depends: [], spec: undefined, doneWhen: [], line: lineNo };
      items.push(current);
      inDoneWhen = false;
      return;
    }
    if (!current) return;
    const depends = /^depends:\s*(.*)$/.exec(line);
    const spec = /^spec:\s*(.*)$/.exec(line);
    if (depends) {
      inDoneWhen = false;
      const value = (depends[1] ?? "").trim();
      current.depends = value === "" || value.toLowerCase() === "none" ? [] : value.split(",").map(id => id.trim());
    } else if (spec) {
      inDoneWhen = false;
      current.spec = (spec[1] ?? "").trim() || undefined;
    } else if (/^done-when:\s*$/.test(line)) {
      inDoneWhen = true;
    } else if (inDoneWhen && /^\s*[-*]\s+\S/.test(line)) {
      current.doneWhen.push(line.replace(/^\s*[-*]\s+/, ""));
    } else if (line !== "" && !/^\s/.test(line)) {
      inDoneWhen = false;
    }
  });
  return { items, findings };
}

/** Validate a TODO: unique ids, known dependencies, no cycles, and every item has success conditions. */
export function validateTodo(text: string, path = "TODO.md"): TodoFinding[] {
  const { items, findings } = parseTodo(text, path);
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) findings.push({ rule: "todo-duplicate", path, message: `line ${item.line}: ${item.id} is defined more than once` });
    ids.add(item.id);
  }
  for (const item of items) {
    if (item.doneWhen.length === 0) findings.push({ rule: "todo-done-when", path, message: `line ${item.line}: ${item.id} needs a \`done-when:\` list so a builder can finish without asking` });
    if (item.spec === undefined) findings.push({ rule: "todo-spec", path, message: `line ${item.line}: ${item.id} needs a \`spec:\` reference` });
    for (const dep of item.depends) {
      if (dep === item.id) findings.push({ rule: "todo-depends", path, message: `line ${item.line}: ${item.id} depends on itself` });
      else if (!ids.has(dep)) findings.push({ rule: "todo-depends", path, message: `line ${item.line}: ${item.id} depends on unknown ${dep}` });
    }
  }
  findings.push(...findCycles(items, path));
  return findings;
}

function findCycles(items: TodoItem[], path: string): TodoFinding[] {
  const graph = new Map(items.map(item => [item.id, item.depends.filter(dep => dep !== item.id)]));
  const state = new Map<string, "visiting" | "done">();
  const findings: TodoFinding[] = [];
  const visit = (id: string, trail: string[]): void => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") {
      findings.push({ rule: "todo-cycle", path, message: `dependency cycle: ${[...trail.slice(trail.indexOf(id)), id].join(" -> ")}` });
      return;
    }
    state.set(id, "visiting");
    for (const dep of graph.get(id) ?? []) if (graph.has(dep)) visit(dep, [...trail, id]);
    state.set(id, "done");
  };
  for (const id of graph.keys()) visit(id, []);
  return findings;
}
