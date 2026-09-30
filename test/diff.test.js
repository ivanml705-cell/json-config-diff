import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compare, readJson } from '../src/diff.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'json-config-diff-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('nested objects report deterministic additions, removals and changes', () => {
  assert.deepEqual(compare({ z: true, app: { port: 3000, unchanged: 1 } }, { debug: false, app: { unchanged: 1, port: 8080 } }), {
    equal: false, changes: [
      { type: 'changed', path: '/app/port', before: 3000, after: 8080 },
      { type: 'added', path: '/debug', after: false },
      { type: 'removed', path: '/z', before: true },
    ],
  });
});

test('object order is ignored while array order matters and arrays remain atomic', () => {
  assert.deepEqual(compare({ a: [{ x: 1, y: 2 }], b: 0 }, { b: 0, a: [{ y: 2, x: 1 }] }), { equal: true, changes: [] });
  assert.deepEqual(compare({ list: [1, 2] }, { list: [2, 1] }).changes,
    [{ type: 'changed', path: '/list', before: [1, 2], after: [2, 1] }]);
});

test('null, absent keys, root replacements and added subtrees remain distinct', () => {
  assert.deepEqual(compare({}, { a: null, b: { c: 1 } }).changes,
    [{ type: 'added', path: '/a', after: null }, { type: 'added', path: '/b', after: { c: 1 } }]);
  assert.deepEqual(compare(null, []).changes, [{ type: 'changed', path: '', before: null, after: [] }]);
  assert.equal(compare(1, '1').equal, false);
  assert.equal(compare(false, false).equal, true);
  assert.equal(compare(-0, 0).equal, true);
  assert.equal(compare([{ value: -0 }], [{ value: 0 }]).equal, true);
});

test('index mode descends through array objects and nested arrays with escaped paths', () => {
  assert.deepEqual(compare({ 'a/b': [{ '~': [1, 2] }, null] }, { 'a/b': [{ '~': [1, 3] }, false] }, { arrays: 'index' }), {
    equal: false, changes: [
      { type: 'changed', path: '/a~1b/0/~0/1', before: 2, after: 3 },
      { type: 'changed', path: '/a~1b/1', before: null, after: false },
    ],
  });
  assert.deepEqual(compare([{ x: 1, y: 2 }], [{ y: 2, x: 1 }], { arrays: 'index' }), { equal: true, changes: [] });
});

test('index mode reports missing tail positions once, in numeric order', () => {
  const values = Array.from({ length: 12 }, (_, i) => i === 0 ? null : { n: i });
  assert.deepEqual(compare([], values, { arrays: 'index' }).changes,
    values.map((after, i) => ({ type: 'added', path: `/${i}`, after })));
  assert.deepEqual(compare(values, [], { arrays: 'index' }).changes,
    values.map((before, i) => ({ type: 'removed', path: `/${i}`, before })));
  assert.deepEqual(compare([], [], { arrays: 'index' }), { equal: true, changes: [] });
  assert.deepEqual(compare({}, { list: values }, { arrays: 'index' }).changes,
    [{ type: 'added', path: '/list', after: values }]);
});

test('index mode compares positions without matching insertions, removals or moves', () => {
  assert.deepEqual(compare(['a', 'b'], ['x', 'a', 'b'], { arrays: 'index' }).changes, [
    { type: 'changed', path: '/0', before: 'a', after: 'x' },
    { type: 'changed', path: '/1', before: 'b', after: 'a' },
    { type: 'added', path: '/2', after: 'b' },
  ]);
  assert.deepEqual(compare(['a', 'b'], ['b'], { arrays: 'index' }).changes, [
    { type: 'changed', path: '/0', before: 'a', after: 'b' },
    { type: 'removed', path: '/1', before: 'b' },
  ]);
  assert.deepEqual(compare([1, 2], [2, 1], { arrays: 'index' }).changes, [
    { type: 'changed', path: '/0', before: 1, after: 2 },
    { type: 'changed', path: '/1', before: 2, after: 1 },
  ]);
});

test('array modes preserve type changes, atomic defaults and immutable inputs', () => {
  const before = Object.freeze([Object.freeze({ x: 1 })]);
  const after = Object.freeze([Object.freeze({ x: 2 })]);
  assert.deepEqual(compare(before, after, { arrays: 'atomic' }), compare(before, after));
  assert.deepEqual(compare(before, after, { arrays: 'index' }).changes,
    [{ type: 'changed', path: '/0/x', before: 1, after: 2 }]);
  for (const [left, right] of [[[], {}], [null, []], [[[]], [0]]]) {
    assert.deepEqual(compare(left, right, { arrays: 'index' }).changes,
      [{ type: 'changed', path: Array.isArray(left) && Array.isArray(right) ? '/0' : '',
        before: Array.isArray(left) && Array.isArray(right) ? left[0] : left,
        after: Array.isArray(left) && Array.isArray(right) ? right[0] : right }]);
  }
  assert.throws(() => compare([], [], { arrays: 'unknown' }), /array mode/);
});

