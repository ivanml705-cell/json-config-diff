import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compare } from '../src/diff.js';
import { prepareReport } from '../src/report.js';

test('summary counts only retained changes and preserves filter metadata', () => {
  const report = compare({ changed: 1, removed: true, skip: 1 }, { changed: 2, added: false, skip: 2 }, { exclude: ['/skip'] });
  assert.deepEqual(prepareReport(report, { summary: true }), {
    equal: false, summary: { added: 1, removed: 1, changed: 1, total: 3 }, filters: { exclude: ['/skip'] },
  });
  assert.deepEqual(prepareReport(compare(1, 1), { summary: true }), {
    equal: true, summary: { added: 0, removed: 0, changed: 0, total: 0 },
  });
  assert.equal(prepareReport(compare([1, 2], [2, 1]), { summary: true }).summary.total, 1);
  assert.equal(prepareReport(compare([1, 2], [2, 1], { arrays: 'index' }), { summary: true }).summary.total, 2);
});

test('redaction omits values at every change type including containers and root', () => {
  const report = compare({ removed: { nested: 'OLD_SECRET' }, changed: ['OLD_SECRET'] },
    { added: { nested: 'NEW_SECRET' }, changed: ['NEW_SECRET'] });
  const redacted = prepareReport(report, { redactValues: true });
  assert.deepEqual(redacted, {
    equal: false, changes: [
      { type: 'added', path: '/added' }, { type: 'changed', path: '/changed' }, { type: 'removed', path: '/removed' },
    ], valuesRedacted: true,
  });
  assert.doesNotMatch(JSON.stringify(redacted), /SECRET/);
  assert.deepEqual(prepareReport(compare('OLD_SECRET', 'NEW_SECRET'), { redactValues: true }).changes,
    [{ type: 'changed', path: '' }]);
  assert.equal(prepareReport(report, { summary: true, redactValues: true }).valuesRedacted, true);
});

test('presentation leaves frozen comparison reports intact and keeps default output', () => {
  const report = compare({ a: 1 }, { a: 2 }, { exclude: ['/missing'] });
  for (const change of report.changes) Object.freeze(change);
  Object.freeze(report.changes);
  Object.freeze(report.filters.exclude);
  Object.freeze(report.filters);
  Object.freeze(report);
  prepareReport(report, { summary: true });
  prepareReport(report, { redactValues: true });
  assert.deepEqual(prepareReport(report), report);
  assert.equal(report.changes[0].before, 1);
  const output = prepareReport(report);
  output.changes[0].path = '/elsewhere';
  output.filters.exclude.push('/another');
  assert.equal(report.changes[0].path, '/a');
  assert.deepEqual(report.filters.exclude, ['/missing']);
});

test('CLI summary and redaction combine with arrays, filters, JSON and exit codes', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'json-config-reports-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const before = { addedLater: [], list: ['OLD_SECRET'], removed: { token: 'OLD_SECRET' }, skip: 1 };
  const after = { addedLater: ['NEW_SECRET'], list: ['NEW_SECRET'], skip: 2 };
  await writeFile(path.join(root, 'before.json'), JSON.stringify(before));
  await writeFile(path.join(root, 'after.json'), JSON.stringify(after));
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, 'before.json', 'after.json', ...args], { cwd: root, encoding: 'utf8' });
  for (const args of [[], ['--json'], ['--summary'], ['--summary', '--json']]) {
    const result = run('--arrays', 'index', '--exclude', '/skip', '--redact-values', ...args);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /OLD_SECRET|NEW_SECRET/);
    if (args.includes('--json')) {
      const report = JSON.parse(result.stdout);
      assert.equal(report.valuesRedacted, true);
      assert.deepEqual(report.filters, { exclude: ['/skip'] });
      if (args.includes('--summary')) {
        assert.equal(Object.hasOwn(report, 'changes'), false);
        assert.deepEqual(report.summary, { added: 1, removed: 1, changed: 1, total: 3 });
      } else assert.deepEqual(report.changes.map(change => Object.keys(change)), Array(3).fill(['type', 'path']));
    } else if (args.includes('--summary')) {
      assert.match(result.stdout, /3 differences \(1 added, 1 removed, 1 changed\)/);
      assert.doesNotMatch(result.stdout, /\/list/);
    } else assert.match(result.stdout, /CHANGED "\/list\/0"/);
  }
  const summary = run('--summary', '--json');
  assert.doesNotMatch(summary.stdout, /SECRET/);
  assert.equal(JSON.parse(summary.stdout).summary.total, 4);
  const ignored = run('--exclude=', '--summary', '--json');
  assert.equal(ignored.status, 0);
  assert.equal(JSON.parse(ignored.stdout).summary.total, 0);
  await writeFile(path.join(root, 'after.json'), JSON.stringify(before));
  assert.equal(run('--redact-values').status, 0);
  await writeFile(path.join(root, 'after.json'), '{"token":"BAD_SECRET",}');
  const invalid = run('--summary', '--redact-values', '--json');
  assert.equal(invalid.status, 2);
  assert.match(JSON.parse(invalid.stdout).error, /Invalid JSON/);
  assert.doesNotMatch(invalid.stdout + invalid.stderr, /BAD_SECRET/);
});
