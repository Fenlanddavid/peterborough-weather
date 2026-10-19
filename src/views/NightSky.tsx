import { useId, useMemo, useRef, useState } from 'react';
import type { CachedRun } from '../types';
import { DETERMINISTIC_MODELS } from '../config/models';
import { getModelRuns, getValueAtTime } from '../metrics/utils';
import { getLocalDate, toLocalTime, useLocalNow } from '../hooks/useLocalTime';
import { WeatherIcon, type IconName } from '../components/WeatherIcon';

interface Props {
  runs: CachedRun[];
  loading: boolean;
  hasError: boolean;
}

interface NightForecast {
  date: string;          // ISO date of the evening (the night of 19th = evening of 19th into morning of 20th)
  label: string;         // "Tonight" or "Monday night"
  shortLabel: string;    // "Tonight" or "Mon"
  sunset: string | null; // local time string
  sunrise: string | null;
  cloudScore: number | null; // Estimate from weather codes, 0 = clear
  forecastHours: number;
  rainRisk: boolean;
  windMph: number | null;
  gustMph: number | null;
  seeingRating: 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Unsuitable' | 'Unavailable';
  seeingScore: number | null;
  moonIllumination: number; // 0-100
  moonPhase: string;
  hourly: NightHour[];
}

interface NightHour {
  time: string;
  localTime: string;
  cloudLabel: string;
  cloudIcon: IconName;
  temp: number | null;
  wind: number | null;
  rain: number | null;
}

