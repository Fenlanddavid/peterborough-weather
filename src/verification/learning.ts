import { finite, HOUR, localDate } from '../data/contracts.ts';
import { blendValue, leadBand, MODEL_VERSION, DEFAULT_VERSION, validatePolicy } from '../forecast/policy.ts';
import type { BlendPolicy, PolicyRule, PolicyVariable, WeightedSource } from '../forecast/policy.ts';

export const LEARNING_GATES = { trainCases: 200, trainDates: 20, testDates: 7, testCases: 70, coverage: 0.8, events: 50, nonEvents: 50, improvement: 0.05, deterioration: 0.05, temperatureAbsolute: 0.1, gustAbsolute: 0.2, amountAbsolute: 0.05, brierAbsolute: 0.005, eventDeterioration: 0.05 };
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;
export const weekStart = (time: number) => Math.floor((time - 4 * DAY) / WEEK) * WEEK + 4 * DAY; // Monday 00 UTC
export interface LearningCase {
  id: string; generatedAt: number; location: string; latitude: number; longitude: number;
  start: number; end: number; leadHours: number; variable: PolicyVariable; unit: string;
  definition: string; modelVersion: string; policyVersion: string;
  defaultVersion?: string;
  sources: WeightedSource[]; defaultValue: number; activeValue: number;
  candidates: Record<string, number>; sourceVersions: string[];
  unadjustedValue?: number | null; metOfficeValue?: number;
  disagreement?: { difference: number; flagged: boolean };
  probabilityBasis?: 'ensemble-probability' | 'supplied-probability';
}
export interface LearningObservation {
  id: string; location: string; latitude: number; longitude: number; start: number; end: number;
  variable: PolicyVariable; unit: string; definition: string; value: number;
  quality: 'accepted' | 'provisional' | 'rejected'; collectedAt: number;
}
export interface PairedCase extends LearningCase { observed: number; observationId: string }
export interface Scores { n: number; dates: number; primary: number; bias: number; amountMAE: number | null; falseAlarms: number | null; misses: number | null; reliability: { count: number; forecast: number | null; observed: number | null }[]; persistence: number | null; climatology: number | null }
export interface EvaluationBlock { start: number; end: number; adequate: boolean; success: boolean; deteriorated: boolean; reason: string; baseline: Scores | null; candidate: Scores | null; coverage: number }
export interface Candidate { id: string; rule: PolicyRule; createdAt: number; trainingEnd: number; trainingCases: number; trainingDates: number; signature: string; blocks: EvaluationBlock[]; state: 'pending' | 'rejected' | 'promoted' }
export interface LearningState {
  schema: 1; modelVersion: string; defaultVersion: string; evaluatedAt: number; candidates: Candidate[];
  active?: BlendPolicy; monitoring: Record<string, EvaluationBlock[]>;
  changes: { time: number; version: string; reason: string }[];
}
export const newLearningState = (): LearningState => ({ schema: 1, modelVersion: MODEL_VERSION, defaultVersion: DEFAULT_VERSION, evaluatedAt: 0, candidates: [], monitoring: {}, changes: [] });
export function validateLearningState(raw: unknown, now = Date.now()): LearningState {
  const state = raw as LearningState;
  if (!state || state.schema !== 1 || state.modelVersion !== MODEL_VERSION || state.defaultVersion !== DEFAULT_VERSION || !finite(state.evaluatedAt) || !Array.isArray(state.candidates) || !state.monitoring || !Array.isArray(state.changes)) throw new RangeError('Incompatible learning state');
  const validBlock = (b: EvaluationBlock) => b && finite(b.start) && finite(b.end) && b.end - b.start === WEEK && typeof b.adequate === 'boolean' && typeof b.success === 'boolean' && typeof b.deteriorated === 'boolean' && finite(b.coverage) && (!b.success || b.adequate && b.baseline && b.candidate && [b.baseline.primary, b.candidate.primary, b.baseline.n, b.candidate.n, b.baseline.dates, b.candidate.dates].every(finite) && b.baseline.n === b.candidate.n && b.baseline.dates >= 7 && b.candidate.primary < b.baseline.primary);
  for (const c of state.candidates) {
    if (!c || typeof c.id !== 'string' || !['pending', 'rejected', 'promoted'].includes(c.state) || !finite(c.createdAt) || c.createdAt > now || !finite(c.trainingEnd) || c.trainingEnd > c.createdAt || !finite(c.trainingCases) || !finite(c.trainingDates) || c.trainingCases < 200 || c.trainingDates < 20 || typeof c.signature !== 'string' || !Array.isArray(c.blocks) || c.blocks.some(b => !validBlock(b))) throw new RangeError('Malformed candidate/evaluation archive');
    validatePolicy({ schema: 1, version: c.id, modelVersion: MODEL_VERSION, createdAt: now, expiresAt: now + DAY, rules: [c.rule], evidence: { observationThrough: now, trainingCases: c.trainingCases, trainingDates: c.trainingDates, heldOutDates: 7, successfulBlocks: 2 } }, now);
  }
  if (Object.values(state.monitoring).some(blocks => !Array.isArray(blocks) || blocks.some(b => !validBlock(b)))) throw new RangeError('Malformed monitoring archive');
  return state;
}
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const dateCount = (rows: { start: number }[]) => new Set(rows.map(r => localDate(r.start))).size;
const probability = (variable: string) => variable === 'precipitation_probability';
const signature = (rows: LearningCase[]) => [...new Set(rows.flatMap(r => r.sources.map(s => `${s.family}:${s.modelId}`)))].sort().join('|');
const applies = (r: LearningCase, rule: PolicyRule) => r.location === rule.location && r.variable === rule.variable && (rule.band === -1 || leadBand(r.leadHours) === rule.band);
export function predictCase(row: LearningCase, rule?: PolicyRule): number {
  const raw = blendValue(row.sources, rule, probability(row.variable) ? 0 : row.leadHours)!;
  return probability(row.variable) ? Math.max(0, Math.min(1, raw * (rule?.occurrenceSlope ?? 1) + (rule?.occurrenceIntercept ?? 0))) : raw;
}
export function matchLearning(cases: LearningCase[], observations: LearningObservation[]): PairedCase[] {
  const index = new Map<string, LearningObservation>();
  for (const o of observations) {
    if (o.quality !== 'accepted' || !finite(o.value) || !finite(o.start) || !finite(o.end) || !finite(o.latitude) || !finite(o.longitude)) continue;
    index.set(`${o.location}:${o.variable}:${o.start}:${o.end}:${o.unit}:${o.definition}`, o);
  }
  return cases.flatMap(c => {
    if ((c.defaultVersion ?? c.policyVersion) !== DEFAULT_VERSION || c.modelVersion !== MODEL_VERSION || c.generatedAt > c.start || c.leadHours < 0 || c.leadHours > 168 || !finite(c.defaultValue) || !finite(c.activeValue) || !c.sources.length || c.sources.some(s => !finite(s.value)) || probability(c.variable) && !c.probabilityBasis) return [];
    const o = index.get(`${c.location}:${c.variable}:${c.start}:${c.end}:${c.unit}:${c.definition}`);
    if (!o || Math.abs(o.latitude - c.latitude) > 0.001 || Math.abs(o.longitude - c.longitude) > 0.001) return [];
    return [{ ...c, observed: o.value, observationId: o.id }];
  });
}
/** One generation per valid interval/band avoids counting the same observation many
 * times. All competitors use this identical chronological paired cohort. */
