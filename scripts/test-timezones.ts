import { readdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const files = (await readdir(new URL('../tests/', import.meta.url))).filter(n => n.endsWith('.test.ts')).sort().map(n => `tests/${n}`);
const results = [];
for (const timezone of ['UTC', 'Europe/London']) {
  const begin = Date.now();
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', '--test-reporter=tap', ...files], { cwd: new URL('../', import.meta.url), env: { ...process.env, TZ: timezone }, encoding: 'utf8' });
  const summary = { timezone, files: files.length, exitCode: result.status, milliseconds: Date.now() - begin, passedFiles: Number(/# pass (\d+)/.exec(result.stdout)?.[1] ?? (result.status === 0 ? files.length : 0)), failedFiles: Number(/# fail (\d+)/.exec(result.stdout)?.[1] ?? 0) };
  results.push(summary); console.log(JSON.stringify(summary));
  if (result.status !== 0) { console.error(result.stdout, result.stderr); process.exitCode = 1; }
}
await writeFile(new URL('../docs/test-timezones.json', import.meta.url), JSON.stringify({ recordedAt: new Date().toISOString(), results }, null, 2) + '\n');
