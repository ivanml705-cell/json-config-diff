// Presentation options never change equality or the comparator's report.
export function prepareReport(report, { summary = false, redactValues = false } = {}) {
  const output = { equal: report.equal };
  if (summary) {
    const counts = { added: 0, removed: 0, changed: 0, total: report.changes.length };
    for (const change of report.changes) counts[change.type]++;
    output.summary = counts;
  } else {
    output.changes = report.changes.map(change => redactValues
      ? { type: change.type, path: change.path } : { ...change });
  }
  if (report.filters) output.filters = { exclude: [...report.filters.exclude] };
  if (redactValues) output.valuesRedacted = true;
  return output;
}
