import { readFile, stat } from 'node:fs/promises';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const segment = key => key.replace(/~/g, '~0').replace(/\//g, '~1');

function equalValues(before, after) {
  const stack = [[before, after]];
  while (stack.length) {
    const [left, right] = stack.pop();
    if (left === right) continue;
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    for (const key of keys) {
      if (!Object.hasOwn(right, key)) return false;
      stack.push([left[key], right[key]]);
    }
  }
  return true;
}

function validate(value) {
  const stack = [{ value, depth: 0 }];
  while (stack.length) {
    const item = stack.pop();
    if (item.depth > 100) throw new Error('JSON exceeds the maximum depth of 100');
    if (typeof item.value === 'number' && !Number.isFinite(item.value)) throw new Error('JSON contains a number outside the finite JavaScript range');
    if (item.value !== null && typeof item.value === 'object') {
      for (const key of Object.keys(item.value)) stack.push({ value: item.value[key], depth: item.depth + 1 });
    }
  }
}

export async function readJson(file) {
  const info = await stat(file);
  if (!info.isFile()) throw new Error(`Not a file: ${file}`);
  if (info.size > 5 * 1024 * 1024) throw new Error(`JSON file exceeds 5 MiB: ${file}`);
  const bytes = await readFile(file);
  // Recheck the bytes actually read in case the file grew after stat.
  if (bytes.length > 5 * 1024 * 1024) throw new Error(`JSON file exceeds 5 MiB: ${file}`);
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error(`Invalid UTF-8: ${file}`); }
  let value;
  try { value = JSON.parse(source.replace(/^\uFEFF/, '')); }
  catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON: ${file}`);
    throw error;
  }
  validate(value);
  return value;
}

export function comparisonOptions({ arrays = 'atomic', exclude = [] } = {}) {
  if (arrays !== 'atomic' && arrays !== 'index') throw new Error('Expected array mode "atomic" or "index"');
  if (!Array.isArray(exclude) || exclude.some(pointer => typeof pointer !== 'string' ||
    (pointer !== '' && !pointer.startsWith('/')) || /~(?![01])/u.test(pointer))) {
    throw new Error('Exclusions must be JSON Pointer strings: empty for root, or starting with / and using only ~0 and ~1 escapes');
  }
  return { arrays, exclude: [...new Set(exclude)].sort() };
}

// Inputs are JSON-compatible values. Index mode compares positions, not identities.
export function compare(before, after, options = {}) {
  const { arrays, exclude: excluded } = comparisonOptions(options);
  validate(before);
  validate(after);
  const changes = [];
  const stack = [{ before, after, path: '' }];
  while (stack.length) {
    const current = stack.pop();
    if (excluded.some(pointer => pointer === '' || current.path === pointer || current.path.startsWith(`${pointer}/`))) continue;
    if (current.type) { changes.push(current); continue; }
    const { before: left, after: right, path } = current;
    if (object(left) && object(right)) {
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
      for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i];
        const childPath = `${path}/${segment(key)}`;
        if (!Object.hasOwn(left, key)) stack.push({ type: 'added', path: childPath, after: right[key] });
        else if (!Object.hasOwn(right, key)) stack.push({ type: 'removed', path: childPath, before: left[key] });
        else stack.push({ before: left[key], after: right[key], path: childPath });
      }
    } else if (arrays === 'index' && Array.isArray(left) && Array.isArray(right)) {
      for (let i = Math.max(left.length, right.length) - 1; i >= 0; i--) {
        const childPath = `${path}/${i}`;
        if (i >= left.length) stack.push({ type: 'added', path: childPath, after: right[i] });
        else if (i >= right.length) stack.push({ type: 'removed', path: childPath, before: left[i] });
        else stack.push({ before: left[i], after: right[i], path: childPath });
      }
    } else if (!equalValues(left, right)) changes.push({ type: 'changed', path, before: left, after: right });
  }
  return { equal: changes.length === 0, changes, ...(excluded.length ? { filters: { exclude: excluded } } : {}) };
}
