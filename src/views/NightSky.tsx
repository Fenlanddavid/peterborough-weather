import { useMemo, useState } from 'react';
import { Body } from 'astronomy-engine';
import type { CachedRun } from '../types';
import { useLocalNow } from '../hooks/useLocalTime';
import { addDays, eventPercent, HOUR, localTime } from '../data/contracts';
import type { EventEstimate } from '../data/contracts';
import { buildForecastSignals, familyMean, familyWeights } from '../forecast/signals';
import type { EnsembleIndex } from '../forecast/events';
import { PRECIP_3H, CLEAR_CLOUD, eventTimes } from '../forecast/events';
import { buildSkyIndex, fetchSkyModel, fetchAirQuality } from '../sky/weather';
import { scoreModel, combineScores, observingWindows, rateNight } from '../sky/scoring';
import type { ObservingMode, WeatherInput } from '../sky/scoring';
import { darknessTimes, moonEvents, observingNight, moonBelowThroughout, moonAboveHorizon, position } from '../astro/ephemeris';
import { Illumination } from 'astronomy-engine';
import { useVisibleResource } from '../hooks/useVisibleResource';
import { WeatherIcon } from '../components/WeatherIcon';
import { DETERMINISTIC_MODELS } from '../config/models';
import { AuroraPanel, SourceDetail } from '../components/AuroraPanel';
import { SkyEventsPanel } from '../components/SkyEventsPanel';
import './NightSky.css';
const loadIfs = (signal: AbortSignal) => fetchSkyModel('ecmwf_ifs025', signal);
const loadGfs = (signal: AbortSignal) => fetchSkyModel('gfs_global', signal);
const loadUkmo = (signal: AbortSignal) => fetchSkyModel('ukmo_global_deterministic_10km', signal);
const cloudLabel = (fraction: number | null) => fraction === null ? 'unknown' : `${Math.round(fraction * 100)}%`;
const duration = (ms: number) => `${Math.floor(ms / HOUR)} h ${Math.round(ms % HOUR / 60_000)} min`;
function savedMode(): ObservingMode { try { return localStorage.getItem('pb-weather:observing-mode') === 'moon-planets' ? 'moon-planets' : 'deep-sky'; } catch { return 'deep-sky'; } }
export function NightSky({ runs, ensembles }: { runs: CachedRun[]; loading: boolean; hasError: boolean; ensembles: EnsembleIndex }) {
  const now = useLocalNow(); const time = now.getTime();
  const [mode, setMode] = useState<ObservingMode>(savedMode);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const ifs = useVisibleResource('sky:ecmwf_ifs025', HOUR, loadIfs);
  const gfs = useVisibleResource('sky:gfs_global', HOUR, loadGfs);
  const ukmo = useVisibleResource('sky:ukmo_global_deterministic_10km', HOUR, loadUkmo);
  const air = useVisibleResource('air-quality', 6 * HOUR, fetchAirQuality);
  const weather = useMemo(() => buildSkyIndex([ifs, gfs, ukmo].flatMap(r => r?.data ? [r.data] : [])), [ifs, gfs, ukmo]);
  const aerosol = useMemo(() => buildSkyIndex(air?.data ? [air.data] : [])[0], [air]);
  const signals = useMemo(() => buildForecastSignals(runs, time), [runs, time]);
  const evening = observingNight(time);
  const ephemerides = useMemo(() => Array.from({ length: 7 }, (_, i) => { const date = addDays(evening, i); return { date, darkness: darknessTimes(date), moon: moonEvents(date) }; }), [evening]);
  const nights = useMemo(() => ephemerides.map(night => {
    const darkness = mode === 'deep-sky' ? night.darkness.astronomical ?? night.darkness.nautical : night.darkness.nautical;
    const twilightOnly = mode === 'deep-sky' && !night.darkness.astronomical;
    const start = night.darkness.sunset ?? night.darkness.start; const end = night.darkness.sunrise ?? night.darkness.end;
    const periods = [];
    const edges = new Set<number>([start, end]);
    for (let t = Math.ceil(start / 600_000) * 600_000; t < end; t += 600_000) edges.add(t);
    for (const band of [night.darkness.civil, night.darkness.nautical, night.darkness.astronomical]) if (band) for (const t of [band.start, band.end]) if (t > start && t < end) edges.add(t);
    const boundaries = [...edges].sort((a, b) => a - b);
    for (let i = 0; i < boundaries.length - 1; i++) {
      const t = boundaries[i]; const stop = boundaries[i + 1];
      const middle = (t + stop) / 2; const hour = Math.floor(middle / HOUR) * HOUR;
      const sky = { time: middle, sunAltitude: position(Body.Sun, middle).altitude, moonAltitude: position(Body.Moon, middle).altitude, illumination: Illumination(Body.Moon, new Date(middle)).phase_fraction };
      const models = weather.flatMap(w => {
        if (!w.data.family) return [];
        const get = (variable: string) => w.value(variable, hour);
        const input: WeatherInput = { provenance: [night.darkness.provenance, w.data, ...(aerosol ? [aerosol.data] : [])], modelId: w.data.modelId, family: w.data.family, cloud: get('cloud_cover'), low: get('cloud_cover_low'), mid: get('cloud_cover_mid'), high: get('cloud_cover_high'), temperature: get('temperature_2m'), dewPoint: get('dew_point_2m'), humidity: get('relative_humidity_2m'), visibility: get('visibility'), aerosol: aerosol && time - aerosol.data.fetchedAt < 12 * HOUR ? aerosol.value('aerosol_optical_depth', hour) : null, wind: get('wind_speed_10m'), gust: get('wind_gusts_10m'), jet: get('wind_speed_250hPa') };
        const score = scoreModel(input, sky, mode);
        return [{ ...score, value: time - w.data.fetchedAt > 3 * HOUR ? null : score.value }];
      });
      // Forecast-only additional models (including UKV) use their real indexed core
      // values. Layers/dew/visibility stay unknown rather than borrowed from a different
      // model or run. Unsupported gusts naturally make a model's score unavailable.
      for (const model of DETERMINISTIC_MODELS) {
        if (weather.some(w => w.data.modelId === model.id)) continue;
        const sample = (variable: 'cloud_cover' | 'wind_gusts_10m' | 'wind_speed_10m' | 'temperature_2m') => signals.samples(variable, hour, true).find(v => v.modelId === model.id);
        const cloud = sample('cloud_cover'); const gust = sample('wind_gusts_10m');
        if (!cloud && !gust) continue;
        const wind = sample('wind_speed_10m'); const temperature = sample('temperature_2m');
        models.push(scoreModel({ modelId: model.id, family: model.family, cloud: cloud?.value ?? null, low: null, mid: null, high: null, gust: gust?.value ?? null, wind: wind?.value ?? null, temperature: temperature?.value ?? null, dewPoint: null, humidity: null, visibility: null, aerosol: aerosol && time - aerosol.data.fetchedAt < 12 * HOUR ? aerosol.value('aerosol_optical_depth', hour) : null, jet: null, provenance: [night.darkness.provenance, ...[cloud, gust, wind, temperature].filter(v => v !== undefined), ...(aerosol ? [aerosol.data] : [])] }, sky, mode));
      }
      let precipitation = signals.event(PRECIP_3H, hour, hour + 3 * HOUR, ensembles);
      if (precipitation.value === null) {
        const eligible = weather.flatMap(w => {
          const values = eventTimes(PRECIP_3H, hour, hour + 3 * HOUR).map(t => w.value('precipitation', t));
          return !w.data.family || time - w.data.fetchedAt > 3 * HOUR || values.some(v => v === null) ? [] : [{ modelId: w.data.modelId, family: w.data.family, value: (values as number[]).reduce((s, v) => s + v, 0) }];
        });
        const weighted = familyWeights(eligible);
        precipitation = { ...precipitation, value: eligible.length ? weighted.reduce((s, v) => s + (v.source.value >= 0.2 ? v.weight : 0), 0) : null, usable: eligible.length, expected: 3, systems: eligible.map(e => e.modelId), status: eligible.length ? 'partial' : 'unavailable' };
      }
      const score = combineScores(models, precipitation, !!darkness && middle >= darkness.start && middle < darkness.end);
      periods.push({ dust: aerosol && time - aerosol.data.fetchedAt < 12 * HOUR ? aerosol.value('dust', hour) : null, clearCloud: ensembles.event(CLEAR_CLOUD, hour, hour + HOUR), start: t, end: stop, score, precipitation: precipitation as EventEstimate, models, sky, families: new Set(models.filter(m => m.value !== null).map(m => m.family)).size, transparencyKnown: models.some(m => m.transparencyInputs.length > 0), cloud: familyMean(models.flatMap(m => m.cloud === null ? [] : [{ ...m, value: m.cloud }])) });
    }
    const windows = darkness ? observingWindows(periods, darkness, night.date === evening ? time : -Infinity) : null;
    const grouped = new Map<number, typeof periods>();
    for (const p of periods) { const hour = Math.floor(p.start / HOUR); if (!grouped.has(hour)) grouped.set(hour, []); grouped.get(hour)!.push(p); }
    const hourly = [...grouped.values()].map(group => {
      const eligible = darkness ? group.filter(p => p.start >= darkness.start && p.end <= darkness.end) : [];
      const duration = eligible.reduce((s, p) => s + p.end - p.start, 0);
      const score = !eligible.length || eligible.some(p => p.score === null) ? null : eligible.reduce((s, p) => s + p.score! * (p.end - p.start), 0) / duration;
      return { ...group[0], end: group.at(-1)!.end, score, eligibleMinutes: Math.round(duration / 60_000) };
    });
    return { ...night, hourly, darkInterval: darkness, twilightOnly, periods, windows, rating: windows ? rateNight(windows, twilightOnly) : 'Limited data' };
  }), [ephemerides, mode, weather, aerosol, signals, ensembles, time, evening]);
  const selected = nights.find(n => n.date === selectedDate) ?? nights[0];
  const best = [...nights].filter(n => n.windows?.best).sort((a, b) => b.windows!.best!.duration * b.windows!.best!.mean - a.windows!.best!.duration * a.windows!.best!.mean)[0];
  const changeMode = (value: ObservingMode) => { setMode(value); try { localStorage.setItem('pb-weather:observing-mode', value); } catch (error) { console.warn('Observing preference storage:', error); } };
  const window = selected.windows?.best;
  return <div className="view-nightsky">
    <header className="nightsky-intro"><div><p className="nightsky-eyebrow">Peterborough · After hours</p><h1>The night sky ahead.</h1><p>Your stargazing outlook, from sunset to sunrise.</p></div></header>
    <div className="sky-mode" role="group" aria-label="Observing mode"><button aria-pressed={mode === 'deep-sky'} onClick={() => changeMode('deep-sky')}>Deep sky</button><button aria-pressed={mode === 'moon-planets'} onClick={() => changeMode('moon-planets')}>Moon and planets</button></div>
    <section className="nightsky-best"><div className="nightsky-best-content"><p className="nightsky-eyebrow">Stargazing outlook · {mode === 'deep-sky' ? 'Deep sky' : 'Moon and planets'}</p><h2>{best ? `Best night: ${best.date}` : 'Best night not yet determined'}</h2><p>{best?.windows?.best ? `${duration(best.windows.best.duration)} usable window · ${best.rating}` : 'Waiting for sky weather data.'}</p></div></section>
    <nav className="nightsky-night-list" aria-label="Choose observing night">{nights.map(n => <button className={`nightsky-night-picker ${selected.date === n.date ? 'is-selected' : ''}`} aria-pressed={selected.date === n.date} key={n.date} onClick={() => setSelectedDate(n.date)}><span className="nightsky-night-name">{n.date === evening ? 'Tonight' : new Date(`${n.date}T12:00Z`).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'short' })}</span><span>{n.date}</span><WeatherIcon name="moon" /><strong>{n.rating}</strong><small>{Math.round((n.windows?.coverage ?? 0) * 100)}% core coverage</small></button>)}</nav>
    <section className="nightsky-detail"><h2>{selected.date} · {selected.rating}</h2>
      {!selected.darkness.astronomical && <p>No true darkness tonight. The sky stays in twilight.{selected.darkness.nautical ? ' Deep-sky planning uses nautical darkness; Excellent is disabled.' : ' Nautical darkness is also absent, so a dark-sky window cannot be rated.'}</p>}
      <p>Sunset {selected.darkness.sunset ? localTime(selected.darkness.sunset) : 'none'} · sunrise {selected.darkness.sunrise ? localTime(selected.darkness.sunrise) : 'none'}</p>
      <p>Civil darkness {selected.darkness.civil ? `${localTime(selected.darkness.civil.start)}–${localTime(selected.darkness.civil.end)}` : 'not reached'} · nautical {selected.darkness.nautical ? `${localTime(selected.darkness.nautical.start)}–${localTime(selected.darkness.nautical.end)}` : 'not reached'} · astronomical {selected.darkness.astronomical ? `${localTime(selected.darkness.astronomical.start)}–${localTime(selected.darkness.astronomical.end)}` : 'not reached'}</p>
      <div className="nightsky-moon-main"><MoonDisc illumination={selected.moon.illumination} waxing={selected.moon.waxing} /><p>{selected.moon.label} · {Math.round(selected.moon.illumination * 100)}% illuminated at 22:00 Europe/London.<br />Moonrise {selected.moon.rise === null ? 'none in this observing night' : localTime(selected.moon.rise)} · moonset {selected.moon.set === null ? 'none in this observing night' : localTime(selected.moon.set)}</p></div>
      <p className="sky-window">{window ? `Best window ${localTime(window.start)}–${localTime(window.end)} · ${duration(window.duration)} · mean score ${Math.round(window.mean)} · ${moonBelowThroughout(window) ? 'Moon down throughout' : 'Moon above horizon for part or all of window'}` : 'No consecutive eligible green window. Valid individual hours still appear below.'}</p>
      <div className="sky-timeline" tabIndex={0} role="region" aria-label="Hourly observing conditions, scroll horizontally">{selected.hourly.map(p => <div key={p.start} className={`sky-period ${p.score === null ? 'sky-unknown' : p.score >= 55 ? 'sky-green' : p.score >= 35 ? 'sky-amber' : 'sky-red'}`}>
        <time>{localTime(p.start)}</time><small>{p.sky.sunAltitude < -18 ? 'Astronomical' : p.sky.sunAltitude < -12 ? 'Nautical' : p.sky.sunAltitude < -6 ? 'Civil' : 'Twilight'}</small><strong>{p.score === null ? 'Unknown' : Math.round(p.score)}</strong><small>{p.eligibleMinutes} min in darkness</small><span>Cloud {p.cloud === null ? '?' : `${Math.round(p.cloud * 100)}%`}</span><small>Clear-cloud ensemble estimate {p.clearCloud.value === null ? 'unknown' : `${eventPercent(p.clearCloud.value)}`} · {p.clearCloud.usable}/{p.clearCloud.expected} members · {p.clearCloud.systems.length} systems · &lt;30% total cloud</small><span>Clear {p.models.filter(m => m.cloud !== null && m.cloud < 0.3).length}/{p.models.filter(m => m.cloud !== null).length} models</span><small>{p.precipitation.value === null ? 'Wet risk unknown' : `${eventPercent(p.precipitation.value)} ${p.precipitation.basis === 'ensemble-probability' ? 'ensemble estimate' : 'wet agreement'}`}<br />{p.precipitation.systems.length} sources · {p.precipitation.usable}/{p.precipitation.expected} eligible<br />≥0.2 mm · {localTime(p.precipitation.start)}–{localTime(p.precipitation.end)}</small><span>{moonAboveHorizon(p.sky.time) ? 'Moon up' : 'Moon down'} · {Math.round(p.sky.illumination * 100)}%</span>
        <details><summary>Atmosphere and models</summary><p>CAMS dust context: {p.dust === null ? 'unknown' : `${p.dust} μg/m³`} (not scored).</p>{p.models.map(m => <p key={m.modelId}>{m.modelId}: {m.value === null ? 'score unknown/stale' : `score ${Math.round(m.value)}`} · total cloud {cloudLabel(m.inputs.cloud)}; low/mid/high {cloudLabel(m.inputs.low)} / {cloudLabel(m.inputs.mid)} / {cloudLabel(m.inputs.high)} · RH {cloudLabel(m.inputs.humidity)} · visibility {m.inputs.visibility === null ? 'unknown' : `${(m.inputs.visibility / 1000).toFixed(1)} km`} · AOD {m.inputs.aerosol ?? 'unknown'} · temperature/dew-point spread {m.inputs.temperature === null || m.inputs.dewPoint === null ? 'unknown' : `${(m.inputs.temperature - m.inputs.dewPoint).toFixed(1)}°C`} · transparency inputs: {m.transparencyInputs.join(', ') || 'none (unknown)'}{m.transparencyInputs.length < 3 && ' · incomplete'}{m.dew === null && ' · Dew/frost assessment unknown'}{m.dew && ' · Dew risk: a heater or shield may help.'}{m.frost && ' · Equipment frost risk; deposition not guaranteed.'}{m.radiationFog && ' · Radiation-fog risk; visibility forecasts may disagree.'}{m.fog && ' · forecast visibility below 1 km'}{mode === 'moon-planets' && ` · 250 hPa jet: ${m.jet ?? 'unknown'} (one indicator, not a complete seeing forecast)`}</p>)}</details>
      </div>)}</div><p className="nightsky-hourly-caption">Hourly scores average ten-minute planning samples during darkness. Weather inputs are hourly and may be resampled from coarser model output. Repeated local hours retain distinct UTC instants. Green ≥55 · amber 35–54 · red &lt;35 · neutral unknown/twilight.</p>
    </section>
    <SkyEventsPanel date={selected.date} darkness={selected.darkness} best={window ?? null} moonIllumination={selected.moon.illumination} now={time} />
    <AuroraPanel darkness={selected.darkness} weather={weather} now={time} />
    <details className="nightsky-method"><summary>Sources, freshness and how the outlook works</summary><SourceDetail label="IFS sky weather" result={ifs} /><SourceDetail label="GFS sky weather" result={gfs} /><SourceDetail label="UKMO sky weather" result={ukmo} /><SourceDetail label="CAMS aerosol/dust" result={air} />{[ifs, gfs, ukmo, air].map((s, i) => s?.data && <p key={i}>{s.data.modelId}: {s.data.warnings.join(' · ') || 'no parser warnings'} · issue time not supplied. Coverage {new Date(s.data.validFrom).toISOString()}–{new Date(s.data.validTo).toISOString()}; nulls remain unknown.</p>)}
      <p>Scores are configurable observing-planning heuristics, not measured transparency or astronomical seeing. Per model: random-overlap effective cloud = 1−(1−low)(1−mid)(1−k×high), k 0.7 deep sky / 0.4 Moon and planets; total cloud is the fallback. Deep sky applies Moon illumination × sin(positive altitude), with a 0.6 brightness penalty. Available humidity, visibility and aerosol factors multiply, with a floor of 0.6; missing optional inputs are listed as unknown. Dust is context only.</p><p>Gusts below 25 mph have no penalty; 25–35 mph multiply by 0.8; above 35 mph score zero. Visibility below 1 km scores zero within that model. Scores combine equally by family after these nonlinear calculations. A ≥40% ensemble estimate for at least 0.2 mm over the shown three-hour period scores zero; deterministic wet agreement is the labelled fallback. Unknown cloud, gusts or precipitation make the score unknown. Source failures retain cached values; sky responses last successfully fetched more than three hours ago are excluded from recommendations. Unknown issue times remain unknown.</p><p>Windows need consecutive eligible scores ≥55, clipped to darkness and remaining observing time. Full-night ratings need 75% coverage. Excellent: ≥4h and mean ≥75 with known transparency and true darkness in deep-sky mode; Good: ≥2h and mean ≥60; Fair: ≥1h; Poor: some eligible score ≥35; otherwise Unsuitable. An incomplete final night cannot win the weekly comparison.</p><p>Observer: 52.5736°N, −0.2400°E, 10 m above sea level, zero height above ground; unobstructed horizon. Sun/Moon rise/set uses upper limbs and standard atmospheric refraction; twilight uses geometric Sun centre at −6/−12/−18°. Planet maxima are refined to sub-minute precision. Library uncertainty and the real horizon limit practical accuracy. Weather: <a href="https://open-meteo.com/">Open-Meteo</a>; aerosols: <a href="https://atmosphere.copernicus.eu/">Copernicus CAMS</a>.</p>
    </details>
  </div>;
}
function MoonDisc({ illumination, waxing }: { illumination: number; waxing: boolean }) {
  const radius = Math.max(0.001, Math.abs(1 - 2 * illumination) * 44);
  const sweep = waxing ? 1 : 0;
  const lit = `M50 6 A44 44 0 0 ${sweep} 50 94 A${radius} 44 0 0 ${illumination <= 0.5 ? 1 - sweep : sweep} 50 6Z`;
  return <svg className="moon-disc" viewBox="0 0 100 100" aria-label={`${Math.round(illumination * 100)}% ${waxing ? 'waxing' : 'waning'} Moon`} role="img"><circle cx="50" cy="50" r="44" fill="#2b3549" /><path d={lit} fill="#ede5ca" /></svg>;
}
