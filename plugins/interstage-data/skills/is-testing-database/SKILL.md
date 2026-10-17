---
name: is-testing-database
description: Use when writing or reviewing tests for database migrations, constraints and transactions, and when choosing a test isolation strategy.
license: MIT
---

# Database testing

Use the project's own test runner and database tooling. Report open questions to the orchestrator.

## What to test

| Area | Tests |
|---|---|
| Migrations | apply all migrations to an empty database; apply the newest one to a database holding realistic rows; run the rollback and confirm the schema matches the previous state; re-apply |
| Schema vs code | the ORM or type definitions match the migrated schema |
| Constraints | each unique, foreign key, not-null and check constraint rejects a violating insert; assert on the error, not just that something failed |
| Transactions | a failure mid-transaction leaves no partial writes; concurrent writers to the same row behave as designed (lock, retry or conflict error) |
| Queries | critical queries return the right rows on edge data: empty, one row, duplicates, nulls |

## Isolation

- Fast default: each test runs in a transaction that is rolled back.
- Tests that need commits, DDL or multiple connections: a throwaway database or container per run, created and dropped by the test setup.
- Never point tests at a shared or production database. Take the connection string from test configuration only.

## Data

Seed realistic volumes where the test targets an index or migration time; a handful of rows proves nothing about either. Generate data in the test setup; do not copy production data.

## Output

Per failure: test name, `file:line`, the real assertion output. Report which migrations were applied and rolled back. Mark anything not run as [INFERENCE].
