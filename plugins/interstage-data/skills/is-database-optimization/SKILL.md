---
name: is-database-optimization
description: Use when reviewing SQL, ORM code or migrations for query and index problems. Static review first; EXPLAIN only against a project-provided local or test database.
license: MIT
---

# Database optimization review

Static review of SQL, ORM code and migrations. Findings need `file:line` evidence. Report open questions to the orchestrator.

## Scope

- In: query shape, indexes, schema constraints, migrations.
- Out: connection pool or memory tuning (cannot be judged from a repo), replication, sharding, backup, cost.

## Static checks

| Check | Look for |
|---|---|
| N+1 | a query or ORM lazy load inside a loop; fix with a join, eager load or batched `IN` |
| `SELECT *` | wide reads where few columns are used |
| Unbounded query | no `LIMIT` or pagination on a table that grows |
| Missing FK | a `*_id` column with no foreign key constraint |
| Missing index | FK columns and `WHERE`, `JOIN`, `ORDER BY` columns with no supporting index |
| Function on indexed column | `WHERE lower(email) = ...` or `date(created_at)` defeats a plain index; rewrite as a range or add an expression index |

## Index rules

- Indexes follow query patterns, not tables. Name the query each index serves.
- Composite index column order: equality columns first, then range or sort columns.
- Prefix redundancy: `(a)` is redundant when `(a, b)` exists; flag it for removal.
- Partial index for a hot filtered subset (for example `WHERE status = 'pending'`).
- Queue workers claiming rows use `FOR UPDATE SKIP LOCKED`.
- Migrations: create indexes with `CREATE INDEX CONCURRENTLY` where the engine supports it (PostgreSQL), and ship the matching rollback (`DROP INDEX CONCURRENTLY`). It cannot run inside a transaction block, and migration frameworks usually wrap each migration in one, so check that the framework's transaction wrapping is disabled for that migration. A failed concurrent build leaves an INVALID index: drop it and rebuild.

## Measuring

Run plans only against a local or test database the project provides. Never connect to production.

- PostgreSQL: `EXPLAIN` shows the plan without running the statement. `EXPLAIN ANALYZE` executes it, so for INSERT, UPDATE or DELETE wrap it in `BEGIN; ... ROLLBACK;` or use plain `EXPLAIN`.
- SQLite: `EXPLAIN QUERY PLAN <statement>`.
- MySQL: `EXPLAIN` is available; whether `EXPLAIN ANALYZE` exists and which statements it accepts depends on the version, so check the engine version first.

Measure before and after a change and report both real outputs; without a database, label the finding [INFERENCE].