test('CLI array selection supports text and JSON reports and rejects invalid modes', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'before.json'), '{"servers":[{"port":3000}]}');
  await writeFile(path.join(root, 'after.json'), '{"servers":[{"port":8080},null]}');
  const run = (...args) => spawnSync(process.execPath, [cli, 'before.json', 'after.json', ...args], { cwd: root, encoding: 'utf8' });
  const indexed = run('--arrays', 'index', '--json');
  assert.equal(indexed.status, 1);
  assert.deepEqual(JSON.parse(indexed.stdout).changes, [
    { type: 'changed', path: '/servers/0/port', before: 3000, after: 8080 },
    { type: 'added', path: '/servers/1', after: null },
  ]);
  assert.match(run('--arrays=index').stdout, /CHANGED "\/servers\/0\/port": 3000 -> 8080/);
  assert.deepEqual(run('--arrays', 'atomic', '--json').stdout, run('--json').stdout);
  const invalid = run('--arrays', 'unknown', '--json');
  assert.equal(invalid.status, 2);
  assert.match(JSON.parse(invalid.stdout).error, /array mode/);
  assert.equal(run('--arrays').status, 2);
  await writeFile(path.join(root, 'after.json'), '{"servers":[{"port":3000}]}');
  assert.equal(run('--arrays', 'index').status, 0);
});

test('paths escape special keys and prototype-like names are ordinary data', () => {
  const after = JSON.parse('{"a/b":{"~":1},"":2,"__proto__":{"x":3},"constructor":4}');
  const before = JSON.parse('{"a/b":{"~":0}}');
  assert.deepEqual(compare(before, after).changes.map(change => change.path), ['/', '/__proto__', '/a~1b/~0', '/constructor']);
  assert.equal({}.x, undefined);
});

test('comparison does not mutate inputs', () => {
  const before = Object.freeze({ nested: Object.freeze({ value: 1 }), array: Object.freeze([1, 2]) });
  const after = Object.freeze({ nested: Object.freeze({ value: 2 }), array: Object.freeze([2, 1]) });
  assert.equal(compare(before, after).changes.length, 2);
  assert.equal(before.nested.value, 1);
});

test('input validation accepts BOM and rejects malformed, oversized, overflow and deep JSON', async t => {
  const root = await fixture(t);
  const file = path.join(root, 'input.json');
  await writeFile(file, '\uFEFF{"ok":true}');
  assert.deepEqual(await readJson(file), { ok: true });
  await writeFile(file, '{"secret":"DO_NOT_ECHO",}');
  await assert.rejects(readJson(file), error => /Invalid JSON/.test(error.message) && !error.message.includes('DO_NOT_ECHO'));
  await writeFile(file, '1e999');
  await assert.rejects(readJson(file), /finite JavaScript range/);
  await writeFile(file, '['.repeat(101) + '0' + ']'.repeat(101));
  await assert.rejects(readJson(file), /depth/);
  await writeFile(file, '['.repeat(100) + '0' + ']'.repeat(100));
  await readJson(file);
  await writeFile(file, ' '.repeat(5 * 1024 * 1024 + 1));
  await assert.rejects(readJson(file), /5 MiB/);
  await assert.rejects(readJson(root), /Not a file/);
});

test('CLI uses exit codes 0/1/2 and produces parseable JSON including errors', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'before.json'), '{"a":1}');
  await writeFile(path.join(root, '-after.json'), '{"a":2}');
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(run('before.json', 'before.json').status, 0);
  const changed = run('--json', '--', 'before.json', '-after.json');
  assert.equal(changed.status, 1);
  assert.equal(JSON.parse(changed.stdout).changes[0].path, '/a');
  assert.match(run('before.json', './-after.json').stdout, /CHANGED "\/a": 1 -> 2/);
  const missing = run('before.json', 'missing.json', '--json');
  assert.equal(missing.status, 2);
  assert.ok(JSON.parse(missing.stdout).error);
  assert.equal(run('--unknown').status, 2);
  assert.equal(run().status, 2);
  assert.equal(run('before.json').status, 2);
  assert.equal(run('--help').status, 0);
});

test('CLI escapes terminal controls from keys and values', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'before.json'), '{}');
  await writeFile(path.join(root, 'after.json'), JSON.stringify({ ['line\n\u001b[31m']: 'value\u001b[0m' }));
  const result = spawnSync(process.execPath, [cli, 'before.json', 'after.json'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.ok(!result.stdout.includes('\u001b'));
  assert.match(result.stdout, /\\u001b/);
});
