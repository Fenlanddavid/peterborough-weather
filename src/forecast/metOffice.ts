import { finite, HOUR, utc } from '../data/contracts.ts';
import type { Provenance } from '../data/contracts.ts';
import type { VariableId } from '../config/models.ts';

export const MET_OFFICE_BASE = 'https://data.hub.api.metoffice.gov.uk/mo-blended-prob-forecast-feature-svc/2.0.0';
export const DIAGNOSTIC_THRESHOLDS = { temperatureC: 3, gustMph: 10, precipitationProbability: 0.3 };
// Official v2 parameter mapping, not Global Spot or undocumented legacy diagnostics.
export const MET_OFFICE_PARAMETERS = [
  'airTemperature1p5m', 'windSpeed10m', 'windSpeedOfGust10mMaximumPt01h', 'windSpeedOfGust10mMaximumPt03h',
  'probabilityOfWindSpeedOfGustAboveThreshold10mMaximumPt01h', 'probabilityOfWindSpeedOfGustAboveThreshold10mMaximumPt03h',
  'probabilityOfLweThicknessOfPrecipitationAmountAboveThresholdSumPt01h', 'probabilityOfLweThicknessOfPrecipitationAmountAboveThresholdSumPt03h',
  'lweThicknessOfPrecipitationAmountSumPt01h', 'lweThicknessOfPrecipitationAmountSumPt03h', 'cloudAreaFraction',
] as const;
export interface Site { id: string; latitude: number; longitude: number; elevation: number | null; distanceKm: number }
export interface MetOfficeValue {
  parameter: string; variable: VariableId | 'precipitation_probability' | 'gust_probability';
  start: number; end: number; value: number; statistic: 'median' | 'percentile90' | 'probability';
  threshold?: number; comparison?: '>=' | '>'; unit: string;
}
export interface MetOfficeProduct extends Provenance {
  schema: 1; requested: { latitude: number; longitude: number }; site: Site;
  values: MetOfficeValue[]; diagnostics: string[];
  firstSeenAt?: number;
}
export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b.latitude - a.latitude) * rad / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin((b.longitude - a.longitude) * rad / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
interface Axis { values: (string | number)[]; bounds?: string[] }
interface Coverage { domain?: { axes?: Record<string, Axis> }; ranges?: Record<string, { axisNames: string[]; shape: number[]; values: (number | null)[] }>; parameters?: Record<string, { unit?: { symbol?: string | { value?: string } } }> }
export function parseMetOffice(raw: unknown, requested: { latitude: number; longitude: number }, issuedAt: number | null, fetchedAt = Date.now()): MetOfficeProduct {
  const data = raw as { coverages?: Coverage[]; parameters?: Coverage['parameters'] };
  if (!Array.isArray(data?.coverages) || !data.coverages.length || issuedAt !== null && (!finite(issuedAt) || issuedAt > fetchedAt)) throw new RangeError('Invalid Met Office CoverageCollection/issue time');
  const values: MetOfficeValue[] = [];
  const diagnostics: string[] = [];
  let site: Site | undefined;
  for (const coverage of data.coverages) {
    const axes = coverage.domain?.axes;
    if (!axes?.t || !axes.x || !axes.y || !axes.locationId) { diagnostics.push('Coverage missing site/time axes'); continue; }
    const point = { id: String(axes.locationId.values[0]), latitude: Number(axes.y.values[0]), longitude: Number(axes.x.values[0]), elevation: axes.z ? Number(axes.z.values[0]) : null, distanceKm: 0 };
    if (!finite(point.latitude) || Math.abs(point.latitude) > 90 || !finite(point.longitude) || Math.abs(point.longitude) > 180 || point.elevation !== null && !finite(point.elevation)) throw new RangeError('Invalid Met Office site');
    point.distanceKm = distanceKm(requested, point);
    if (site && (site.id !== point.id || distanceKm(site, point) > 0.01)) throw new RangeError('Met Office coverages refer to different sites');
    site = point;
    for (const [parameter, range] of Object.entries(coverage.ranges ?? {})) {
      if (!(MET_OFFICE_PARAMETERS as readonly string[]).includes(parameter)) continue;
      const symbol = (coverage.parameters ?? data.parameters)?.[parameter]?.unit?.symbol;
      const unit = typeof symbol === 'string' ? symbol : symbol?.value;
      if (!Array.isArray(range.axisNames) || !Array.isArray(range.shape) || range.axisNames.length !== range.shape.length || range.shape.some((n, i) => !Number.isInteger(n) || n < 1 || axes[range.axisNames[i]]?.values.length !== n) || !Array.isArray(range.values) || range.shape.reduce((a, b) => a * b, 1) !== range.values.length) { diagnostics.push(`${parameter}: invalid dimensions`); continue; }
      const probability = parameter.startsWith('probabilityOf');
      const variable = parameter === 'airTemperature1p5m' ? 'temperature_2m' : parameter === 'windSpeed10m' ? 'wind_speed_10m' : parameter === 'cloudAreaFraction' ? 'cloud_cover' : parameter.includes('Gust') ? probability ? 'gust_probability' : 'wind_gusts_10m' : probability ? 'precipitation_probability' : 'precipitation';
      const isRain = variable === 'precipitation' || variable === 'precipitation_probability';
      const expectedUnit = probability ? ['1', '%', 'fraction'] : variable === 'temperature_2m' ? ['K', 'degC', '°C'] : isRain ? ['m', 'mm', 'kg m-2'] : variable === 'cloud_cover' ? ['1', '%'] : ['m s-1', 'm/s'];
      if (!unit || !expectedUnit.includes(unit)) { diagnostics.push(`${parameter}: unsupported unit ${unit}`); continue; }
      const period = /Pt(\d+)h$/.exec(parameter);
      range.values.forEach((value, flat) => {
        if (!finite(value)) return;
        const index: Record<string, number> = {};
        let remainder = flat;
        for (let i = range.shape.length - 1; i >= 0; i--) { index[range.axisNames[i]] = remainder % range.shape[i]; remainder = Math.floor(remainder / range.shape[i]); }
        if (Object.entries(index).some(([key]) => !['t', 'x', 'y', 'z', 'locationId'].includes(key) && !/percentile|threshold/i.test(key))) return;
        const ti = index.t;
        const end = utc(String(axes.t.values[ti]));
        const start = period ? axes.t.bounds ? utc(axes.t.bounds[ti * 2]) : NaN : end;
        if (!finite(start) || !finite(end) || period && (!axes.t.bounds || utc(axes.t.bounds[ti * 2 + 1]) !== end || end - start !== Number(period[1]) * HOUR)) return;
        const extra = Object.entries(index).find(([key]) => /percentile|threshold/i.test(key));
        if (!extra) return; // Never infer a median/probability from an unlabelled singleton.
        const axisValue = String(axes[extra[0]].values[extra[1]]);
        let statistic: MetOfficeValue['statistic'];
        let threshold: number | undefined;
        let comparison: '>=' | '>' | undefined;
        if (probability) {
          const match = /^(>=|>)\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/i.exec(axisValue);
          if (!match) return;
          comparison = match[1] as '>=' | '>';
          threshold = Number(match[2]) * (isRain ? 1000 : 1); // documented thickness threshold axis in metres
          statistic = 'probability';
        } else {
          const percentile = Number(axisValue);
          if (percentile !== 50 && percentile !== 90) return;
          statistic = percentile === 50 ? 'median' : 'percentile90';
        }
        const converted = probability ? value / (unit === '%' ? 100 : 1) : variable === 'temperature_2m' ? value - (unit === 'K' ? 273.15 : 0) : isRain ? value * (unit === 'm' ? 1000 : 1) : variable === 'cloud_cover' && unit === '%' ? value / 100 : value;
        if (!finite(converted) || probability && (converted < 0 || converted > 1) || variable !== 'temperature_2m' && converted < 0 || variable === 'cloud_cover' && converted > 1) return;
        values.push({ parameter, variable, start, end, value: converted, statistic, threshold, comparison, unit: probability || variable === 'cloud_cover' ? 'fraction' : variable === 'temperature_2m' ? '°C' : isRain ? 'mm' : 'm/s' });
      });
    }
  }
  if (!site || !values.length) throw new RangeError('No compatible Met Office diagnostics');
  return { schema: 1, provider: 'Met Office Site-Specific Blended Probabilistic Forecast v2', modelId: 'metoffice_blended', family: 'UKMO', issuedAt, sourceTime: issuedAt, fetchedAt, validFrom: Math.min(...values.map(v => v.start)), validTo: Math.max(...values.map(v => v.end)), units: {}, coverage: 'Nearest site; median central estimates; source percentiles retained separately', requested, site, values, diagnostics };
}
export function validateMetOffice(raw: unknown): MetOfficeProduct {
  const p = raw as MetOfficeProduct;
  if (!p || p.schema !== 1 || p.modelId !== 'metoffice_blended' || !finite(p.fetchedAt) || p.issuedAt !== null && !finite(p.issuedAt) || !p.site || typeof p.site.id !== 'string' || !finite(p.site.latitude) || !finite(p.site.longitude) || !finite(p.site.distanceKm) || p.site.distanceKm < 0 || !p.requested || !finite(p.requested.latitude) || !finite(p.requested.longitude) || !Array.isArray(p.values) || p.values.length > 100000 || p.values.some(v => !v || !finite(v.value) || !finite(v.start) || !finite(v.end) || v.end < v.start || !['median', 'percentile90', 'probability'].includes(v.statistic) || v.statistic === 'probability' && (v.value < 0 || v.value > 1 || !finite(v.threshold)))) throw new RangeError('Invalid cached Met Office product');
  if (p.firstSeenAt !== undefined && !finite(p.firstSeenAt) || !finite(p.validFrom) || !finite(p.validTo) || p.issuedAt !== null && p.issuedAt > p.fetchedAt || !Array.isArray(p.diagnostics)) throw new RangeError('Invalid cached Met Office metadata');
  const units: Record<string, string> = { temperature_2m: '°C', wind_speed_10m: 'm/s', wind_gusts_10m: 'm/s', cloud_cover: 'fraction', precipitation: 'mm', precipitation_probability: 'fraction', gust_probability: 'fraction' };
  if (p.values.some(v => !Object.hasOwn(units, v.variable) || v.unit !== units[v.variable] || !(MET_OFFICE_PARAMETERS as readonly string[]).includes(v.parameter) || v.variable !== 'temperature_2m' && v.value < 0 || v.variable === 'cloud_cover' && v.value > 1 || v.statistic === 'probability' && !['>=', '>'].includes(v.comparison ?? ''))) throw new RangeError('Incompatible cached Met Office quantity/units');
  return p;
}
export function usableMetOffice(product: MetOfficeProduct | undefined, location: { latitude: number; longitude: number }, now: number) {
  if (!product) return false;
  try { validateMetOffice(product); } catch { return false; }
  const age = now - (product.issuedAt ?? product.firstSeenAt ?? product.fetchedAt);
  return age >= -5 * 60_000 && age <= 6 * HOUR && now - product.fetchedAt <= 6 * HOUR && distanceKm(product.requested, location) < 0.1 && product.site.distanceKm <= 5;
}
