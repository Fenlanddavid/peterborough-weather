import { useMemo } from 'react';
import { useVisibleResource } from '../hooks/useVisibleResource';
import { fetchCurrentKp, fetchKpForecast, fetchOvation, fetchSolarWind, fetchAuroraWatch, auroraGuidance, kpForDarkness, freshProduct, sustainedSouthward, AURORAWATCH_MEANING } from '../sky/aurora';
import type { Darkness } from '../astro/ephemeris';
import type { SkyIndex } from '../sky/weather';
import { HOUR, localTime } from '../data/contracts';
import type { Provenance, SourceResult } from '../data/contracts';
import { familyMean } from '../forecast/signals';

export function SourceDetail({ label, result }: { label: string; result: SourceResult<Provenance> | null }) {
  const data = result?.data;
  return <p className="sky-source"><strong>{label}</strong> · {result?.status ?? 'loading'}{result?.error && ` · refresh failure: ${result.error}`}{data && <> · source time {data.sourceTime === null ? 'not supplied' : new Date(data.sourceTime).toLocaleString('en-GB', { timeZone: 'Europe/London' })} · checked {localTime(result!.checkedAt)} · issue {data.issuedAt === null ? 'not supplied' : localTime(data.issuedAt)}{result?.stale && ' · cached after failed refresh'}</>}{result?.storageError && ' · cache unavailable'}</p>;
}
export function AuroraPanel({ darkness, weather, now }: { darkness: Darkness; weather: SkyIndex; now: number }) {
  const current = useVisibleResource('aurora:current', 30 * 60_000, fetchCurrentKp);
  const forecast = useVisibleResource('aurora:forecast', 30 * 60_000, fetchKpForecast);
  const ovation = useVisibleResource('aurora:ovation', 10 * 60_000, fetchOvation);
  const solar = useVisibleResource('aurora:solar-wind', 10 * 60_000, fetchSolarWind);
  const watch = useVisibleResource('aurora:watch', 10 * 60_000, fetchAuroraWatch);
  const latest = current?.data?.entries.at(-1);
  const blocks = useMemo(() => darkness.civil && forecast?.data ? kpForDarkness(forecast.data, darkness.civil, now) : [], [darkness, forecast, now]);
  const headline = blocks.length ? Math.max(...blocks.map(b => b.kp)) : null;
  const locallyDark = darkness.civil !== null && now >= darkness.civil.start && now < darkness.civil.end;
  const bzFavourable = solar?.data ? sustainedSouthward(solar.data, now, locallyDark) : false;
  const cloudAt = (time: number) => familyMean(weather.flatMap(w => { const value = w.value('cloud_cover', Math.floor(time / HOUR) * HOUR); return value === null || !w.data.family || now - w.data.fetchedAt > 3 * HOUR ? [] : [{ modelId: w.data.modelId, family: w.data.family, value }]; }));
  const cloudNow = cloudAt(now);
  const freshKp = current?.data && freshProduct(current.data, 15 * 60_000, now);
  return <section className="nightsky-aurora" aria-labelledby="nightsky-aurora-title">
    <h2 id="nightsky-aurora-title">Northern lights outlook</h2>
    <p><strong>Current geomagnetic activity:</strong> {latest ? `Kp ${latest.decimal ? String(latest.kp) : latest.kp.toFixed(0)} (estimated${latest.decimal ? '' : ', integer fallback'})` : 'unavailable'}{current?.data && !freshKp && ' · stale; no live viewing prompt'}</p>
    <p><strong>Next few hours:</strong> {forecast?.data ? forecast.data.entries.filter(e => e.time + 3 * HOUR > now && e.time < now + 6 * HOUR).map(e => `${localTime(e.time)}: Kp ${e.kp} ${e.kind}`).join(' · ') || 'unavailable' : 'unavailable'}. Daylight is excluded from the observing headline below.</p>
    <p><strong>{darkness.eveningDate === new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(now) ? 'Tonight' : darkness.eveningDate}, during darkness:</strong> {headline === null ? 'no eligible forecast blocks' : auroraGuidance(headline)}{forecast?.data && !freshProduct(forecast.data, 6 * HOUR, now) && ' · source recency uncertain/stale; guidance is not current'}. Clear skies and an unobstructed northern horizon are needed. These geographic tiers are configurable guidance, not visibility probabilities.</p>
    <ul>{blocks.map(b => { const cloud = cloudAt(b.start); return <li key={b.time}>{localTime(b.start)}–{localTime(b.end)} · Kp {b.kp} {b.kind} · cloud {cloud === null ? 'unknown' : `${Math.round(cloud * 100)}% family-weighted estimate`}</li>; })}</ul>
    {locallyDark && freshKp && latest && latest.kp >= 7 && cloudNow !== null && cloudNow < 0.3 && <p>Current activity and local darkness support checking the northern sky. Cloud forecasts remain uncertain.</p>}
    <p><strong>OVATION:</strong> {ovation?.data ? `Regional context at 55–60°N near 0° longitude: grid intensity ${Math.min(...ovation.data.context.map(p => p.intensity))}–${Math.max(...ovation.data.context.map(p => p.intensity))} on the source 0–100 scale. Forecast valid ${localTime(ovation.data.forecastTime)}. This is not Peterborough’s viewing probability.${freshProduct(ovation.data, 30 * 60_000, now) ? '' : ' Product is stale.'}` : 'unavailable'}</p>
    <p><strong>Solar wind:</strong> {solar?.data ? `Bz GSM ${solar.data.samples.at(-1)!.bzGsm} nT (${solar.data.samples.at(-1)!.source}); speed ${solar.data.speed ?? 'unknown'} km/s${solar.data.speedTime ? ` at ${localTime(solar.data.speedTime)} (${solar.data.speedSource})` : ''}.` : 'unavailable'} {bzFavourable && 'Favourable solar-wind condition: sustained southward Bz for 30 minutes. This does not prove aurora is visible locally.'}</p>
    <p><strong>AuroraWatch UK:</strong> {watch?.data ? `${watch.data.level} upstream geomagnetic alert. ${AURORAWATCH_MEANING[watch.data.level]} The colour is not a local visibility probability.${freshProduct(watch.data, 30 * 60_000, now) ? '' : ' Alert data is stale.'}` : 'unavailable; optional collector may be disabled'}</p>
    <details><summary>Source times and refresh status</summary><SourceDetail label="Estimated Kp" result={current} /><SourceDetail label="Forecast Kp" result={forecast} /><SourceDetail label="OVATION" result={ovation} /><SourceDetail label="Solar wind" result={solar} /><SourceDetail label="AuroraWatch" result={watch} /></details>
    <p className="nightsky-aurora-note">Geomagnetic data: <a href="https://www.swpc.noaa.gov/">NOAA SWPC</a>. UK alerts: <a href="https://aurorawatch.lancs.ac.uk/">AuroraWatch UK, Lancaster University</a>, <a href="https://www.sites.lancaster.ac.uk/samnet/">SAMNET</a> and <a href="https://aurorawatch.lancs.ac.uk/project-info/aurorawatchnet/">AuroraWatchNet</a>.</p>
  </section>;
}
