import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { collectForecastUpgrade, forecastStore } from '../scripts/lib/forecastCollector.ts';
import { HOUR } from '../src/data/contracts.ts';
import { DEFAULT_VERSION } from '../src/forecast/policy.ts';
import { buildForecastSignals } from '../src/forecast/signals.ts';
import { validateForecastProduct, validatePolicyProduct } from '../src/forecast/product.ts';
const fixture = async (name: string) => JSON.parse(await readFile(new URL(`fixtures/live/${name}.response.txt`, import.meta.url), 'utf8'));

test('scheduled collection publishes reproducible app forecasts, source inputs and safe defaults without a browser/key', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pb-collector-upgrade-'));
  const root = pathToFileURL(directory + '/'); const store = forecastStore(root);
  const now = Date.parse('2026-10-21T18:40:00Z');
  const single = await fixture('single-runs');
  const ensemble = Object.fromEntries(await Promise.all(['ecmwf_ifs025', 'gfs025', 'ukmo_global_ensemble_20km'].map(async m => [m, await fixture(`runtime-ensemble-${m}`)])));
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async input => {
    requests++;
    const url = new URL(String(input));
    let body: unknown;
    if (url.pathname.endsWith('/static/meta.json')) body = { last_run_initialisation_time: (Math.floor(now / (6 * HOUR)) * 6 * HOUR - 6 * HOUR) / 1000, last_run_availability_time: (now - HOUR) / 1000, update_interval_seconds: url.pathname.includes('ukmo_uk') ? 3600 : 21600, temporal_resolution_seconds: 3600 };
    else if (url.hostname === 'single-runs-api.open-meteo.com' || url.hostname === 'api.open-meteo.com') body = { ...single, latitude: Number(url.searchParams.get('latitude')), longitude: Number(url.searchParams.get('longitude')), elevation: Number(url.searchParams.get('elevation') ?? 12) };
    else if (url.hostname === 'ensemble-api.open-meteo.com') body = ensemble[url.searchParams.get('models')!];
    else if (url.pathname.endsWith('/id/stations')) body = { items: [{ stationReference: 'fixture', lat: 52.58, long: -0.24, measures: [{ '@id': 'https://environment.data.gov.uk/flood-monitoring/id/measures/fixture', parameter: 'rainfall', period: 900, unitName: 'mm' }] }] };
    else if (url.pathname.endsWith('/id/measures/fixture')) body = { items: { valueType: 'total' } };
    else if (url.pathname.endsWith('/readings')) body = { items: [] };
    return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404, headers: { 'content-type': 'application/json' } });
  };
  try {
    await store.save('obs/egxt.json', { station: { id: 'EGXT', name: 'Wittering', latitude: 52.61, longitude: -0.47, elevation: 84 }, observations: [] });
    await collectForecastUpgrade(root, undefined, now);
    const published = validateForecastProduct(await store.read('forecast/latest.json', null));
    assert.ok(published.runs.length > 0); assert.ok(published.operational);
    const policy = validatePolicyProduct(await store.read('forecast/policy.json', null), now);
    assert.equal(policy.policy, null);
    const files = await readdir(new URL('forecast/archive/', root)); assert.equal(files.length, 1);
    const generations = JSON.parse(gunzipSync(await readFile(new URL(`forecast/archive/${files[0]}`, root))).toString());
    assert.equal(generations.length, 1);
    const generation = generations[0]; assert.equal(generation.policyVersion, DEFAULT_VERSION);
    assert.ok(generation.inputs.length > 50); assert.ok(generation.contextPath);
    for (const path of [generation.inputs[0].path, generation.contextPath]) assert.ok(JSON.parse(gunzipSync(await readFile(new URL(path, root))).toString()));
    const index = buildForecastSignals(published.runs, now, { updates: published.updates, operational: published.operational });
    const central = generation.cases.find((c: any) => c.location === 'peterborough' && c.variable === 'temperature_2m');
    assert.ok(central); assert.equal(central.defaultValue, index.mean('temperature_2m', central.start, true));
    assert.equal(central.generatedAt, now); assert.ok(central.sourceVersions.length > 0);
    assert.ok(generation.cases.some((c: any) => c.variable === 'precipitation_probability' && c.probabilityBasis === 'ensemble-probability'));
    assert.ok(generation.cases.some((c: any) => c.variable === 'wind_gusts_10m'));
    const count = requests;
    await collectForecastUpgrade(root, undefined, now + 5 * 60_000);
    assert.equal(requests, count, 'repeated scheduled invocation uses the collection gate');
    // A corrupt learning file must not block new weather or accidentally activate weights.
    await writeFile(new URL('forecast/learning-state.json', root), 'corrupt');
    await collectForecastUpgrade(root, undefined, now + HOUR);
    assert.equal(validatePolicyProduct(await store.read('forecast/policy.json', null), now + HOUR).policy, null);
    assert.ok((await store.read<any>('forecast/diagnostics.json', null)).failures.some((s: string) => s.includes('Corrupt learning state rejected')));
  } finally { globalThis.fetch = originalFetch; await rm(directory, { recursive: true, force: true }); }
});
