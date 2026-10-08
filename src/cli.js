#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { compare, readJson } from './diff.js';

const help = `json-config-diff — compare two local JSON files

Usage: node src/cli.js before.json after.json [options]
  --arrays    Compare arrays as atomic values (default) or by index
  --exclude   Skip a JSON Pointer path and its descendants (repeatable)
  --json      Print a structured report
  -h, --help  Show this help

Exit codes: 0 equal, 1 differences, 2 argument or input error.
Index mode compares positions, without detecting moves. Files are never modified.
`;
const printable = text => String(text).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');

async function main() {
  let json = false;
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: {
      json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
      arrays: { type: 'string', default: 'atomic' },
      exclude: { type: 'string', multiple: true },
    } });
    json = values.json ?? false;
    if (values.help) { console.log(help); return; }
    if (positionals.length !== 2) throw new Error('Expected exactly two JSON file paths. Use --help for usage.');
    if (!['atomic', 'index'].includes(values.arrays)) throw new Error('Expected array mode "atomic" or "index"');
    const before = await readJson(positionals[0]);
    const after = await readJson(positionals[1]);
    const report = compare(before, after, { arrays: values.arrays, exclude: values.exclude });
    if (json) console.log(JSON.stringify(report, null, 2));
    else {
      if (report.filters) console.log(printable(`Excluded paths: ${JSON.stringify(report.filters.exclude)}`));
      for (const change of report.changes) {
        const location = change.path === '' ? '(root)' : JSON.stringify(change.path);
        const value = change.type === 'added' ? JSON.stringify(change.after)
          : change.type === 'removed' ? JSON.stringify(change.before)
            : `${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`;
        console.log(printable(`${change.type.toUpperCase()} ${location}: ${value}`));
      }
      console.log(report.equal ? 'No differences.' : `${report.changes.length} differences.`);
    }
    process.exitCode = report.equal ? 0 : 1;
  } catch (error) {
    if (json) console.log(JSON.stringify({ error: error.message }, null, 2));
    else console.error(printable(error.message));
    process.exitCode = 2;
  }
}

await main();
