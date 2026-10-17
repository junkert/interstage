---
name: is-web-review
description: Use when reviewing HTML, JSX or template code for accessibility and React correctness. A static, repo-checkable checklist where every finding cites a WCAG success criterion and file:line.
license: MIT
---

# Web review

Static review of markup, components and style tokens. Automated tools catch only 30-40% of accessibility issues, so a clean tool run is not a clean review. Report open questions to the orchestrator.

## Method

1. Find templates, components and CSS or design-token files with `grep`.
2. If the project already has axe or pa11y (check `package.json` and CI config), run it with the project's own command. If not, do not install anything; use the built-in OMP browser tool for a keyboard walk (Tab, Shift+Tab, Enter, Space, Escape) of the affected page.
3. Walk the checklist. Record each hit as: title, severity, evidence (`file:line`), WCAG SC.
4. Fix order when asked to remediate: keyboard traps, missing labels, insufficient contrast, then the rest.

## Checklist

| Check | Look for | WCAG SC |
|---|---|---|
| Image alt | `<img>` or `role="img"` without `alt` or accessible name; decorative images need `alt=""` | 1.1.1 |
| Form labels | inputs without `<label for>`, wrapping label, `aria-label` or `aria-labelledby` | 1.3.1, 3.3.2 |
| Heading order | skipped levels, multiple purposeless `h1`, headings used only for size | 1.3.1, 2.4.6 |
| ARIA validity | unknown roles, `aria-*` not allowed on the role, `aria-labelledby` ids that do not exist, missing accessible name on buttons, links, dialogs | 4.1.2 |
| Keyboard | `onClick` on `div` or `span` without `role` and `tabindex` plus key handler; positive `tabindex`; focus traps in modals with no Escape | 2.1.1, 2.1.2 |
| Focus visible | `outline: none` or `outline: 0` without a replacement style | 2.4.7 |
| Contrast | design-token pairs below 4.5:1 for normal text (3:1 for large text and UI components); compute from the token values | 1.4.3, 1.4.11 |
| Page language and title | missing `lang` on `<html>`, missing or generic `<title>` | 3.1.1, 2.4.2 |

Use the WCAG 2.2 AA numbering. Do not report a touch-target size as an AA failure; the 2.2 AA minimum (2.5.8) is a separate, smaller rule, so cite it only after checking the actual text.

## React checks (evidence required)

- Effects: missing or wrong dependency array entries, effects that subscribe or start timers without a cleanup return, effects that only derive state from props.
- Lists: `key` missing, or index used as key on a list that reorders or inserts.
- State: prop drilling through more than two layers, state duplicated from props.
- Memoization (`useMemo`, `useCallback`, `memo`) and code splitting: give no advice unless a measurement (profiler output or bundle report) is attached.

## Output

Per finding: `severity`, title, `file:line`, WCAG SC, the fix in one line. No findings quota; "no findings" is valid. Mark anything you inferred without running a browser as [INFERENCE].
