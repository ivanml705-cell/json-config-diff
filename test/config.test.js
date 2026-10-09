import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readConfig, resolveOptions } from '../src/config.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const example = fileURLToPath(new URL('../examples/ci/', import.meta.url));
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'json-config-options-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });

test('config accepts strict options and BOM, rejects bad fields without echoing values', async t => {
  const root = await fixture(t);
  const file = path.join(root, 'options.json');
  const valid = { arrays: 'index', exclude: ['/a'], summary: true, redactValues: false };
  await writeFile(file, '\uFEFF' + JSON.stringify(valid));
  assert.deepEqual(await readConfig(file), valid);
  for (const config of [null, [], 1, 'secret', { unknown: 'DO_NOT_ECHO' }, { summary: 'DO_NOT_ECHO' },
    { redactValues: null }, { arrays: 'DO_NOT_ECHO' }, { exclude: ['/~2'] }, { exclude: 'DO_NOT_ECHO' },
    JSON.parse('{"__proto__":{}}'), { json: true }, { before: 'file.json' }]) {
    await writeFile(file, JSON.stringify(config));
    await assert.rejects(readConfig(file), error => !error.message.includes('DO_NOT_ECHO'));
  }
  await writeFile(file, '{"token":"DO_NOT_ECHO",}');
  await assert.rejects(readConfig(file), error => /Invalid JSON/.test(error.message) && !error.message.includes('DO_NOT_ECHO'));
  await writeFile(file, '{}');
  assert.deepEqual(await readConfig(file), {});
});

test('CLI options override config, exclusions replace lists and negative flags reset booleans', () => {
  const config = Object.freeze({ arrays: 'index', exclude: Object.freeze(['/old']), summary: true, redactValues: true });
  assert.deepEqual(resolveOptions(config, {}), config);
  assert.deepEqual(resolveOptions(config, { arrays: 'atomic', exclude: ['/new'], 'no-summary': true, 'no-redact-values': true }), {
    arrays: 'atomic', exclude: ['/new'], summary: false, redactValues: false,
  });
  assert.deepEqual(resolveOptions(config, { 'clear-excludes': true }).exclude, []);
  assert.deepEqual(resolveOptions({}, {}), { arrays: 'atomic', exclude: [], summary: false, redactValues: false });
  assert.throws(() => resolveOptions({}, { summary: true, 'no-summary': true }), /Cannot combine/);
  assert.throws(() => resolveOptions({}, { 'redact-values': true, 'no-redact-values': true }), /Cannot combine/);
  assert.throws(() => resolveOptions({}, { exclude: ['/a'], 'clear-excludes': true }), /Cannot combine/);
});

test('CLI loads explicit config relative to cwd and preserves positional input paths', async t => {
  const root = await fixture(t);
  await mkdir(path.join(root, 'settings'));
  await writeFile(path.join(root, 'settings', 'options.json'), JSON.stringify({ arrays: 'index', exclude: ['/time'], summary: true, redactValues: true }));
  await writeFile(path.join(root, 'before.json'), '{"list":[1],"time":1}');
  await writeFile(path.join(root, 'after.json'), '{"list":[2],"time":2}');
  const base = ['before.json', 'after.json', '--config', 'settings/options.json', '--json'];
  const configured = run(root, ...base);
  assert.equal(configured.status, 1);
  assert.deepEqual(JSON.parse(configured.stdout), {
    equal: false, summary: { added: 0, removed: 0, changed: 1, total: 1 },
    filters: { exclude: ['/time'] }, valuesRedacted: true,
  });
  const override = JSON.parse(run(root, ...base, '--no-summary', '--no-redact-values', '--arrays', 'atomic', '--exclude', '/list').stdout);
  assert.deepEqual(override.changes, [{ type: 'changed', path: '/time', before: 1, after: 2 }]);
  assert.deepEqual(override.filters.exclude, ['/list']);
  const clear = JSON.parse(run(root, ...base, '--clear-excludes').stdout);
  assert.equal(clear.summary.total, 2);
  assert.equal(Object.hasOwn(clear, 'filters'), false);
  assert.equal(run(root, ...base, '--exclude=').status, 0);
});

test('config is never auto-discovered and invalid files cannot be masked by overrides', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'json-config-diff.json'), '{invalid}');
  await writeFile(path.join(root, 'before.json'), '1');
  await writeFile(path.join(root, 'after.json'), '2');
  assert.equal(run(root, 'before.json', 'after.json').status, 1);
  for (const filename of ['missing.json', 'json-config-diff.json']) {
    const result = run(root, 'before.json', 'after.json', '--config', filename, '--json');
    assert.equal(result.status, 2);
    assert.ok(JSON.parse(result.stdout).error);
  }
  await writeFile(path.join(root, 'bad.json'), '{"arrays":"wrong"}');
  assert.equal(run(root, 'before.json', 'after.json', '--config', 'bad.json', '--arrays', 'index').status, 2);
  assert.equal(run(root, '--help', '--config', 'missing.json').status, 0);
  assert.equal(run(root, 'before.json', 'after.json', '--config').status, 2);
  for (const flags of [['--summary', '--no-summary'], ['--redact-values', '--no-redact-values'], ['--exclude', '/', '--clear-excludes']]) {
    assert.equal(run(root, 'before.json', 'after.json', ...flags).status, 2);
  }
});

test('CI example passes ignored timestamps, fails real drift and reports input errors', async t => {
  const root = await fixture(t);
  const expected = path.join(example, 'expected.json');
  const actual = path.join(example, 'actual.json');
  const config = path.join(example, 'diff.config.json');
  const result = run(root, expected, actual, '--config', config, '--json');
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).summary.total, 0);
  const drifted = JSON.parse(await readFile(actual, 'utf8'));
  drifted.servers[0].port = 9090;
  const driftFile = path.join(root, 'drift.json');
  await writeFile(driftFile, JSON.stringify(drifted));
  const drift = run(root, expected, driftFile, '--config', config, '--json');
  assert.equal(drift.status, 1);
  assert.equal(JSON.parse(drift.stdout).summary.changed, 1);
  assert.doesNotMatch(drift.stdout, /9090/);
  assert.equal(run(root, expected, path.join(root, 'missing.json'), '--config', config).status, 2);
});
