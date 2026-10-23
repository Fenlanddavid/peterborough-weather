import { useEffect, useMemo, useRef, useState } from 'react';
import { Body } from 'astronomy-engine';
import type { CachedRun } from '../types';
import { useLocalNow } from '../hooks/useLocalTime';
import { addDays, HOUR, localTime, eventPercent } from '../data/contracts';
import type { EventEstimate } from '../data/contracts';
import type { ForecastContext } from '../forecast/signals';
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
import { useAuroraData } from '../hooks/useAuroraData';
import { kpColour, kpLabel } from '../api/aurora';
import { SkyEventsPanel } from '../components/SkyEventsPanel';
import { skyHourlyPresentation } from '../sky/hourlyPresentation';
import './NightSky.css';
const loadIfs = (signal: AbortSignal) => fetchSkyModel('ecmwf_ifs025', signal);
const loadGfs = (signal: AbortSignal) => fetchSkyModel('gfs_global', signal);
const loadUkmo = (signal: AbortSignal) => fetchSkyModel('ukmo_global_deterministic_10km', signal);
const duration = (ms: number) => `${Math.floor(ms / HOUR)} h ${Math.round(ms % HOUR / 60_000)} min`;
const nightLabel = (date: string, evening: string) => {
  if (date === evening) return 'Tonight';
  return new Date(`${date}T12:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Europe/London' });
};
const ukDate = (date: string) => new Date(`${date}T12:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
function savedMode(): ObservingMode { try { return localStorage.getItem('pb-weather:observing-mode') === 'moon-planets' ? 'moon-planets' : 'deep-sky'; } catch { return 'deep-sky'; } }
export function NightSky({ runs, ensembles, context }: { runs: CachedRun[]; loading: boolean; hasError: boolean; context?: ForecastContext; ensembles: EnsembleIndex }) {
  const now = useLocalNow(); const time = now.getTime();
  const [mode, setMode] = useState<ObservingMode>(savedMode);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const [scrollEdges, setScrollEdges] = useState({ start: true, end: false });
  const { aurora, loading: auroraLoading, refresh: refreshAurora } = useAuroraData();
  const ifs = useVisibleResource('sky:ecmwf_ifs025', HOUR, loadIfs);
  const gfs = useVisibleResource('sky:gfs_global', HOUR, loadGfs);
  const ukmo = useVisibleResource('sky:ukmo_global_deterministic_10km', HOUR, loadUkmo);
  const air = useVisibleResource('air-quality', 6 * HOUR, fetchAirQuality);
  const weather = useMemo(() => buildSkyIndex([ifs, gfs, ukmo].flatMap(r => r?.data ? [r.data] : [])), [ifs, gfs, ukmo]);
  const aerosol = useMemo(() => buildSkyIndex(air?.data ? [air.data] : [])[0], [air]);
  const signals = useMemo(() => buildForecastSignals(runs, time, context), [runs, time, context]);
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
  const chosenHour = selected.hourly.find(p => p.start === selectedHour);
  const updateScrollEdges = () => {
    const strip = timeline.current;
    if (strip) setScrollEdges({ start: strip.scrollLeft < 4, end: strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 4 });
  };
  useEffect(() => {
    timeline.current?.scrollTo({ left: 0 });
    updateScrollEdges();
    const observer = new ResizeObserver(updateScrollEdges);
    if (timeline.current) observer.observe(timeline.current);
    return () => observer.disconnect();
  }, [selected.date]);
  const scrollHours = (direction: number) => timeline.current?.scrollBy({ left: direction * 260, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  const bestByWindow = [...nights].filter(n => n.windows?.best).sort((a, b) => b.windows!.best!.duration * b.windows!.best!.mean - a.windows!.best!.duration * a.windows!.best!.mean)[0];
  const bestByRating = [...nights].filter(n => n.rating && n.rating !== 'Limited data').sort((a, b) => { const order = ['Excellent', 'Good', 'Fair', 'Poor', 'Unsuitable']; return order.indexOf(a.rating) - order.indexOf(b.rating); })[0];
  const best = bestByWindow ?? bestByRating;
  const changeMode = (value: ObservingMode) => { setMode(value); try { localStorage.setItem('pb-weather:observing-mode', value); } catch (error) { console.warn('Observing preference storage:', error); } };
  const window = selected.windows?.best;
  return <div className="view-nightsky">
    <header className="nightsky-intro"><div><p className="nightsky-eyebrow">Peterborough · After hours</p><h1>The night sky ahead.</h1><p>Your stargazing outlook, from sunset to sunrise.</p></div></header>
    <div className="sky-mode" role="group" aria-label="Observing mode"><button aria-pressed={mode === 'deep-sky'} onClick={() => changeMode('deep-sky')}>Deep sky</button><button aria-pressed={mode === 'moon-planets'} onClick={() => changeMode('moon-planets')}>Moon and planets</button></div>
    <section className="nightsky-best"><div className="nightsky-best-content"><p className="nightsky-eyebrow">Stargazing outlook · {mode === 'deep-sky' ? 'Deep sky' : 'Moon and planets'}</p><h2>{best ? `Best night: ${nightLabel(best.date, evening)}` : 'Loading sky outlook…'}</h2><p>{best?.windows?.best ? `${duration(best.windows.best.duration)} usable window · ${best.rating}` : best ? best.rating : ''}</p></div></section>
    <nav className="nightsky-night-list" aria-label="Choose observing night">{nights.map(n => <button className={`nightsky-night-picker ${selected.date === n.date ? 'is-selected' : ''}`} aria-pressed={selected.date === n.date} key={n.date} onClick={() => setSelectedDate(n.date)}><span className="nightsky-night-name">{n.date === evening ? 'Tonight' : new Date(`${n.date}T12:00Z`).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'short' })}</span><span>{ukDate(n.date)}</span><WeatherIcon name="moon" /><strong>{n.rating}</strong></button>)}</nav>
    <section className="nightsky-detail"><h2>{nightLabel(selected.date, evening)} · {ukDate(selected.date)} · {selected.rating}</h2>
      {!selected.darkness.astronomical && <p>No true darkness tonight. The sky stays in twilight.{selected.darkness.nautical ? ' Deep-sky planning uses nautical darkness; Excellent is disabled.' : ' Nautical darkness is also absent, so a dark-sky window cannot be rated.'}</p>}
      <p>Sunset {selected.darkness.sunset ? localTime(selected.darkness.sunset) : 'none'} · sunrise {selected.darkness.sunrise ? localTime(selected.darkness.sunrise) : 'none'}</p>
      <p>Civil darkness {selected.darkness.civil ? `${localTime(selected.darkness.civil.start)}–${localTime(selected.darkness.civil.end)}` : 'not reached'} · nautical {selected.darkness.nautical ? `${localTime(selected.darkness.nautical.start)}–${localTime(selected.darkness.nautical.end)}` : 'not reached'} · astronomical {selected.darkness.astronomical ? `${localTime(selected.darkness.astronomical.start)}–${localTime(selected.darkness.astronomical.end)}` : 'not reached'}</p>
      <div className="nightsky-moon-main"><MoonDisc illumination={selected.moon.illumination} waxing={selected.moon.waxing} /><p>{selected.moon.label} · {Math.round(selected.moon.illumination * 100)}% illuminated at 22:00 Europe/London.<br />Moonrise {selected.moon.rise === null ? 'none in this observing night' : localTime(selected.moon.rise)} · moonset {selected.moon.set === null ? 'none in this observing night' : localTime(selected.moon.set)}</p></div>
      <p className="sky-window">{window ? `Best window ${localTime(window.start)}–${localTime(window.end)} · ${duration(window.duration)} · mean score ${Math.round(window.mean)} · ${moonBelowThroughout(window) ? 'Moon down throughout' : 'Moon above horizon for part or all of window'}` : 'No consecutive eligible green window. Valid individual hours still appear below.'}</p>
      <div className="sky-hourly-heading"><div><p className="nightsky-eyebrow">A glance through the night</p><h3>Hour by hour</h3></div><div className="sky-scroll-actions"><button type="button" onClick={() => scrollHours(-1)} disabled={scrollEdges.start} aria-label="Earlier observing hours"><WeatherIcon name="arrow" /></button><button type="button" onClick={() => scrollHours(1)} disabled={scrollEdges.end} aria-label="Later observing hours"><WeatherIcon name="arrow" /></button></div></div>
      <div className="sky-timeline-shell"><div className="sky-timeline" ref={timeline} onScroll={updateScrollEdges} tabIndex={0} role="region" aria-label="Hourly observing conditions, scroll horizontally">{selected.hourly.map(p => {
        const cloud = familyMean(p.models.flatMap(m => m.inputs.cloud === null ? [] : [{ modelId: m.modelId, family: m.family, value: m.inputs.cloud }]));
        const presentation = skyHourlyPresentation(cloud, p.score, p.eligibleMinutes);
        const bestHour = !!window && p.start < window.end && p.end > window.start;
        const moonUp = moonAboveHorizon(p.sky.time);
        return <button type="button" key={p.start} className={`sky-period sky-period--${presentation.tone} ${selectedHour === p.start ? 'is-selected' : ''}`} aria-expanded={chosenHour?.start === p.start} aria-controls="sky-hour-details" aria-label={`${localTime(p.start)}: ${presentation.label}, ${presentation.suitability.label}, ${presentation.cloudLabel}, Moon ${moonUp ? 'up' : 'down'}${bestHour ? ', best viewing window' : ''}. Show details.`} onClick={() => setSelectedHour(selectedHour === p.start ? null : p.start)}>
          <span className="sky-period-top"><time dateTime={new Date(p.start).toISOString()}>{localTime(p.start)}</time>{bestHour && <span className="sky-period-best" title="Best viewing window"><WeatherIcon name="star" /></span>}</span>
          <span className="sky-period-symbol"><WeatherIcon name={presentation.icon} /></span>
          <strong className="sky-period-condition">{presentation.label}</strong>
          <span className="sky-period-cloud">{presentation.cloudLabel}</span>
          <span className={`sky-period-status sky-period-status--${presentation.suitability.tone}`}><i />{presentation.suitability.label}</span>
          <span className="sky-period-moon"><WeatherIcon name="moon" />Moon {moonUp ? 'up' : 'down'}</span>
        </button>;
      })}</div></div>
      <div id="sky-hour-details" className={`sky-hour-details ${chosenHour ? 'is-open' : ''}`} aria-live="polite">{chosenHour ? <><strong>{localTime(chosenHour.start)}–{localTime(chosenHour.end)}</strong><span>{chosenHour.score === null ? 'Observing score unavailable' : `Observing score ${Math.round(chosenHour.score)}/100`} · {chosenHour.eligibleMinutes} dark minutes · Moon {Math.round(chosenHour.sky.illumination * 100)}% illuminated</span><span>{chosenHour.models.filter(m => m.inputs.cloud !== null && m.inputs.cloud < 0.3).length}/{chosenHour.models.filter(m => m.inputs.cloud !== null).length} models indicate less than 30% cloud. {chosenHour.precipitation.basis === 'ensemble-probability' ? 'Rain probability' : 'Wet model agreement'}: {chosenHour.precipitation.value === null ? 'unavailable' : eventPercent(chosenHour.precipitation.value)} over 3 hours.</span></> : <span>Select an hour for moonlight, model agreement and viewing detail.</span>}</div>
      <p className="nightsky-hourly-caption">Stars mean mostly clear skies; clouds show cloud cover. The viewing label also accounts for moonlight, rain, wind and darkness. <span className="sky-best-key"><WeatherIcon name="star" /> Best viewing window</span></p>
    </section>
    <SkyEventsPanel date={selected.date} darkness={selected.darkness} best={window ?? null} moonIllumination={selected.moon.illumination} now={time} />
    <section className="nightsky-aurora" aria-labelledby="nightsky-aurora-title">
      <div className="nightsky-section-heading"><div><p className="nightsky-eyebrow">Aurora watch · Next three days</p><h2 id="nightsky-aurora-title">Northern lights outlook</h2></div><button type="button" className="nightsky-aurora-refresh" onClick={refreshAurora} disabled={auroraLoading} aria-label="Refresh aurora outlook"><WeatherIcon name="refresh" />{auroraLoading ? 'Updating' : 'Refresh'}</button></div>
      {!aurora ? <p className="nightsky-aurora-status" role="status">{auroraLoading ? 'Checking geomagnetic activity…' : 'Aurora data is unavailable.'}</p> : (() => {
        const latestKp = aurora.current?.entries.at(-1);
        const forecastEntries = aurora.forecast?.entries ?? [];
        const peakKp = forecastEntries.length ? Math.max(...forecastEntries.map(e => e.kp)) : null;
        const visibility = peakKp === null ? 'Forecast unavailable' : peakKp >= 7 ? 'Possible' : peakKp >= 5 ? 'Unlikely' : 'Very unlikely';
        const visibilityNote = peakKp === null ? 'The three-day forecast could not be loaded.' : peakKp >= 7 ? 'Geomagnetic activity may reach levels visible from Peterborough. Clear, dark skies needed.' : peakKp >= 5 ? 'Minor storm activity forecast, but likely below Peterborough\'s threshold.' : 'Geomagnetic activity is expected to stay well below aurora-visible levels.';
        return <>
          <div className="nightsky-aurora-summary">
            <div className="nightsky-aurora-kp">
              <span className="nightsky-kp-value" style={{ color: kpColour(latestKp?.kp ?? 0) }}>{latestKp ? latestKp.kp.toFixed(1) : '—'}</span>
              <span className="nightsky-kp-label">Current Kp</span>
              <span className="nightsky-kp-level">{latestKp ? kpLabel(latestKp.kp) : 'No data'}</span>
            </div>
            <div className="nightsky-aurora-assessment">
              <span className={`nightsky-aurora-visibility nightsky-aurora-visibility--${visibility.toLowerCase().replace(/\s+/g, '-')}`}><WeatherIcon name="aurora" />{visibility}</span>
              <p>{visibilityNote}</p>
            </div>
          </div>
          {forecastEntries.length > 0 && <div className="nightsky-kp-forecast">
            <p className="nightsky-kp-forecast-label">Kp forecast · 0–9 scale · Peterborough local time</p>
            <div className="nightsky-kp-scroll" tabIndex={0} role="region" aria-label="Three-day geomagnetic forecast"><div className="nightsky-kp-bars">
              {forecastEntries.slice(0, 24).map((entry) => {
                const barHeight = Math.max(3, (entry.kp / 9) * 78);
                const entryTime = new Date(entry.time);
                const timeLabel = entryTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
                return <div key={entry.time} className="nightsky-kp-bar-col" tabIndex={0} aria-label={`${entryTime.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' })}, ${timeLabel}: Kp ${entry.kp}, ${kpLabel(entry.kp)}`}>
                  <div className="nightsky-kp-bar" style={{ height: `${barHeight}px`, backgroundColor: kpColour(entry.kp) }} title={`Kp ${entry.kp}`}>
                    <span className="nightsky-kp-bar-value">{entry.kp.toFixed(1)}</span>
                  </div>
                  <span className="nightsky-kp-bar-time" aria-hidden="true">{timeLabel}<small>{entryTime.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Europe/London' })}</small></span>
                </div>;
              })}
            </div></div>
            <div className="nightsky-kp-scale">
              <span><i style={{ backgroundColor: kpColour(1) }} />Quiet · Kp below 4</span><span><i style={{ backgroundColor: kpColour(4) }} />Active · Kp 4</span><span><i style={{ backgroundColor: kpColour(7) }} />Storm · Kp 5+</span>
            </div>
          </div>}
          <p className="nightsky-aurora-note">Peterborough (52.6°N) typically needs Kp ≥ 7 for aurora visibility. Clear, dark skies are also needed. Data from <a href="https://www.swpc.noaa.gov/" target="_blank" rel="noopener noreferrer">NOAA SWPC</a>. Updated {new Date(aurora.fetchedAt).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.</p>
        </>;
      })()}
    </section>
  </div>;
}
function MoonDisc({ illumination, waxing }: { illumination: number; waxing: boolean }) {
  const radius = Math.max(0.001, Math.abs(1 - 2 * illumination) * 44);
  const sweep = waxing ? 1 : 0;
  const lit = `M50 6 A44 44 0 0 ${sweep} 50 94 A${radius} 44 0 0 ${illumination <= 0.5 ? 1 - sweep : sweep} 50 6Z`;
  return <svg className="moon-disc" viewBox="0 0 100 100" aria-label={`${Math.round(illumination * 100)}% ${waxing ? 'waxing' : 'waning'} Moon`} role="img"><circle cx="50" cy="50" r="44" fill="#2b3549" /><path d={lit} fill="#ede5ca" /></svg>;
}
