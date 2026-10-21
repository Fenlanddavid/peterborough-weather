import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { sourceProbes } from '../src/data/probes.ts';
import { utc } from '../src/data/contracts.ts';

function productMetadata(report: Record<string, any>, body: string) {
  let data: any;
  try { data = JSON.parse(body); } catch { data = null; }
  const timestampKey = /^(?:time_tag|Observation Time|Forecast Time|last_run_(?:initialisation|availability|modification)_time|issued_at|issue_time)$/;
  report.sourceTimestamps = data && !Array.isArray(data) ? Object.fromEntries(Object.entries(data).filter(([key]) => timestampKey.test(key))) : null;
  if (Array.isArray(data)) {
    const records = data.filter(row => row && typeof row === 'object' && !Array.isArray(row));
    const times = records.flatMap(row => typeof row.time_tag === 'string' && Number.isFinite(utc(row.time_tag)) ? [utc(row.time_tag)] : typeof row.obsTime === 'number' ? [row.obsTime * 1000] : []);
    report.recordKeys = Object.keys(records[0] ?? {});
    report.range = times.length ? [new Date(Math.min(...times)).toISOString(), new Date(Math.max(...times)).toISOString()] : null;
    report.sourceTimestamps = { convention: 'Per-record time_tag (UTC) or METAR obsTime (Unix seconds)', range: report.range };
    report.units = null;
    report.unitNote = 'No response unit metadata; consult the documented product units (METAR raw wind is knots; normalisation is separate).';
    report.nullFields = records.reduce((counts: Record<string, number>, row) => { for (const [key, value] of Object.entries(row)) if (value === null) counts[key] = (counts[key] ?? 0) + 1; return counts; }, {});
  } else if (data === null) {
    const timestamp = /<datetime>([^<]+)<\/datetime>/.exec(body)?.[1];
    if (timestamp) { report.sourceTimestamps = { datetime: timestamp }; report.range = [timestamp, timestamp]; }
    const line = body.split(/\r?\n/).find(line => line.startsWith('1 25544'));
    if (line) {
      const field = line.slice(18, 32); const shortYear = Number(field.slice(0, 2)); const day = Number(field.slice(2));
      const epoch = Date.UTC(shortYear < 57 ? 2000 + shortYear : 1900 + shortYear, 0, 1) + (day - 1) * 86400_000;
      report.sourceTimestamps = { orbitalElementEpoch: new Date(epoch).toISOString(), rawEpoch: field };
      report.range = [new Date(epoch).toISOString(), new Date(epoch).toISOString()];
      report.rangeNote = 'One element epoch; this product does not provide an hourly forecast.';
      report.units = { tle: 'NORAD two-line orbital element format' };
    }
  }
}

