import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Body, Illumination } from 'astronomy-engine';
import { darknessTimes, moonEvents, nightTimeline, observingNight, planetVisibility, position, eclipseCircumstances, moonBelowThroughout } from '../src/astro/ephemeris.ts';
import { parseIssTle, predictIssPasses, issVisibility } from '../src/astro/iss.ts';
import { HOUR, localInstant } from '../src/data/contracts.ts';
const read = async (path: string) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
test('fixed-date rise/set and civil twilight agree with independently retrieved USNO references', async () => {
  const oct21 = (await read('fixtures/reference/usno-2026-10-21.json')).properties.data;
  const oct22 = (await read('fixtures/reference/usno-2026-10-22.json')).properties.data;
  const night = darknessTimes('2026-10-21'); const moon = moonEvents('2026-10-21');
  const reference = (date: string, clock: string, offset = 1) => Date.parse(`${date}T${clock}:00Z`) - offset * HOUR;
  const time = (data: any, type: string, phenomenon: string) => data[type].find((p: any) => p.phen === phenomenon).time;
  const near = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 90_000, `${actual} differs from ${expected}`);
  near(night.sunset, reference('2026-10-21', time(oct21, 'sundata', 'Set')));
  near(night.sunrise, reference('2026-10-22', time(oct22, 'sundata', 'Rise')));
  near(night.civil!.start, reference('2026-10-21', time(oct21, 'sundata', 'End Civil Twilight')));
  near(night.civil!.end, reference('2026-10-22', time(oct22, 'sundata', 'Begin Civil Twilight')));
  near(moon.rise, reference('2026-10-21', time(oct21, 'moondata', 'Rise')));
  near(moon.set, reference('2026-10-22', time(oct22, 'moondata', 'Set')));
  // USNO's fraction is for local noon, not the app's 22:00 headline.
  const noon = Illumination(Body.Moon, new Date(localInstant('2026-10-21', 12))).phase_fraction;
  assert.ok(Math.abs(noon - parseInt(oct21.fracillum) / 100) < 0.01);
  assert.equal(moon.headlineTime, localInstant('2026-10-21', 22)); assert.equal(moon.waxing, true); assert.ok(moon.illumination > noon);
});
test('summer has no astronomical darkness; clock change retains repeated hours and after-midnight night identity', () => {
  assert.equal(darknessTimes('2026-06-21').astronomical, null);
  assert.ok(darknessTimes('2026-06-21').nautical);
  const samples = nightTimeline('2026-10-24');
  assert.equal(samples.at(-1)!.time - samples[0].time, 25 * HOUR);
  assert.equal(new Set(samples.map(s => s.time)).size, samples.length);
  assert.equal(observingNight(Date.parse('2026-10-25T01:30Z')), '2026-10-24');
  assert.equal(observingNight(Date.parse('2026-10-25T10:00Z')), '2026-10-25');
  assert.equal(moonEvents('2026-10-30').waxing, false);
});
test('Moon no-event cases stay bounded to the observing night and Moon-down labels cover the full window', () => {
  const moon = moonEvents('2026-10-21');
  assert.ok(moonBelowThroughout({ start: moon.set! + HOUR, end: moon.set! + 2 * HOUR }));
  assert.equal(moonBelowThroughout({ start: moon.rise! + HOUR, end: moon.rise! + 2 * HOUR }), false);
  const dates = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
  assert.ok(dates.map(moonEvents).some(m => m.rise === null || m.set === null));
});
test('Jupiter fixed-date geometric horizon coordinates and magnitude agree with independent JPL Horizons data', async () => {
  const raw = (await read('fixtures/reference/jpl-jupiter-2026-10-22.json')).result as string;
  const line = raw.split('$$SOE')[1].split('\n').find(l => l.includes('2026-Oct-22 00:00'))!;
  const columns = line.split(','); const azimuth = Number(columns[3]); const altitude = Number(columns[4]); const magnitude = Number(columns[5]);
  const time = Date.parse('2026-10-22T00:00Z'); const p = position(Body.Jupiter, time);
  assert.ok(Math.abs(p.azimuth - azimuth) < 0.02); assert.ok(Math.abs(p.altitude - altitude) < 0.02);
  assert.ok(Math.abs(Illumination(Body.Jupiter, new Date(time)).mag - magnitude) < 0.05);
  const planets = planetVisibility('2026-10-21');
  assert.deepEqual(planets.map(p => p.body), ['Mars', 'Jupiter', 'Saturn']);
  assert.ok(planets.every(p => p.highestAltitude > 10 && p.highestTime >= p.start && p.highestTime <= p.end));
});
test('eclipse portions are locally above the horizon, including lunar contacts', () => {
  const events = eclipseCircumstances(Date.parse('2026-10-21T00:00Z'));
  for (const event of events) for (const portion of event.visiblePortions) {
    assert.ok(portion.end > portion.start);
    assert.ok(position(event.body === 'Moon' ? Body.Moon : Body.Sun, (portion.start + portion.end) / 2).altitude > 0);
  }
});
test('ISS elements retain epoch; stale elements suppress passes, visible peaks require elevation, darkness and sunlight', async () => {
  const elements = parseIssTle(await readFile(new URL('fixtures/live/iss.response.txt', import.meta.url), 'utf8'));
  assert.equal(elements.modelId, 'NORAD 25544 / SGP4');
  assert.deepEqual(predictIssPasses(elements, elements.epoch + 73 * HOUR), []);
  const passes = predictIssPasses(elements, elements.epoch + 12 * HOUR);
  assert.ok(passes.length > 0);
  for (const pass of passes) {
    assert.ok(pass.end <= elements.epoch + 72 * HOUR);
    assert.ok(pass.peak >= pass.start && pass.peak <= pass.end);
    const peak = issVisibility(elements, pass.peak);
    assert.ok(peak.sunlit); assert.ok(peak.sunAltitude < -6); assert.ok(peak.elevationDegrees >= 10);
  }
  assert.throws(() => parseIssTle('<html>SPA fallback</html>'), /Invalid/);
});
