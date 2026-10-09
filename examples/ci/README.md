# Check configuration drift in CI

`expected.json` represents a reviewed baseline; `actual.json` represents output from a build or configuration generator. This example uses committed fixtures so anyone can run it without external services. `diff.config.json` excludes a generated timestamp and requests a summary with values redacted.

From the repository root:

```sh
node src/cli.js examples/ci/expected.json examples/ci/actual.json --config examples/ci/diff.config.json --json
```

The [config-check-example job](../../.github/workflows/test.yml) executes this exact command. It succeeds because only the excluded timestamp differs. For a manual failure demonstration, change `servers[0].port` in `actual.json`, run the command again, then undo that local edit. The check exits with code 1. Missing files or invalid JSON exit with code 2.

## Adapt to your project

1. Keep a reviewed expected configuration in your repository.
2. Generate the actual configuration in an earlier CI step.
3. Add a JSON config file listing only the fields that should be ignored.
4. Run the CLI directly in a step; any nonzero exit status fails that step.

For another repository, after checking out your own project, check out a reviewed revision of this tool into `tools/json-config-diff`, then run it with your paths:

```yaml
- uses: actions/checkout@v7.0.1
- uses: actions/setup-node@v7.0.0
  with:
    node-version: 24
- uses: actions/checkout@v7.0.1
  with:
    repository: ivanml705-cell/json-config-diff
    ref: YOUR_REVIEWED_COMMIT_SHA
    path: tools/json-config-diff
# Add your generation step here to create build/actual.json.
- name: Check configuration drift
  run: node tools/json-config-diff/src/cli.js config/expected.json build/actual.json --config config/diff-options.json --json
```

Replace `YOUR_REVIEWED_COMMIT_SHA` with a full commit SHA that includes config support, and replace the example paths with your project's paths. No npm install is required. Do not suppress the command's nonzero exit status: code 1 means drift, while code 2 means the comparison could not be performed.

Exclusions match comparison paths; they do not mask fields inside whole-container changes. See [comparison semantics](../../README.md#exclude-paths). Redaction hides before/after values, while excluded paths and error file paths remain visible.