const root = new URL('../tests/fixtures/live/', import.meta.url);
await mkdir(root, { recursive: true });
const origin = process.env.PAGES_ORIGIN ?? 'https://fenlanddavid.github.io';
const reports: Record<string, unknown>[] = [];
// Sequential: probes are live-network diagnostics, never part of npm test.
for (const probe of sourceProbes()) {
  if (process.argv[2] === '--report-only') break;
  if (process.argv[2] && !probe.id.includes(process.argv[2])) continue;
  const retrievedAt = new Date().toISOString();
  const report: Record<string, unknown> = { ...probe, parameters: Object.fromEntries(new URL(probe.url).searchParams), retrievedAt, intendedOrigin: origin };
  try {
    const response = await fetch(probe.url, { headers: { Origin: origin }, signal: AbortSignal.timeout(25_000) });
    const body = await response.text();
    Object.assign(report, { status: response.status, headers: Object.fromEntries(response.headers), browserReadable: 'unverified: run browser probe at deployed origin' });
    let data: any;
    try { data = JSON.parse(body); } catch { data = null; }
    report.schema = data === null ? 'text/XML/TLE' : Array.isArray(data) ? 'array' : Object.keys(data);
    productMetadata(report, body);
    if (data?.hourly) {
      const hourly = data.hourly;
      const keys = Object.keys(hourly).filter(k => k !== 'time');
      report.units = data.hourly_units;
      report.range = [hourly.time[0], hourly.time.at(-1)];
      report.variables = keys.map(key => ({ key, length: hourly[key]?.length, nullCount: hourly[key]?.filter((v: unknown) => v === null).length, representative: hourly[key]?.find((v: unknown) => typeof v === 'number') ?? null }));
      report.memberIdentities = keys.map(k => /_member(\d+)$/.exec(k)?.[1] ?? 'control/unsuffixed');
    } else report.representative = data === null ? body.slice(0, 1600) : Array.isArray(data) ? data.slice(-2) : { ...data, coordinates: data.coordinates?.slice(0, 3) };
    if (response.ok) await writeFile(new URL(`${probe.id}.response.txt`, root), body);
    else report.error = body.slice(0, 1500);
    await writeFile(new URL(`${probe.id}.meta.json`, root), JSON.stringify(report, null, 2) + '\n');
    console.log(probe.id, response.status, data?.hourly ? report.range : 'product');
  } catch (error) {
    report.error = String(error);
    console.log(probe.id, report.error);
  }
  reports.push(report);
}
const allReports = await Promise.all((await readdir(root)).filter(name => name.endsWith('.meta.json')).map(async name => {
  const report = JSON.parse(await readFile(new URL(name, root), 'utf8'));
  if (report.status === 200) productMetadata(report, await readFile(new URL(`${report.id}.response.txt`, root), 'utf8'));
  if (report.status === 200 && Array.isArray(report.variables)) {
    const response = JSON.parse(await readFile(new URL(`${report.id}.response.txt`, root), 'utf8'));
    report.variables = report.variables.map((v: any) => {
      const values = response.hourly[v.key] as (number | null)[];
      const numbers = values.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
      const first = values.findIndex(n => n !== null);
      const last = values.findLastIndex(n => n !== null);
      return { ...v, finiteCount: numbers.length, min: numbers.length ? Math.min(...numbers) : null, max: numbers.length ? Math.max(...numbers) : null, firstValid: first < 0 ? null : response.hourly.time[first], lastValid: last < 0 ? null : response.hourly.time[last] };
    });
  }
  await writeFile(new URL(name, root), JSON.stringify(report, null, 2) + '\n');
  return report as Record<string, unknown>;
}));
await writeFile(new URL('report.json', root), JSON.stringify(allReports, null, 2) + '\n');
const rows = allReports.filter(r => String(r.id).startsWith('ensemble-') || String(r.id).startsWith('sky-')).map(r => {
  const variables = r.variables as {key: string; nullCount: number; length: number}[] | undefined;
  return `| ${r.provider} | ${r.model} | ${new URL(String(r.url)).searchParams.get('hourly')} | ${r.status ?? 'network error'} | ${variables?.length ?? 0} | ${variables ? variables.every(v => v.nullCount === v.length) ? 'all null' : variables.some(v => v.nullCount) ? 'partial nulls' : 'finite (check min/max in sidecar)' : String(r.error ?? 'absent').replaceAll('|', '/').slice(0, 170)} |`;
});
const deterministicRows = allReports.filter(r => String(r.id).startsWith('deterministic-')).flatMap(r => (r.variables as any[] ?? []).map(v => `| ${r.model} | ${v.key} | ${r.status} | ${v.finiteCount}/${v.length} | ${v.firstValid ?? 'none'} | ${v.lastValid ?? 'none'} |`));
await mkdir(new URL('../docs/', import.meta.url), { recursive: true });
await writeFile(new URL('../docs/capabilities.md', import.meta.url), `# Live source capability probe\n\nReport assembled ${new Date().toISOString()}; individual retrieval times remain in the sidecars. Exact URLs, headers, units, keys, ranges and samples are in tests/fixtures/live/*.meta.json. Fixtures are real responses, not synthetic. Node headers do not confirm browser CORS; actual-origin results are in docs/browser-probes.json.\n\n| Source | Model | Variable | HTTP | Columns/members | Behaviour |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n\n## Single Runs actual non-null coverage (probed run, not a hard-coded model horizon)\n\n| Model | Variable | HTTP | Finite/returned hours | First valid UTC | Last valid UTC |\n|---|---|---|---|---|---|\n${deterministicRows.join('\n')}\n\nCombined production nine-day ensemble/core/optional requests are saved as runtime-*.response.txt and sidecars. All were HTTP 200. Negative IFS precipitation cells are finite but invalid; the parser excludes them as unknown and marks affected member windows partial.\n`);
