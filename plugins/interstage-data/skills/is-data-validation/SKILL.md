---
name: is-data-validation
description: Use when reviewing or adding validation of input data, files or records. Covers quality dimensions, boundary validation, schema drift and edge-case inputs.
license: MIT
---

# Data validation

Report open questions to the orchestrator. Never print real PII from data files into reports; describe the field and give a masked or synthetic reproducing row.

## Principles

- Validate at the boundary where data enters (API handler, file import, queue consumer), once, and pass typed values inward.
- Reuse the project's own validator (zod, pydantic, ajv or JSON Schema). Do not add a second one.
- Rules are versioned like code: they live in the repo, change in reviewed commits and have tests.

## Quality dimensions

| Dimension | Question |
|---|---|
| Completeness | is every required value present? |
| Accuracy | does it match the real entity or reference data? |
| Consistency | does it agree across sources and over time? |
| Timeliness | is it fresh enough to use? |
| Uniqueness | are there duplicates? |
| Validity | does it match type, format and range? |
| Integrity | do foreign keys and relations hold? |

## Review steps

1. Locate each entry boundary and the validator it uses; flag boundaries with none (`file:line`).
2. Drift check: compare the schema definition, the migration or table definition, and the language type for each entity. Report fields that differ in name, nullability, type or length.
3. Build an edge-case table and use it as test inputs: null, empty string, whitespace, duplicate key, time zone and DST boundary, unicode (combining characters, emoji, right-to-left), numeric limits.
4. Run the project's tests; add missing cases only when the assignment says to change code.

## Finding record

Severity, title, evidence (`file:line` or a reproducing masked sample row with the validator's real output), which dimension failed, suggested rule. No quota; clean is valid.
