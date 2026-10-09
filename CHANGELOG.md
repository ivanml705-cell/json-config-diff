# Changelog

## Unreleased

- Add explicit `--config` JSON files with strict validation and CLI precedence, plus flags to clear configured exclusions, summary output, or value redaction.
- Add a working CI configuration-drift example and tests for equal, different, and invalid inputs.

- Add `--summary` counts after filtering and `--redact-values` reports without before/after data.
- Keep report presentation separate from comparison and preserve equality/exit-code behavior.

- Add repeatable `--exclude` JSON Pointer filters, with subtree matching, validation, and filter metadata in reports.

- Add `--arrays index` to compare array positions recursively, with numeric ordering and tail additions/removals.
- Preserve whole-array comparison by default and expose explicit `--arrays atomic` selection.
- Document positional semantics and cover nested arrays, insertions, removals, type changes, and CLI validation.

## 0.1.0 — 2026-09-30

- Compare nested JSON objects with added, removed, and changed values.
- Provide text and JSON reports with escaped paths and meaningful exit codes.
- Compare arrays as whole values and enforce file-size/depth limits.
- Add tests, example configurations, and CI on Windows/Linux with Node 22/24.