export function independentCases(rows: PairedCase[]): PairedCase[] {
  const map = new Map<string, PairedCase>();
  for (const r of [...rows].sort((a, b) => a.generatedAt - b.generatedAt)) {
    const key = `${r.location}:${r.variable}:${r.start}:${r.end}`;
    if (!map.has(key)) map.set(key, r);
  }
  return [...map.values()].sort((a, b) => a.start - b.start);
}
export function scoreCases(rows: PairedCase[], values: number[], history: PairedCase[] = []): Scores {
  const errors = rows.map((r, i) => values[i] - r.observed);
  const isProbability = probability(rows[0]?.variable);
  const event = rows.map(r => r.observed >= (isProbability ? 0.5 : r.variable === 'wind_gusts_10m' ? 30 / 2.23694 : r.variable === 'precipitation' ? 0.2 : Infinity));
  const forecastEvent = values.map(v => v >= (isProbability ? 0.5 : rows[0]?.variable === 'wind_gusts_10m' ? 30 / 2.23694 : rows[0]?.variable === 'precipitation' ? 0.2 : Infinity));
  const actualEvents = event.filter(Boolean).length; const nonEvents = rows.length - actualEvents;
  const reliability = Array.from({ length: isProbability ? 5 : 0 }, (_, i) => {
    const indices = values.flatMap((v, j) => Math.min(4, Math.floor(v * 5)) === i ? [j] : []);
    return { count: indices.length, forecast: indices.length ? mean(indices.map(j => values[j])) : null, observed: indices.length ? mean(indices.map(j => rows[j].observed)) : null };
  });
  const prior = [...history].sort((a, b) => a.start - b.start);
  const persistenceErrors: number[] = []; const climateErrors: number[] = [];
  for (const r of rows) {
    const previous = prior.filter(p => p.start < r.generatedAt && p.end <= r.generatedAt && p.location === r.location && p.variable === r.variable);
    if (!previous.length) continue;
    const error = (v: number) => isProbability ? (v - r.observed) ** 2 : Math.abs(v - r.observed);
    persistenceErrors.push(error(previous.at(-1)!.observed));
    climateErrors.push(error(mean(previous.map(p => p.observed))));
  }
  return { n: rows.length, dates: dateCount(rows), primary: rows.length ? mean(errors.map(e => isProbability ? e ** 2 : Math.abs(e))) : NaN, bias: rows.length ? mean(errors) : NaN, amountMAE: rows[0]?.variable === 'precipitation' && rows.length ? mean(errors.map(Math.abs)) : null,
    falseAlarms: nonEvents && (isProbability || rows[0]?.variable === 'precipitation' || rows[0]?.variable === 'wind_gusts_10m') ? forecastEvent.filter((v, i) => v && !event[i]).length / nonEvents : null,
    misses: actualEvents && (isProbability || rows[0]?.variable === 'precipitation' || rows[0]?.variable === 'wind_gusts_10m') ? forecastEvent.filter((v, i) => !v && event[i]).length / actualEvents : null,
    reliability, persistence: persistenceErrors.length ? mean(persistenceErrors) : null, climatology: climateErrors.length ? mean(climateErrors) : null };
}
export function fitRule(rows: PairedCase[], band: number): PolicyRule | null {
  rows = independentCases(rows);
  if (rows.length < LEARNING_GATES.trainCases || dateCount(rows) < LEARNING_GATES.trainDates) return null;
  const first = rows[0];
  if (probability(first.variable) && (rows.filter(r => r.observed === 1).length < LEARNING_GATES.events || rows.filter(r => r.observed === 0).length < LEARNING_GATES.nonEvents)) return null;
  const rule: PolicyRule = { variable: first.variable, band, location: first.location, familyFactors: {}, modelFactors: {}, metOfficeShare: 0.5, temperatureCorrection: 0, occurrenceSlope: 1, occurrenceIntercept: 0 };
  // Bounded inverse-error scores with strong shrinkage towards equal weights.
  const models = [...new Set(rows.flatMap(r => r.sources.map(s => s.modelId)))].filter(id => id !== 'metoffice_blended');
  const complete = rows.filter(r => models.every(id => r.sources.some(s => s.modelId === id)));
  if (complete.length < LEARNING_GATES.trainCases || dateCount(complete) < LEARNING_GATES.trainDates) return null;
  const losses = models.map(id => ({ id, loss: mean(complete.map(r => { const error = r.sources.find(s => s.modelId === id)!.value - r.observed; return probability(first.variable) ? error ** 2 : Math.abs(error); })) }));
  const average = mean(losses.map(s => s.loss));
  for (const item of losses) rule.modelFactors[item.id] = Math.max(0.5, Math.min(1.5, 1 + 0.25 * (average / Math.max(0.05, item.loss) - 1)));
  if (band === 0 || band === 1) {
    const ukv = losses.find(s => s.id === 'ukmo_uk_deterministic_2km');
    if (ukv && ukv.loss < average) rule.modelFactors[ukv.id] = Math.min(1.5, Math.max(rule.modelFactors[ukv.id], 1.25));
  }
  const withProcessed = complete.filter(r => r.sources.some(s => s.modelId === 'metoffice_blended'));
  if (withProcessed.length >= LEARNING_GATES.trainCases && dateCount(withProcessed) >= LEARNING_GATES.trainDates) {
    // One small, regularised split adjustment. The same held-out gates apply.
    const choices = [0.4, 0.5, 0.6].map(share => ({ share, loss: mean(withProcessed.map(r => {
      const error = predictCase(r, { ...rule, metOfficeShare: share }) - r.observed;
      return probability(first.variable) ? error ** 2 : Math.abs(error);
    })) + (probability(first.variable) ? 0.05 : 0.5) * Math.abs(share - 0.5) }));
    rule.metOfficeShare = choices.sort((a, b) => a.loss - b.loss || Math.abs(a.share - 0.5) - Math.abs(b.share - 0.5))[0].share;
  }
  if (first.variable === 'temperature_2m') rule.temperatureCorrection = Math.max(-1, Math.min(1, mean(complete.map(r => r.observed - predictCase(r, rule))) * 0.5));
  // Rain occurrence is fitted only from genuine distributions. Amounts never get offsets.
  if (probability(first.variable)) {
    const x = complete.map(r => predictCase(r, rule)); const y = complete.map(r => r.observed);
    const mx = mean(x); const my = mean(y);
    const covariance = mean(x.map((v, i) => (v - mx) * (y[i] - my)));
    const variance = mean(x.map(v => (v - mx) ** 2));
    rule.occurrenceSlope = Math.max(0.75, Math.min(1.25, (covariance + 0.2) / (variance + 0.2)));
    rule.occurrenceIntercept = Math.max(-0.1, Math.min(0.1, 0.5 * (my - rule.occurrenceSlope * mx)));
  }
  return rule;
}
const absoluteGate = (variable: string) => variable === 'temperature_2m' ? LEARNING_GATES.temperatureAbsolute : variable === 'wind_gusts_10m' ? LEARNING_GATES.gustAbsolute : probability(variable) ? LEARNING_GATES.brierAbsolute : LEARNING_GATES.amountAbsolute;
export function evaluateBlock(rows: PairedCase[], rule: PolicyRule, start: number, end: number, generatedAfter: number, history: PairedCase[] = [], useActive = false): EvaluationBlock {
  const requested = rows.filter(r => applies(r, rule) && r.start >= start && r.start < end && r.generatedAt >= generatedAfter);
  const paired = independentCases(requested).filter(r => useActive || finite(predictCase(r, rule)));
  // Expected hourly or three-hour coverage for every held-out date, per lead band.
  const interval = paired[0] ? Math.max(HOUR, paired[0].end - paired[0].start) : HOUR;
  const expected = (end - start) / interval;
  const coverage = paired.length / expected;
  const adequate = paired.length >= Math.min(LEARNING_GATES.testCases, Math.ceil(expected * LEARNING_GATES.coverage)) && dateCount(paired) >= LEARNING_GATES.testDates && coverage >= LEARNING_GATES.coverage;
  if (!adequate) return { start, end, adequate: false, success: false, deteriorated: false, reason: 'Insufficient subsequent held-out dates or paired coverage', baseline: null, candidate: null, coverage };
  const baseline = scoreCases(paired, paired.map(r => r.defaultValue), history);
  const candidate = scoreCases(paired, paired.map(r => useActive ? r.activeValue : predictCase(r, rule)), history);
  const improvement = baseline.primary - candidate.primary;
  const eventSafe = (['falseAlarms', 'misses'] as const).every(k => baseline[k] === null || candidate[k] === null || candidate[k]! - baseline[k]! <= LEARNING_GATES.eventDeterioration);
  // Leave each date out: one exceptional day cannot account for the gain.
  const dates = [...new Set(paired.map(r => localDate(r.start)))];
  const robust = dates.every(date => {
    const rest = paired.filter(r => localDate(r.start) !== date);
    return scoreCases(rest, rest.map(r => r.defaultValue)).primary > scoreCases(rest, rest.map(r => useActive ? r.activeValue : predictCase(r, rule))).primary;
  });
  const eventCounts = !probability(rule.variable) || paired.filter(r => r.observed === 1).length >= 10 && paired.filter(r => r.observed === 0).length >= 10;
  const success = improvement >= absoluteGate(rule.variable) && improvement >= baseline.primary * LEARNING_GATES.improvement && eventSafe && robust && eventCounts;
  return { start, end, adequate, success, deteriorated: candidate.primary > baseline.primary * (1 + LEARNING_GATES.deterioration), reason: success ? 'Paired held-out improvement and event/robustness gates passed' : 'Held-out improvement, event counts or robustness gate failed', baseline, candidate, coverage };
}
export function evaluateLearning(previous: LearningState, cases: LearningCase[], observations: LearningObservation[], now = Date.now()): LearningState {
  let state: LearningState = structuredClone(previous);
  if (!state || state.schema !== 1 || state.modelVersion !== MODEL_VERSION || state.defaultVersion !== DEFAULT_VERSION || !Array.isArray(state.candidates)) state = newLearningState();
  const boundary = weekStart(now - 2 * DAY); // allow delayed rainfall/observation publication
  if (state.evaluatedAt >= boundary) return state;
  const pairs = matchLearning(cases, observations.filter(o => o.end <= now && o.collectedAt <= now));
  if (state.active) {
    const currentEvidence = pairs.filter(p => state.active!.rules.some(r => applies(p, r)) && p.end >= now - 14 * DAY);
    if (currentEvidence.length >= LEARNING_GATES.testCases) state.active.evidence.observationThrough = Math.max(...currentEvidence.map(p => p.end));
    try { validatePolicy(state.active, now); } catch {
      state.changes.push({ time: now, version: DEFAULT_VERSION, reason: 'Active policy expired or observation evidence/model schema unsuitable; conservative fallback' });
      delete state.active;
    }
  }
  if (state.active) {
    const retained: PolicyRule[] = [];
    for (const rule of state.active.rules) {
      const key = `${rule.location}:${rule.variable}:${rule.band}`;
      const block = evaluateBlock(pairs.filter(p => p.policyVersion === state.active!.version), rule, boundary - WEEK, boundary, state.active.createdAt, pairs.filter(p => p.start < boundary - WEEK), true);
      const blocks = state.monitoring[key] ?? [];
      if (!blocks.some(b => b.start === block.start)) blocks.push(block);
      state.monitoring[key] = blocks.slice(-8);
      const last = blocks.slice(-2);
      const unsuitable = !pairs.some(p => applies(p, rule) && p.start >= boundary - 14 * DAY);
      if (unsuitable || last.length === 2 && last[0].end === last[1].start && last.every(b => b.adequate && b.deteriorated)) state.changes.push({ time: now, version: DEFAULT_VERSION, reason: `${key}: ${unsuitable ? 'matching observations unavailable' : 'two subsequent weekly blocks deteriorated more than 5%'}; automatic rollback` });
      else retained.push(rule);
    }
    if (!retained.length) delete state.active;
    else state.active = { ...state.active, rules: retained, expiresAt: now + 28 * DAY, evidence: { ...state.active.evidence, observationThrough: Math.max(...pairs.filter(p => retained.some(r => applies(p, r))).map(p => p.end)) } };
  }
  for (const candidate of state.candidates.filter(c => c.state === 'pending')) {
    const matching = pairs.filter(p => applies(p, candidate.rule));
    const subsequent = matching.filter(p => p.generatedAt >= candidate.createdAt);
    if (subsequent.length && signature(subsequent) !== candidate.signature) { candidate.state = 'rejected'; continue; }
    const start = weekStart(candidate.createdAt) + WEEK;
    for (let blockStart = start; blockStart + WEEK <= boundary && candidate.blocks.length < 2; blockStart += WEEK) {
      if (candidate.blocks.some(b => b.start === blockStart)) continue;
      candidate.blocks.push(evaluateBlock(matching.filter(p => finite(p.candidates[candidate.id]) && Math.abs(p.candidates[candidate.id] - predictCase(p, candidate.rule)) < 1e-9), candidate.rule, blockStart, blockStart + WEEK, candidate.createdAt, matching.filter(p => p.start < blockStart)));
    }
    if (candidate.blocks.some(b => !b.success)) candidate.state = 'rejected';
    if (candidate.blocks.length === 2 && candidate.blocks.every(b => b.success)) {
      candidate.state = 'promoted';
      const rules = [...(state.active?.rules ?? []).filter(r => !(r.variable === candidate.rule.variable && r.location === candidate.rule.location && r.band === candidate.rule.band)), candidate.rule];
      state.active = { schema: 1, version: `observed-${boundary}-${state.changes.length}`, modelVersion: MODEL_VERSION, createdAt: now, expiresAt: now + 28 * DAY, rules, evidence: { observationThrough: Math.max(...matching.map(p => p.end)), trainingCases: candidate.trainingCases, trainingDates: candidate.trainingDates, heldOutDates: 14, successfulBlocks: 2 } };
      validatePolicy(state.active, now);
      state.changes.push({ time: now, version: state.active.version, reason: `${candidate.id}: frozen candidate passed two subsequent non-overlapping weekly blocks` });
    }
  }
  const groups = new Map<string, PairedCase[]>();
  for (const p of pairs.filter(p => p.end < boundary && p.start >= boundary - 60 * DAY)) {
    const key = `${p.location}:${p.variable}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  for (const rows of groups.values()) {
    // Fit broad bands when supported; otherwise one shared band reduces parameters.
    const bands = [...new Set(rows.map(r => leadBand(r.leadHours)))];
    const banded = bands.map(band => ({ band, rows: rows.filter(r => leadBand(r.leadHours) === band) }));
    const training = banded.every(g => independentCases(g.rows).length >= LEARNING_GATES.trainCases && dateCount(g.rows) >= LEARNING_GATES.trainDates) ? banded : [{ band: -1, rows }];
    for (const group of training) {
      const rule = fitRule(group.rows, group.band);
      if (!rule || state.candidates.some(c => c.state === 'pending' && c.rule.location === rule.location && c.rule.variable === rule.variable && c.rule.band === rule.band)) continue;
      const selected = independentCases(group.rows);
      state.candidates.push({ id: `candidate-${rule.location}-${rule.variable}-${rule.band}-${boundary}`, rule, createdAt: now, trainingEnd: boundary, trainingCases: selected.length, trainingDates: dateCount(selected), signature: signature(selected), blocks: [], state: 'pending' });
    }
  }
  state.candidates = state.candidates.filter(c => c.createdAt > now - 120 * DAY);
  state.changes = state.changes.slice(-100);
  state.evaluatedAt = boundary;
  return state;
}

/** Derive publication-only weight rules; source state remains observation-scoped.
 * Rebuilding from active sources automatically removes transfers on rollback. */
export function derivePeterboroughPolicy(policy: BlendPolicy | undefined, conflicts: string[] = []): BlendPolicy | undefined {
  if (!policy) return;
  const sources = policy.rules.filter(r => r.derivedFrom === undefined);
  const grouped = new Map<string, PolicyRule[]>();
  for (const rule of sources.filter(r => r.location !== 'peterborough')) {
    const key = `peterborough:${rule.variable}:${rule.band}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(rule);
  }
  const derived: PolicyRule[] = [];
  for (const [key, rules] of grouped) {
    if (rules.length !== 1 || sources.some(r => `${r.location}:${r.variable}:${r.band}` === key)) { conflicts.push(key); continue; }
    const rule = rules[0];
    derived.push({ ...structuredClone(rule), location: 'peterborough', derivedFrom: `${rule.location}:${rule.variable}:${rule.band}`, temperatureCorrection: 0, occurrenceSlope: 1, occurrenceIntercept: 0 });
  }
  return { ...structuredClone(policy), rules: [...structuredClone(sources), ...derived] };
}
