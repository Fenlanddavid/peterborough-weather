/** Optional public-repository collectors. No browser credentials or paid service. */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { scheduledFetch } from '../src/data/scheduler.ts';
import { parseMetars, evaluateVerification } from '../src/verification/verification.ts';
import type { Observation, VerificationForecast } from '../src/verification/verification.ts';
import { parseAuroraWatch } from '../src/sky/aurora.ts';
import { parseIssTle } from '../src/astro/iss.ts';
import { DETERMINISTIC_MODELS } from '../src/config/models.ts';
import { HOUR, finite, utc } from '../src/data/contracts.ts';
const root = new URL('../public/data/', import.meta.url);
await mkdir(new URL('obs/', root), { recursive: true });
await mkdir(new URL('verification/', root), { recursive: true });
async function read<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(new URL(path, root), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`Collector cache ${path}:`, error); return fallback; }
}
async function save(path: string, data: unknown) {
  const destination = new URL(path, root); const temporary = new URL(`${path}.tmp`, root);
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n';
  let previous: string | null = null;
  try { previous = await readFile(destination, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (previous === text) return false;
  await writeFile(temporary, text); await rename(temporary, destination); return true;
}
interface Archive { provider: string; station: Observation['station'] | null; observations: Observation[]; sourceTime: number | null; collectedAt: number; watermark: number | null; missingPeriods: string[] }
async function collectMetars() {
  const now = Date.now();
  const previous = await read<Archive>('obs/egxt.json', { provider: 'AviationWeather.gov METAR', station: null, observations: [], sourceTime: null, collectedAt: 0, watermark: null, missingPeriods: [] });
  const observations = new Map(previous.observations.map(o => [o.id, o]));
  // The service retains up to 30 days, caps most responses at 400 rows. One station/day stays bounded.
  const begin = Math.max(now - 30 * 24 * HOUR + HOUR, (previous.watermark ?? now - 30 * 24 * HOUR + HOUR) - 2 * HOUR);
  const gaps: string[] = [];
  let changed = false;
  for (let start = begin; start < now; start += 24 * HOUR) {
    const end = Math.min(now, start + 24 * HOUR);
    const params = new URLSearchParams({ ids: 'EGXT', format: 'json', date: new Date(end).toISOString(), hours: String(Math.ceil((end - start) / HOUR)) });
    try {
      const response = await scheduledFetch(`https://aviationweather.gov/api/data/metar?${params}`, { retries: 1 });
      const raw = response.status === 204 ? [] : await response.json();
      if (!Array.isArray(raw) || raw.length >= 400) throw new RangeError('METAR result cap reached or invalid schema; refusing truncated archive');
      const next = parseMetars(raw, now);
      if (!next.length) gaps.push(`${new Date(start).toISOString()}–${new Date(end).toISOString()}: no EGXT reports returned`);
      for (const o of next) if (!observations.has(o.id)) { observations.set(o.id, o); changed = true; }
    } catch (error) { gaps.push(`${new Date(start).toISOString()}: ${String(error)}`); console.error(gaps.at(-1)); }
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  const rows = [...observations.values()].filter(o => o.time >= now - 100 * 24 * HOUR).sort((a, b) => a.time - b.time);
  if (!rows.length) throw new Error('No valid METAR observations; previous archive retained');
  if (changed || gaps.length) await save('obs/egxt.json', { provider: 'AviationWeather.gov METAR', station: rows[0].station, observations: rows, sourceTime: rows.at(-1)!.time, collectedAt: now, watermark: gaps.length ? previous.watermark : now, missingPeriods: gaps });
  console.log(`METAR ${rows.length} reports across ${new Set(rows.map(o => new Date(o.time).toISOString().slice(0, 10))).size} UTC dates; ${gaps.length} gaps`);
}
async function collectWatch() {
  const xml = await (await scheduledFetch('https://aurorawatch-api.lancs.ac.uk/0.2/status/current-status.xml')).text();
  const parsed = parseAuroraWatch(xml);
  const previous = await read<{ xml?: string }>('aurorawatch.json', {});
  if (previous.xml !== xml) await save('aurorawatch.json', { xml, sourceTime: parsed.sourceTime, collectedAt: Date.now(), provider: parsed.provider });
}
async function collectIss() {
  const meta = await read<{ collectedAt?: number }>('iss-tle.meta.json', {});
  if (meta.collectedAt && Date.now() - meta.collectedAt < 12 * HOUR) return;
  const text = await (await scheduledFetch('https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE')).text();
  const parsed = parseIssTle(text);
  if (await save('iss-tle.txt', text)) await save('iss-tle.meta.json', { sourceTime: parsed.epoch, collectedAt: Date.now(), provider: parsed.provider });
}
async function collectVerification() {
  const now = Date.now();
  const archive = await read<Archive | null>('obs/egxt.json', null);
  if (!archive?.station) throw new Error('Collect EGXT observations before station-matched forecasts');
  const station = archive.station;
  const previous = await read<{ forecasts: VerificationForecast[] }>('verification/forecasts.json', { forecasts: [] });
  const key = (f: VerificationForecast) => `${f.modelId}:${f.validTime}:${f.leadHours}:${f.variable}`;
  const forecasts = new Map(previous.forecasts.map(f => [key(f), f]));
  const offsets = [1, 2, 3, 5, 7];
  const variables = offsets.flatMap(day => [`temperature_2m_previous_day${day}`, `wind_speed_10m_previous_day${day}`]);
  const failures: string[] = [];
  for (const model of DETERMINISTIC_MODELS) {
    const params = new URLSearchParams({ latitude: String(station.latitude), longitude: String(station.longitude), elevation: String(station.elevation), models: model.id, hourly: variables.join(','), past_days: '7', forecast_days: '1', timezone: 'GMT', wind_speed_unit: 'ms', temperature_unit: 'celsius' });
    try {
      const response = await scheduledFetch(`https://previous-runs-api.open-meteo.com/v1/forecast?${params}`, { optional: true });
      const raw = await response.json();
      if (!raw?.hourly || !Array.isArray(raw.hourly.time) || raw.utc_offset_seconds !== 0 || !finite(raw.latitude) || !finite(raw.longitude) || !finite(raw.elevation)) throw new RangeError('Invalid verification forecast location/time');
      for (const day of offsets) for (const variable of ['temperature', 'wind'] as const) {
        const field = `${variable === 'temperature' ? 'temperature_2m' : 'wind_speed_10m'}_previous_day${day}`;
        const unit = variable === 'temperature' ? '°C' : 'm/s';
        const values = raw.hourly[field];
        if (!Array.isArray(values)) continue;
        if (raw.hourly_units?.[field] !== unit || values.length !== raw.hourly.time.length) throw new RangeError(`Invalid verification units/length ${field}`);
        raw.hourly.time.forEach((time: unknown, i: number) => {
          const validTime = typeof time === 'string' ? utc(time) : NaN;
          if (!finite(validTime) || !finite(values[i]) || validTime > now) return;
          const f: VerificationForecast = { modelId: model.id, family: model.family, validTime, leadHours: day * 24, variable, value: values[i], station, forecastLocation: { latitude: raw.latitude, longitude: raw.longitude, elevation: raw.elevation }, provider: 'Open-Meteo Previous Runs', issuedAt: null, sourceTime: null, fetchedAt: now, unit, measurementCompatible: variable === 'temperature' };
          if (!forecasts.has(key(f))) forecasts.set(key(f), f);
        });
      }
    } catch (error) { const message = `${model.id}: ${String(error)}`; failures.push(message); console.error(message); }
  }
  const rows = [...forecasts.values()].filter(f => f.validTime >= now - 100 * 24 * HOUR).sort((a, b) => a.validTime - b.validTime || key(a).localeCompare(key(b)));
  if (!rows.length) throw new Error('No station forecasts; previous verification retained');
  await save('verification/forecasts.json', { station, forecasts: rows, collectedAt: now, failures, note: 'Fixed Previous Runs lead offsets. Nulls beyond each model horizon are excluded. Genuine run issue times are not supplied.' });
  const results = evaluateVerification(rows, archive.observations, now);
  const history = await read<{ evaluations: { time: number; results: typeof results }[] }>('verification/results.json', { evaluations: [] });
  const evaluations = [...history.evaluations.filter(e => e.time >= now - 100 * 24 * HOUR), { time: now, results }];
  await save('verification/results.json', { station, provider: 'AviationWeather / Open-Meteo Previous Runs', sourceTime: archive.sourceTime, collectedAt: now, results, evaluations, correctionEnabled: false, reweightingEnabled: false, failures });
}
const requested = process.argv.slice(2);
if (!requested.length) throw new Error('Specify metar, aurorawatch, iss or verification');
for (const source of requested) {
  try {
    if (source === 'metar') await collectMetars(); else if (source === 'aurorawatch') await collectWatch(); else if (source === 'iss') await collectIss(); else if (source === 'verification') await collectVerification(); else throw new Error(`Unknown collector ${source}`);
  } catch (error) { console.error(`${source}: ${String(error)}; existing valid files retained`); process.exitCode = 1; }
}
