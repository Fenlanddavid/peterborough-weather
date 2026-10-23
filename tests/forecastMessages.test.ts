import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windOutlook } from '../src/metrics/forecastMessages.ts';
import type { EventEstimate } from '../src/data/contracts.ts';
const event = (value: number, basis: EventEstimate['basis'] = 'ensemble-probability'): EventEstimate => ({ basis, value, start: 0, end: 1, threshold: '30+', systems: [], usable: 0, expected: 0, status: 'ok', expectedAmount: null, conditionalAmount: null, provenance: [] });
test('wind outlook uses central gust or genuine probability, with central figure only', () => {
  assert.equal(windOutlook({ gustMph: 26, gustEvent: { ...event(0.23), upperAmount: 90 } }), null);
  assert.equal(windOutlook({ gustMph: 26, gustEvent: { ...event(1), upperAmount: 90 } }), '26 mph · 100% chance of 30+');
  assert.equal(windOutlook({ gustMph: 31, gustEvent: event(0.23) }), '31 mph');
  assert.equal(windOutlook({ gustMph: 26, gustEvent: event(1, 'deterministic-agreement') }), null);
  assert.equal(windOutlook({ gustMph: 26, gustEvent: event(0.4) }), '26 mph · 40% chance of 30+');
});