/** Average a value across all non-overlay models' latest runs */
function consensus(
  allRuns: CachedRun[],
  variable: 'temperature_2m' | 'precipitation' | 'wind_speed_10m' | 'wind_gusts_10m',
  validTime: string
): number | null {
  const models = DETERMINISTIC_MODELS.filter((m) => !m.isOverlay);
  const values: number[] = [];
  for (const model of models) {
    const runs = getModelRuns(allRuns, model.id, variable);
    if (runs.length === 0) continue;
    const latest = runs[runs.length - 1];
    const v = getValueAtTime(latest, validTime);
    if (v !== null) values.push(v);
  }
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Get the dominant weather code across models for a given time */
function consensusWeatherCode(allRuns: CachedRun[], validTime: string): number | null {
  const models = DETERMINISTIC_MODELS.filter((m) => !m.isOverlay);
  const votes = new Map<number, number>();
  for (const model of models) {
    const runs = getModelRuns(allRuns, model.id, 'weather_code');
    const latest = runs.at(-1);
    if (!latest) continue;
    const code = getValueAtTime(latest, validTime);
    if (code !== null) votes.set(code, (votes.get(code) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [code, count] of votes) {
    if (count > bestCount) { best = code; bestCount = count; }
  }
  return best;
}

/** Find sunset/sunrise from is_day transitions */
function findSunTransitions(allRuns: CachedRun[], dateStr: string): { sunset: string | null; sunrise: string | null } {
  const models = DETERMINISTIC_MODELS.filter((m) => !m.isOverlay);
  let sunset: string | null = null;
  let sunrise: string | null = null;

  // Look for the evening transition on dateStr and the morning transition on dateStr+1
  for (const model of models) {
    const runs = getModelRuns(allRuns, model.id, 'is_day');
    const latest = runs.at(-1);
    if (!latest) continue;

    // Find sunset: last hour of daylight on dateStr
    for (let h = 12; h < 24; h++) {
      const t = `${dateStr}T${String(h).padStart(2, '0')}:00`;
      const next = `${dateStr}T${String(h + 1).padStart(2, '0')}:00`;
      const val = getValueAtTime(latest, t);
      const nextVal = h < 23 ? getValueAtTime(latest, next) : null;
      if (val === 1 && (nextVal === 0 || nextVal === null)) {
        sunset = t;
        break;
      }
    }

    // Find sunrise: first hour of daylight on the next day
    const nextDate = new Date(Date.parse(`${dateStr}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10);
    for (let h = 4; h < 12; h++) {
      const t = `${nextDate}T${String(h).padStart(2, '0')}:00`;
      const val = getValueAtTime(latest, t);
      if (val === 1) {
        sunrise = t;
        break;
      }
    }

    if (sunset || sunrise) break;
  }

  return { sunset, sunrise };
}

/** Calculate moon phase for a given date. Returns illumination 0–100 and phase name. */
function getMoonPhase(dateStr: string): { illumination: number; phase: string } {
  const date = new Date(`${dateStr}T00:00:00Z`);
  // Known new moon: 2000-01-06 18:14 UTC
  const knownNew = Date.UTC(2000, 0, 6, 18, 14);
  const synodicMonth = 29.53058770576;
  const daysSinceNew = (date.getTime() - knownNew) / 86400_000;
  const phase = ((daysSinceNew % synodicMonth) + synodicMonth) % synodicMonth;
  const normalised = phase / synodicMonth; // 0-1

  // Illumination: 0 at new/full boundaries mapped via cosine
  const illumination = Math.round((1 - Math.cos(normalised * 2 * Math.PI)) / 2 * 100);

  let name: string;
  if (normalised < 0.03 || normalised > 0.97) name = 'New Moon';
  else if (normalised < 0.22) name = 'Waxing Crescent';
  else if (normalised < 0.28) name = 'First Quarter';
  else if (normalised < 0.47) name = 'Waxing Gibbous';
  else if (normalised < 0.53) name = 'Full Moon';
  else if (normalised < 0.72) name = 'Waning Gibbous';
  else if (normalised < 0.78) name = 'Last Quarter';
  else name = 'Waning Crescent';

  return { illumination, phase: name };
}

/** Cloud description from WMO weather code */
function cloudFromCode(code: number | null): { label: string; icon: IconName } {
  if (code === null) return { label: 'Unknown', icon: 'cloud' };
  if (code === 0) return { label: 'Clear', icon: 'moon' };
  if (code === 1) return { label: 'Mostly clear', icon: 'cloud-moon' };
  if (code === 2) return { label: 'Partly cloudy', icon: 'cloud-moon' };
  if (code === 3) return { label: 'Overcast', icon: 'cloud' };
  if (code === 45 || code === 48) return { label: 'Fog', icon: 'fog' };
  if (code >= 51 && code <= 67) return { label: 'Rain', icon: 'rain' };
  if (code >= 71 && code <= 77) return { label: 'Snow', icon: 'snow' };
  if (code >= 80 && code <= 82) return { label: 'Showers', icon: 'rain' };
  if (code >= 85 && code <= 86) return { label: 'Snow showers', icon: 'snow' };
  if (code >= 95) return { label: 'Thunderstorm', icon: 'storm' };
  return { label: 'Cloudy', icon: 'cloud' };
}

/** Cloud score: 0 = perfectly clear, 100 = fully overcast. Derived from weather codes. */
function cloudScoreFromCode(code: number): number {
  if (code === 0) return 0;
  if (code === 1) return 15;
  if (code === 2) return 50;
  if (code === 3) return 90;
  if (code === 45 || code === 48) return 100; // fog
  if (code >= 51) return 95; // precipitation implies heavy cloud
  return 50;
}

function rateSeeingConditions(cloudScore: number, windMph: number | null, rainRisk: boolean): { rating: NightForecast['seeingRating']; score: number } {
  // Start from 100 and deduct
  let score = 100;

  // Cloud cover is the biggest factor
  score -= cloudScore * 0.7;

  // Wind causes atmospheric turbulence
  const wind = windMph ?? 0;
  if (wind > 25) score -= 25;
  else if (wind > 15) score -= 15;
  else if (wind > 8) score -= 5;

  // Rain is a dealbreaker
  if (rainRisk) score -= 20;

  score = Math.max(0, Math.min(100, Math.round(score)));

  let rating: NightForecast['seeingRating'];
  if (score >= 75) rating = 'Excellent';
  else if (score >= 55) rating = 'Good';
  else if (score >= 35) rating = 'Fair';
  else if (score >= 15) rating = 'Poor';
  else rating = 'Unsuitable';

  return { rating, score };
}

export function NightSky({ runs, loading, hasError }: Props) {
  const now = useLocalNow();
  const today = getLocalDate(now);
  const [selectedDate, setSelectedDate] = useState(today);
  const detail = useRef<HTMLElement>(null);

  const nights = useMemo(() => {
    const result: NightForecast[] = [];
    const todayUTC = Date.parse(`${today}T00:00:00Z`);

    for (let d = 0; d < 7; d++) {
      const date = new Date(todayUTC + d * 86400_000);
      const dateStr = date.toISOString().slice(0, 10);
      const nextDateStr = new Date(todayUTC + (d + 1) * 86400_000).toISOString().slice(0, 10);

      const { sunset, sunrise } = findSunTransitions(runs, dateStr);

      // Night hours: from sunset (or 17:00) to sunrise (or 07:00 next day)
      const nightStart = sunset ? parseInt(sunset.slice(11, 13)) + 1 : 17;
      const nightEnd = sunrise ? parseInt(sunrise.slice(11, 13)) : 7;

      const cloudScores: number[] = [];
      const winds: number[] = [];
      const gusts: number[] = [];
      let hasRain = false;
      const hourly: NightHour[] = [];

      // Evening hours (nightStart to 23)
      for (let h = nightStart; h < 24; h++) {
        const t = `${dateStr}T${String(h).padStart(2, '0')}:00`;
        const code = consensusWeatherCode(runs, t);
        const cloud = cloudFromCode(code);
        if (code !== null) cloudScores.push(cloudScoreFromCode(code));

        const wind = consensus(runs, 'wind_speed_10m', t);
        if (wind !== null) winds.push(wind);

        const gust = consensus(runs, 'wind_gusts_10m', t);
        if (gust !== null) gusts.push(gust);

        const rain = consensus(runs, 'precipitation', t);
        if (rain !== null && rain >= 0.1) hasRain = true;

        hourly.push({
          time: t,
          localTime: toLocalTime(t, 'time'),
          cloudLabel: cloud.label,
          cloudIcon: cloud.icon,
          temp: consensus(runs, 'temperature_2m', t),
          wind,
          rain,
        });
      }

      // Early morning hours (00 to nightEnd)
      for (let h = 0; h < nightEnd; h++) {
        const t = `${nextDateStr}T${String(h).padStart(2, '0')}:00`;
        const code = consensusWeatherCode(runs, t);
        const cloud = cloudFromCode(code);
        if (code !== null) cloudScores.push(cloudScoreFromCode(code));

        const wind = consensus(runs, 'wind_speed_10m', t);
        if (wind !== null) winds.push(wind);

        const gust = consensus(runs, 'wind_gusts_10m', t);
        if (gust !== null) gusts.push(gust);

        const rain = consensus(runs, 'precipitation', t);
        if (rain !== null && rain >= 0.1) hasRain = true;

        hourly.push({
          time: t,
          localTime: toLocalTime(t, 'time'),
          cloudLabel: cloud.label,
          cloudIcon: cloud.icon,
          temp: consensus(runs, 'temperature_2m', t),
          wind,
          rain,
        });
      }

      const avgCloud = cloudScores.length > 0 ? cloudScores.reduce((a, b) => a + b, 0) / cloudScores.length : null;
      const avgWind = winds.length > 0 ? winds.reduce((a, b) => a + b, 0) / winds.length : null;
      const maxGust = gusts.length > 0 ? Math.max(...gusts) : null;

      const { rating, score } = avgCloud !== null && avgWind !== null
        ? rateSeeingConditions(avgCloud, avgWind, hasRain)
        : { rating: 'Unavailable' as const, score: null };
      const moon = getMoonPhase(dateStr);

      const localDate = new Date(`${dateStr}T12:00:00Z`);
      const dayName = localDate.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Europe/London' });
      const shortDay = localDate.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Europe/London' });
      const isTonight = d === 0;

      result.push({
        date: dateStr,
        label: isTonight ? 'Tonight' : `${dayName} night`,
        shortLabel: isTonight ? 'Tonight' : shortDay,
        sunset: sunset ? toLocalTime(sunset, 'time') : null,
        sunrise: sunrise ? toLocalTime(sunrise, 'time') : null,
        cloudScore: avgCloud === null ? null : Math.round(avgCloud),
        forecastHours: cloudScores.length,
        rainRisk: hasRain,
        windMph: avgWind,
        gustMph: maxGust,
        seeingRating: rating,
        seeingScore: score,
        moonIllumination: moon.illumination,
        moonPhase: moon.phase,
        hourly,
      });
    }

    return result;
  }, [runs, today]);

  const hasData = nights.some((night) => night.forecastHours > 0 || night.hourly.some((hour) => hour.temp !== null));
  // Avoid recommending a night whose missing hours could hide poor conditions.
  const candidates = nights.filter((night) => night.seeingScore !== null && night.forecastHours >= night.hourly.length * .75);
  const bestNight = candidates.reduce<NightForecast | null>((best, night) => !best || night.seeingScore! > best.seeingScore! ? night : best, null);
  const selected = nights.find((night) => night.date === selectedDate) ?? nights[0];
  const dateLabel = (date: string, month: 'short' | 'long' = 'long') => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month, timeZone: 'Europe/London' });
  const number = (value: number | null) => value === null ? '—' : Math.round(value);
  const showBestNight = () => {
    if (!bestNight) return;
    setSelectedDate(bestNight.date);
    detail.current?.focus({ preventScroll: true });
    detail.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  };

  return <div className="view-nightsky">
    <header className="nightsky-intro">
      <div>
        <p className="nightsky-eyebrow">Peterborough · After hours</p>
        <h1>The night sky ahead.</h1>
        <p>A little planning. A clearer view of the universe.</p>
      </div>
      <span className="nightsky-location"><WeatherIcon name="star" />Your seven-night stargazing outlook</span>
    </header>

    {!hasData && <div className="nightsky-status" role="status">
      <WeatherIcon name="telescope" />
      <p>{loading ? 'Gathering your night sky forecast…' : hasError ? 'The forecast could not be loaded. Use Refresh above to try again.' : 'No forecast data is available. Use Refresh above to check again.'}<span>Moon phases are still available below.</span></p>
    </div>}
    {hasData && hasError && <p className="nightsky-status" role="status">The latest refresh failed. Showing the forecast already saved on this device.</p>}

    <div className="nightsky-overview">
      <section className="nightsky-best" aria-labelledby="nightsky-best-title">
        <Constellation />
        <div className="nightsky-best-content">
          <p className="nightsky-eyebrow"><WeatherIcon name="star" />{bestNight ? 'Your best window this week' : 'A sky worth waiting for'}</p>
          <h2 id="nightsky-best-title">{bestNight ? bestNight.label : 'Look up, after dark.'}</h2>
          {bestNight && <p className="nightsky-best-date">{dateLabel(bestNight.date)} · <span className={`nightsky-rating nightsky-rating--${bestNight.seeingRating.toLowerCase()}`}>{bestNight.seeingRating} outlook</span></p>}
          <p className="nightsky-best-tip">{bestNight
            ? bestNight.seeingScore! >= 55
              ? bestNight.moonIllumination <= 30
                ? 'Lighter cloud and a dimmer moon. A promising night to look for fainter stars.'
                : 'A promising weather window. Try brighter stars and planets, with a bright moon in the sky.'
              : 'A mixed week for stargazing. Check the hourly forecast for a break in the clouds.'
            : 'Your best night will appear when enough weather data is available. In the meantime, follow the moon through the week.'}</p>
          {bestNight && <button type="button" className="nightsky-best-link" onClick={showBestNight}>Explore this night <WeatherIcon name="arrow" /></button>}
        </div>
        {bestNight && <div className="nightsky-best-stats">
          <span><WeatherIcon name="cloud" />About {number(bestNight.cloudScore)}% cloud</span>
          <span><WeatherIcon name="wind" />{number(bestNight.windMph)} mph wind</span>
          <span><WeatherIcon name="moon" />{bestNight.moonIllumination}% moonlit</span>
        </div>}
      </section>

      <aside className="nightsky-moon" aria-labelledby="nightsky-moon-title">
        <p className="nightsky-eyebrow">The moon · {selected.shortLabel}</p>
        <div className="nightsky-moon-main">
          <MoonDisc illumination={selected.moonIllumination} phase={selected.moonPhase} />
          <div><h2 id="nightsky-moon-title">{selected.moonPhase}</h2><p><strong>{selected.moonIllumination}%</strong> illuminated</p></div>
        </div>
        <p className="nightsky-moon-tip">{selected.moonIllumination <= 30 ? 'Less moonlight makes fainter stars easier to spot.' : 'Moonlight can soften the view of fainter stars.'}</p>
        <div className="nightsky-moon-track" aria-label="Moon illumination over the next seven nights">
          {nights.map((night) => <div key={night.date} className={`nightsky-moon-day ${night.date === selected.date ? 'is-selected' : ''}`}>
            <MoonDisc illumination={night.moonIllumination} phase={night.moonPhase} />
            <span className="moon-illum">{night.moonIllumination}%</span>
            <span className="moon-date">{night.shortLabel === 'Tonight' ? 'Ton.' : night.shortLabel}</span>
          </div>)}
        </div>
      </aside>
    </div>

    <section className="nightsky-week" aria-labelledby="nightsky-nights-title">
      <div className="nightsky-section-heading"><div><p className="nightsky-eyebrow">Find your moment</p><h2 id="nightsky-nights-title">The next seven nights</h2></div><span>Select a night to explore <WeatherIcon name="arrow" /></span></div>
      <div className="nightsky-night-list" role="group" aria-label="Choose a night">
        {nights.map((night) => <button key={night.date} type="button" className={`nightsky-night-picker ${night.date === selected.date ? 'is-selected' : ''}`} aria-pressed={night.date === selected.date} aria-controls="nightsky-detail" onClick={() => setSelectedDate(night.date)}>
          <span className="nightsky-night-name">{night.shortLabel}</span>
          <span className="nightsky-night-date">{dateLabel(night.date, 'short')}</span>
          <span className="nightsky-night-symbol"><WeatherIcon name={night.cloudScore === null ? 'calendar' : night.rainRisk ? 'rain' : night.cloudScore < 15 ? 'moon' : night.cloudScore < 65 ? 'cloud-moon' : 'cloud'} />{night.date === bestNight?.date && <span className="nightsky-best-marker" title="Best night"><WeatherIcon name="star" /><span className="sr-only">Best night</span></span>}</span>
          <span className={`nightsky-rating nightsky-rating--${night.seeingRating.toLowerCase()}`}>{night.seeingRating === 'Unavailable' ? 'Awaiting data' : night.seeingRating}</span>
          <span className="nightsky-night-cloud">{night.cloudScore === null ? 'Cloud unknown' : `~${night.cloudScore}% cloud`}</span>
          <span className="nightsky-night-wind"><WeatherIcon name="wind" />{number(night.windMph)} mph</span>
        </button>)}
      </div>
    </section>

    <section className="nightsky-detail" id="nightsky-detail" aria-labelledby="nightsky-detail-title" ref={detail} tabIndex={-1}>
      <header className="nightsky-detail-heading">
        <div><p className="nightsky-eyebrow">A closer look · {dateLabel(selected.date)}</p><h2 id="nightsky-detail-title">{selected.label}, hour by hour</h2></div>
        <span className={`nightsky-seeing-badge nightsky-rating--${selected.seeingRating.toLowerCase()}`}>{selected.seeingRating === 'Unavailable' ? 'Awaiting conditions' : `${selected.seeingRating} outlook`}</span>
      </header>
      <div className="nightsky-detail-stats">
        <div><WeatherIcon name="cloud" /><span>Cloud estimate<strong>{selected.cloudScore === null ? '—' : `~${selected.cloudScore}%`}</strong></span></div>
        <div><WeatherIcon name="moon" /><span>Moon illumination<strong>{selected.moonIllumination}%</strong></span></div>
        <div><WeatherIcon name="wind" /><span>Average wind<strong>{number(selected.windMph)} <small>mph</small></strong></span></div>
        <div><WeatherIcon name="wind" /><span>Peak gust<strong>{number(selected.gustMph)} <small>mph</small></strong></span></div>
      </div>
      <div className="nightsky-observing-note">
        <span><WeatherIcon name="calendar" />{selected.sunset && selected.sunrise ? `Sunset ~${selected.sunset} · Sunrise ~${selected.sunrise}` : 'Evening to morning · Sun times unavailable'}</span>
        {selected.rainRisk && <span className="nightsky-rain-warning"><WeatherIcon name="drop" />Rain in the forecast</span>}
      </div>
      {selected.forecastHours < selected.hourly.length && <p className="nightsky-coverage">{selected.forecastHours === 0 ? 'Cloud conditions are unavailable for this night.' : `Cloud conditions available for ${selected.forecastHours} of ${selected.hourly.length} hours. The outlook may change as more data arrives.`}</p>}
      <div key={selected.date} className="nightsky-hourly" tabIndex={0} role="region" aria-label={`${selected.label} hourly forecast. Scroll for more hours.`}>
        {selected.hourly.map((hour) => <div className="nightsky-hour" key={hour.time}>
          <span className="nightsky-hour-time">{hour.localTime}</span>
          <WeatherIcon name={hour.cloudIcon} className="nightsky-hour-icon" />
          <span className="nightsky-hour-label">{hour.cloudLabel}</span>
          <strong className="nightsky-hour-temp">{number(hour.temp)}°<span className="sr-only">C</span></strong>
          <span className="nightsky-hour-rain"><WeatherIcon name="drop" />{hour.rain === null ? '—' : hour.rain.toFixed(1)} mm</span>
          <span className="nightsky-hour-wind"><WeatherIcon name="wind" />{number(hour.wind)} mph</span>
        </div>)}
      </div>
      <p className="nightsky-hourly-caption">Peterborough local time · Temperatures in °C · Rainfall per hour · Scroll for more hours</p>
    </section>

    <details className="nightsky-method">
      <summary><span className="nightsky-info-mark" aria-hidden="true">i</span>About this stargazing forecast<span className="nightsky-disclosure" aria-hidden="true">+</span></summary>
      <div><p>The viewing outlook combines weather-code cloud estimates, surface wind and precipitation across available ECMWF, GFS and UKMO forecasts. It describes general weather suitability, rather than telescope seeing or atmospheric transparency. The best night compares nights with cloud data for at least three quarters of the overnight hours.</p><p>Cloud percentages are estimates from weather codes, rather than direct measurements. Moon illumination is an approximate lunar-cycle calculation; moonrise, moonset and local light pollution are not included in the rating. Sunset and sunrise are approximate hourly daylight transitions. The hourly strip covers the overnight period, including twilight, rather than hours of full astronomical darkness.</p></div>
    </details>
  </div>;
}

function MoonDisc({ illumination, phase }: { illumination: number; phase: string }) {
  const id = useId();
  const waning = phase.startsWith('Waning') || phase === 'Last Quarter';
  const radius = Math.abs(1 - illumination / 50) * 44;
  const outerSweep = waning ? 0 : 1;
  const innerSweep = illumination <= 50 ? 1 - outerSweep : outerSweep;
  const lit = `M50 6 A44 44 0 0 ${outerSweep} 50 94 A${radius} 44 0 0 ${innerSweep} 50 6Z`;
  return <svg className="moon-disc" viewBox="0 0 100 100" aria-hidden="true">
    <defs><radialGradient id={id} cx=".35" cy=".3" r=".8"><stop stopColor="#fff4d8" /><stop offset="1" stopColor="#b6b9c4" /></radialGradient></defs>
    <circle cx="50" cy="50" r="44" fill="#2b3549" />
    {illumination > 0 && <path d={lit} fill={`url(#${id})`} />}
    <g fill="#182033" opacity=".12"><circle cx="66" cy="29" r="9" /><circle cx="73" cy="57" r="5" /><circle cx="44" cy="71" r="11" /><circle cx="27" cy="44" r="7" /></g>
    <circle cx="50" cy="50" r="44" fill="none" stroke="#e4e5ef" strokeOpacity=".13" />
  </svg>;
}

function Constellation() {
  return <svg className="nightsky-constellation" viewBox="0 0 300 240" fill="none" aria-hidden="true">
    <circle cx="154" cy="112" r="70" stroke="currentColor" opacity=".1" />
    <circle cx="154" cy="112" r="100" stroke="currentColor" opacity=".08" strokeDasharray="2 7" />
    <path d="m83 148 36-59 57-33 53 34-23 58-60 25-27-84m27 84 30-117m30 92-87-59" stroke="currentColor" opacity=".35" />
    {[[83, 148], [119, 89], [176, 56], [229, 90], [206, 148], [146, 173]].map(([x, y], i) => <g key={i}><circle cx={x} cy={y} r="8" fill="currentColor" opacity=".07" /><circle cx={x} cy={y} r={i === 1 ? 3 : 2} fill="currentColor" opacity=".9" /></g>)}
    <path d="M62 67v10m-5-5h10m180 103v10m-5-5h10M213 32v8m-4-4h8" stroke="currentColor" opacity=".5" />
    <g fill="currentColor" opacity=".4"><circle cx="52" cy="130" r="1" /><circle cx="113" cy="202" r="1.5" /><circle cx="259" cy="114" r="1.5" /><circle cx="141" cy="25" r="1" /><circle cx="188" cy="199" r="1" /></g>
  </svg>;
}
