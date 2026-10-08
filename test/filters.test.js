import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compare } from '../src/diff.js';

test('exclusions skip complete paths and descendants, not similarly named siblings', () => {
  const before = { app: { port: 1 }, apple: 1, removed: true };
  const after = { app: { port: 2 }, apple: 2, added: true };
  const exclude = Object.freeze(['/removed', '/app', '/added', '/app', '/missing']);
  assert.deepEqual(compare(before, after, { exclude }), {
    equal: false, changes: [{ type: 'changed', path: '/apple', before: 1, after: 2 }],
    filters: { exclude: ['/added', '/app', '/missing', '/removed'] },
  });
  assert.deepEqual(compare(before, after, { exclude: [''] }), {
    equal: true, changes: [], filters: { exclude: [''] },
  });
});

test('exclusions respect empty keys, escaped tokens, literal stars and prototype names', () => {
  const before = JSON.parse('{"":1,"a/b":{"~":1},"__proto__":1,"*":1,"other":1}');
  const after = JSON.parse('{"":2,"a/b":{"~":2},"__proto__":2,"*":2,"other":2}');
  assert.deepEqual(compare(before, after, { exclude: ['/', '/a~1b/~0', '/__proto__', '/*'] }).changes,
    [{ type: 'changed', path: '/other', before: 1, after: 2 }]);
  assert.equal(compare({ '~1': 1 }, { '~1': 2 }, { exclude: ['/~01'] }).equal, true);
  assert.equal(compare({ a: { '': 1, b: 1 } }, { a: { '': 2, b: 2 } }, { exclude: ['/a/'] }).changes[0].path, '/a/b');
});

test('array index exclusions keep original positions and atomic ancestors remain visible', () => {
  const before = { list: [1, 2] };
  const after = { list: [3, 4, 5] };
  assert.deepEqual(compare(before, after, { arrays: 'index', exclude: ['/list/0', '/list/2'] }).changes,
    [{ type: 'changed', path: '/list/1', before: 2, after: 4 }]);
  assert.equal(compare(before, after, { arrays: 'index', exclude: ['/list/01'] }).changes.length, 3);
  assert.deepEqual(compare(before, after, { exclude: ['/list/0'] }).changes,
    [{ type: 'changed', path: '/list', before: [1, 2], after: [3, 4, 5] }]);
  for (const [left, right] of [[{}, { list: { token: 1 } }], [{ list: { token: 1 } }, {}], [{ list: { token: 1 } }, { list: null }]]) {
    assert.deepEqual(compare(left, right, { exclude: ['/list/token'] }).changes, compare(left, right).changes);
  }
});

test('exclusions reject invalid pointers and never bypass input validation', () => {
  for (const exclude of ['a', null, [1], ['a'], ['#/a'], ['/a~'], ['/a~2']]) {
    assert.throws(() => compare({}, {}, { exclude }), /JSON Pointer/);
  }
  assert.throws(() => compare(Infinity, 0, { exclude: [''] }), /finite/);
  assert.deepEqual(compare(1, 2, { exclude: [] }), compare(1, 2));
});

test('CLI repeatable exclusions report filters, equality, validation and escaped text', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'json-config-filters-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'before.json'), '{"a":1,"b":1}');
  await writeFile(path.join(root, 'after.json'), '{"a":2,"b":2}');
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, 'before.json', 'after.json', ...args], { cwd: root, encoding: 'utf8' });
  const result = run('--exclude', '/a', '--exclude', '/b', '--json');
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { equal: true, changes: [], filters: { exclude: ['/a', '/b'] } });
  assert.equal(run('--exclude=').status, 0);
  const remaining = run('--exclude', '/a');
  assert.equal(remaining.status, 1);
  assert.match(remaining.stdout, /Excluded paths: \["\/a"\]/);
  assert.match(remaining.stdout, /CHANGED "\/b"/);
  const invalid = run('--exclude', '/~2', '--json');
  assert.equal(invalid.status, 2);
  assert.match(JSON.parse(invalid.stdout).error, /JSON Pointer/);
  assert.equal(run('--exclude').status, 2);
  assert.ok(!run('--exclude', '/\u001b[31m').stdout.includes('\u001b'));
});
