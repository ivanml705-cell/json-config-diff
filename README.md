# json-config-diff

Compare two local JSON configuration files and see what was added, removed, or changed. No dependencies, network calls, or file modifications.

**Status: second development milestone.** Nested object comparison and optional array-by-index comparison work. More controls will follow over several sessions.

## Run

Requires Node.js 22 or newer. No package installation is needed.

```sh
git clone https://github.com/ivanml705-cell/json-config-diff.git
cd json-config-diff
node src/cli.js examples/before.json examples/after.json
node src/cli.js examples/before.json examples/after.json --json
node --test
```

The example intentionally exits with code `1` because the files differ. Quote paths containing spaces; use `--` before a filename starting with a dash. Only strict JSON is accepted (no comments or trailing commas), with an optional UTF-8 BOM. Each file is limited to 5 MiB and values to depth 100 (root depth 0).

Example output:

```text
CHANGED "/app/port": 3000 -> 8080
ADDED "/debug": false
REMOVED "/legacy": true
3 differences.
```

## Comparison rules

- Object key order and JSON whitespace do not affect equality. Object keys are visited in sorted order.
- Added/removed objects are reported once at their own path; common objects are compared recursively.
- Arrays are order-sensitive whole values by default (`--arrays atomic`). A changed array produces one change at its path. Key order inside array objects does not affect equality.
- With `--arrays index`, common positions are compared recursively, including nested arrays and objects. Extra tail positions are added/removed in ascending numeric order. Added/removed containers are still reported once, and an array replaced by a different type is one change.
- Strings, numbers, booleans, null, and type changes are compared as JSON values; null is different from a missing property.
- Paths use JSON Pointer escaping: `~` becomes `~0`, `/` becomes `~1`. The root path is the empty string (shown as `(root)` in text). Text paths are quoted to distinguish empty keys and escape control characters.
- Numbers use standard JavaScript parsing and precision. Negative zero and zero compare equal; numeric overflow is rejected. Duplicate keys follow JSON.parse semantics (the last value wins). Exact arbitrary-precision comparison is outside the initial scope.

## Compare arrays by index

```sh
node src/cli.js before.json after.json --arrays index
node src/cli.js before.json after.json --arrays index --json
```

For `{"servers":[{"port":3000}]}` compared with `{"servers":[{"port":8080},null]}`, index mode reports:

```text
CHANGED "/servers/0/port": 3000 -> 8080
ADDED "/servers/1": null
2 differences.
```

Indices are zero-based. Positions are compared directly: inserting `"x"` at the start of `["a","b"]` produces changes at `/0` and `/1`, then an addition at `/2`. There is no identity matching, move detection, or alignment. The default atomic mode still reports the entire changed array once.

The JavaScript API also accepts `compare(before, after, { arrays: 'index' })`; omitting the options preserves atomic mode. Supported modes are `atomic` and `index`; other values are errors.

## Reports and exit codes

JSON output is `{ "equal": boolean, "changes": [...] }`. Each change has `type` (`added`, `removed`, or `changed`), `path`, and the applicable `before` / `after` values. This is a comparison report, not a JSON Patch document. Reports include original values; redact sensitive configuration before sharing them.

- `0`: inputs are equal.
- `1`: differences found.
- `2`: invalid arguments, unreadable files, invalid JSON, or input limits exceeded.

With `--json`, input errors produce `{ "error": "..." }` on stdout. Option-parsing errors go to stderr. Invalid JSON errors do not echo source content.

See [ROADMAP.md](ROADMAP.md) for the next sessions and [CHANGELOG.md](CHANGELOG.md) for completed work.
