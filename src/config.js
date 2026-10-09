import { comparisonOptions, readJson } from './diff.js';

const keys = new Set(['arrays', 'exclude', 'summary', 'redactValues']);

export async function readConfig(file) {
  const config = await readJson(file);
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Configuration must be a JSON object');
  }
  for (const key of Object.keys(config)) {
    if (!keys.has(key)) throw new Error(`Unknown configuration option: ${JSON.stringify(key)}`);
  }
  comparisonOptions(config);
  for (const key of ['summary', 'redactValues']) {
    if (Object.hasOwn(config, key) && typeof config[key] !== 'boolean') {
      throw new Error(`Configuration option ${key} must be a boolean`);
    }
  }
  return config;
}

export function resolveOptions(config, cli) {
  for (const name of ['summary', 'redact-values']) {
    if (cli[name] && cli[`no-${name}`]) throw new Error(`Cannot combine --${name} and --no-${name}`);
  }
  if (cli['clear-excludes'] && cli.exclude) throw new Error('Cannot combine --exclude and --clear-excludes');
  return {
    ...comparisonOptions({
      arrays: cli.arrays ?? config.arrays,
      exclude: cli['clear-excludes'] ? [] : cli.exclude ?? config.exclude,
    }),
    summary: cli['no-summary'] ? false : cli.summary ?? config.summary ?? false,
    redactValues: cli['no-redact-values'] ? false : cli['redact-values'] ?? config.redactValues ?? false,
  };
}
