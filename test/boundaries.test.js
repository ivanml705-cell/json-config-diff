import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readJson, compare } from '../src/diff.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'json-config-boundaries-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('UTF-8 decoding preserves Unicode and rejects invalid bytes instead of replacing them', async t => {
  const root = await fixture(t);
  const file = path.join(root, 'unicode.json');
  const value = { 'español/日本語': '🚀', replacement: '\uFFFD', embeddedBom: '\uFEFF' };
  await writeFile(file, '\uFEFF' + JSON.stringify(value));
  assert.deepEqual(await readJson(file), value);
  // Isolated continuation byte, truncated sequence, overlong encoding, surrogate.
  for (const bytes of [[0x80], [0xc3], [0xc0, 0xaf], [0xed, 0xa0, 0x80]]) {
    await writeFile(file, Buffer.concat([Buffer.from('"DO_NOT_ECHO'), Buffer.from(bytes), Buffer.from('"')]));
    await assert.rejects(readJson(file), error => /Invalid UTF-8/.test(error.message) && !error.message.includes('DO_NOT_ECHO'));
  }
  await writeFile(file, '\uFEFF\uFEFF{}');
  await assert.rejects(readJson(file), /Invalid JSON/);
});

test('file size limit counts bytes including BOM and accepts exactly 5 MiB', async t => {
  const root = await fixture(t);
  const file = path.join(root, 'limit.json');
  const limit = 5 * 1024 * 1024;
  const payload = Buffer.alloc(limit, 0x20);
  Buffer.from('\uFEFF"é"').copy(payload);
  await writeFile(file, payload);
  assert.equal(await readJson(file), 'é');
  await writeFile(file, Buffer.concat([payload, Buffer.from(' ')]));
  await assert.rejects(readJson(file), /5 MiB/);
  await writeFile(file, '');
  await assert.rejects(readJson(file), /Invalid JSON/);
});

test('depth boundary works in both array modes and exclusions do not bypass validation', () => {
  let before = 1;
  let after = 2;
  for (let i = 0; i < 100; i++) { before = [before]; after = [after]; }
  const leaf = '/0'.repeat(100);
  assert.equal(compare(before, after).changes[0].path, '');
  assert.deepEqual(compare(before, after, { arrays: 'index' }).changes,
    [{ type: 'changed', path: leaf, before: 1, after: 2 }]);
  assert.equal(compare(before, after, { arrays: 'index', exclude: [leaf] }).equal, true);
  assert.throws(() => compare([before], [after], { exclude: [''] }), /depth/);
});

test('CLI rejects invalid UTF-8 in inputs and config with exit 2 and JSON errors', async t => {
  const root = await fixture(t);
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  await writeFile(path.join(root, 'valid.json'), '"\uFFFD"');
  await writeFile(path.join(root, 'invalid.json'), Buffer.from([0x22, 0x80, 0x22]));
  for (const args of [
    ['valid.json', 'invalid.json'],
    ['invalid.json', 'valid.json', '--exclude='],
    ['valid.json', 'valid.json', '--config', 'invalid.json'],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args, '--json'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(JSON.parse(result.stdout).error, /Invalid UTF-8/);
    assert.equal(result.stderr, '');
  }
});
