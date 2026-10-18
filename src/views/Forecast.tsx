import { useEffect, useMemo, useRef, useState } from 'react';
import type { CachedRun } from '../types';
import { DETERMINISTIC_MODELS } from '../config/models';
import { getModelRuns, getValueAtTime } from '../metrics/utils';
import { getHourlyCondition } from '../metrics/hourlyWeather';
import { getHourlyForecastTimes, getLocalDate, toLocalTime, useLocalNow } from '../hooks/useLocalTime';
import { SkyIllustration, WeatherIcon } from '../components/WeatherIcon';

interface Props {
  runs: CachedRun[];
  loading: boolean;
  hasError: boolean;
}

interface DayForecast {
  date: string;        // ISO date like "2026-10-19"
  dayName: string;     // "Monday"
  shortDay: string;    // "Mon"
  high: number | null;
  low: number | null;
  rainMm: number | null;
  snowCm: number | null;
  windMph: number | null;
  gustMph: number | null;
  condition: string;
}

/** Average a value across all non-overlay models' latest runs */
function consensus(
  allRuns: CachedRun[],
  variable: 'temperature_2m' | 'precipitation' | 'snowfall' | 'wind_speed_10m' | 'wind_gusts_10m',
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

function deriveCondition(rainMm: number, windMph: number): { condition: string } {
  const isWindy = windMph >= 25;
  const isBreezy = windMph >= 15;

  if (rainMm >= 8) {
    return isWindy
      ? { condition: 'Heavy rain & wind' }
      : { condition: 'Heavy rain' };
  }
  if (rainMm >= 2) {
    return isWindy
      ? { condition: 'Rain & wind' }
      : { condition: 'Rain' };
  }
  if (rainMm >= 0.5) {
    return isBreezy
      ? { condition: 'Showers & breezy' }
      : { condition: 'Showers' };
  }
  if (isWindy) return { condition: 'Windy' };
  if (isBreezy) return { condition: 'Breezy' };
  return { condition: 'Fair' };
}

function buildWeekSummary(days: DayForecast[]): string {
  const withData = days.filter((d) => d.high !== null);
  if (withData.length === 0) return 'Waiting for forecast data...';

  const lines: string[] = [];

  // Temperature overview
  const highs = withData.map((d) => d.high!);
  const avgHigh = highs.reduce((a, b) => a + b, 0) / highs.length;
  const maxHigh = Math.max(...highs);
  const minHigh = Math.min(...highs);

  const feel =
    avgHigh >= 25 ? 'a hot' :
    avgHigh >= 18 ? 'a warm' :
    avgHigh >= 12 ? 'a mild' :
    avgHigh >= 6 ? 'a cool' : 'a cold';

  if (maxHigh - minHigh >= 4) {
    lines.push(
      `Expect ${feel} week with highs between ${Math.round(minHigh)}°C and ${Math.round(maxHigh)}°C.`
    );
  } else {
    lines.push(
      `Expect ${feel} week with highs around ${Math.round(avgHigh)}°C.`
    );
  }

  // Rain overview
  const wetDays = withData.filter((d) => d.rainMm !== null && d.rainMm >= 0.5);
  if (wetDays.length === 0) {
    lines.push('Looking dry all week.');
  } else if (wetDays.length <= 2) {
    const names = wetDays.map((d) => d.dayName).join(' and ');
    lines.push(`Some rain on ${names}.`);
  } else {
    lines.push(`Rain on ${wetDays.length} of the next ${withData.length} days.`);
  }

  // Wettest day callout
  const wettest = [...withData].sort((a, b) => (b.rainMm ?? 0) - (a.rainMm ?? 0))[0];
  if (wettest && wettest.rainMm !== null && wettest.rainMm >= 4) {
    lines.push(`${wettest.dayName} looks the wettest with around ${wettest.rainMm.toFixed(0)} mm.`);
  }

  // Wind callout
  const windyDays = withData.filter((d) => d.windMph !== null && d.windMph >= 20);
  if (windyDays.length > 0) {
    const names = windyDays.map((d) => d.dayName);
    if (windyDays.length === 1) {
      lines.push(`${names[0]} could be windy.`);
    } else {
      lines.push(`Breezy spells, especially ${names.slice(0, 2).join(' and ')}.`);
    }
  }

  return lines.join(' ');
}

export function Forecast({ runs, loading, hasError }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const now = useLocalNow();
  const today = getLocalDate(now);
  const hourlyScroll = useRef<HTMLDivElement>(null);
  const days = useMemo(() => {
    const result: DayForecast[] = [];
    const todayUTC = Date.parse(`${today}T00:00:00Z`);

    for (let d = 0; d < 7; d++) {
      const date = new Date(todayUTC + d * 24 * 3600_000);
      const dateStr = date.toISOString().slice(0, 10);

      // Collect hourly consensus values
      const hourlyTemps: number[] = [];
      const nightTemps: number[] = [];
      let rainTotal = 0;
      let rainHours = 0;
      let snowTotal = 0;
      let snowHours = 0;
      const hourlyWind: number[] = [];
      const hourlyGusts: number[] = [];

      for (let h = 0; h < 24; h++) {
        const validTime = `${dateStr}T${String(h).padStart(2, '0')}:00`;

        const temp = consensus(runs, 'temperature_2m', validTime);
        if (temp !== null) {
          if (h >= 6 && h <= 21) {
            hourlyTemps.push(temp);
          } else {
            nightTemps.push(temp);
          }
        }

        const precip = consensus(runs, 'precipitation', validTime);
        if (precip !== null) {
          rainTotal += precip;
          rainHours++;
        }

        const snow = consensus(runs, 'snowfall', validTime);
        if (snow !== null && Number.isFinite(snow) && snow >= 0) {
          snowTotal += snow;
          snowHours++;
        }

        const wind = consensus(runs, 'wind_speed_10m', validTime);
        if (wind !== null) hourlyWind.push(wind);

        const gust = consensus(runs, 'wind_gusts_10m', validTime);
        if (gust !== null) hourlyGusts.push(gust);
      }

      const high = hourlyTemps.length > 0
        ? Math.max(...hourlyTemps)
        : (nightTemps.length > 0 ? Math.max(...nightTemps) : null);
      const low = nightTemps.length > 0
        ? Math.min(...nightTemps)
        : (hourlyTemps.length > 0 ? Math.min(...hourlyTemps) : null);
      const rainMm = rainHours > 0 ? rainTotal : null;
      const windMph = hourlyWind.length > 0
        ? hourlyWind.reduce((a, b) => a + b, 0) / hourlyWind.length
        : null;
      const gustMph = hourlyGusts.length > 0
        ? Math.max(...hourlyGusts)
        : null;

      const { condition } = rainMm === null
        ? { condition: 'Limited forecast' }
        : deriveCondition(rainMm, windMph ?? 0);

      // Day names in local time
      const localDate = new Date(dateStr + 'T12:00:00Z');
      const dayName = localDate.toLocaleDateString('en-GB', {
        weekday: 'long',
        timeZone: 'Europe/London',
      });
      const shortDay = localDate.toLocaleDateString('en-GB', {
        weekday: 'short',
        timeZone: 'Europe/London',
      });
      const isToday = d === 0;

      const dayForecast: DayForecast = {
        date: dateStr,
        dayName: isToday ? 'Today' : dayName,
        shortDay: isToday ? 'Today' : shortDay,
        high,
        low,
        rainMm,
        snowCm: snowHours > 0 ? snowTotal : null,
        windMph,
        gustMph,
        condition,
      };

      result.push(dayForecast);
    }

    return result;
  }, [runs, today]);

  const weekSummary = useMemo(() => buildWeekSummary(days), [days]);
  const windyDays = days.filter((day) => day.gustMph !== null && day.gustMph >= 30);
  const snowyDays = days.filter((day) => day.snowCm !== null && day.snowCm > 0);

  const selectedDay = days[selectedIndex];
  const hasData = days.some((day) => day.high !== null);
  const modelCount = DETERMINISTIC_MODELS.filter((model) =>
    !model.isOverlay && runs.some((run) => run.modelId === model.id && run.variable === 'temperature_2m')
  ).length;
  const hourly = useMemo(() => getHourlyForecastTimes(selectedDay.date, now).map((time) => {
    return {
      time,
      temperature: consensus(runs, 'temperature_2m', time),
      rain: consensus(runs, 'precipitation', time),
      wind: consensus(runs, 'wind_speed_10m', time),
      condition: getHourlyCondition(runs, time),
    };
  }), [runs, selectedDay.date, now]);
  const firstHour = hourly[0]?.time;
  useEffect(() => {
    if (hourlyScroll.current) hourlyScroll.current.scrollLeft = 0;
  }, [selectedDay.date, firstHour]);
  const dateLabel = (date: string, long = false) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: long ? 'long' : 'short', timeZone: 'Europe/London',
  });
  const iconFor = (day: DayForecast) => day.high === null || day.rainMm === null ? 'calendar' : (day.rainMm ?? 0) >= 2 ? 'rain' : (day.rainMm ?? 0) >= 0.5 ? 'showers' : (day.windMph ?? 0) >= 25 ? 'wind' : 'sun';
  const number = (value: number | null) => value === null ? '—' : Math.round(value);

  return (
    <div className="view-forecast">
      <div className="forecast-intro">
        <div>
          <p className="eyebrow">A little local perspective</p>
          <h1>Your weather, at a glance.</h1>
          <p>A clearer outlook for Peterborough and the days ahead.</p>
        </div>
        <span className="forecast-today"><WeatherIcon name="calendar" />{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' })}</span>
      </div>

      {!hasData && <div className="forecast-status" role="status">
        <span className={`status-dot ${loading ? 'status-dot--loading' : ''}`} />
        {loading ? 'Gathering your local forecast. This may take a moment on your first visit.' : hasError ? 'Your forecast could not be loaded. Try Refresh above to reconnect.' : 'No forecast data is available yet. Try Refresh above in a little while.'}
      </div>}

      {windyDays.length > 0 && <div className="forecast-warning wind-warning" role="status">
        <WeatherIcon name="wind" />
        <div>
          <h2>Wind warning</h2>
          <p>Gusts of 30 mph or more forecast.</p>
          <ul>
            {windyDays.map((day) => <li key={day.date}>
              {day.dayName} · <strong>{number(day.gustMph)} mph</strong>
            </li>)}
          </ul>
        </div>
      </div>}

      {snowyDays.length > 0 && <div className="forecast-warning snow-warning" role="status">
        <WeatherIcon name="snow" />
        <div>
          <h2>Snow warning</h2>
          <p>Snowfall forecast in the next 7 days.</p>
          <ul>
            {snowyDays.map((day) => <li key={day.date}>
              {day.dayName} · <strong>{day.snowCm! < 0.1 ? '<0.1' : day.snowCm!.toFixed(1)} cm</strong>
            </li>)}
          </ul>
        </div>
      </div>}

      <div className="forecast-overview">
        <section className={`outlook-card ${selectedDay.high === null ? 'outlook-card--pending' : ''}`} aria-labelledby="outlook-title">
          <div className="outlook-topline"><span className="eyebrow" id="outlook-title">{selectedDay.dayName}’s outlook</span><span className="outlook-date">{dateLabel(selectedDay.date, true)}</span></div>
          <div className="outlook-main">
            <div className="outlook-weather">
              <span className="daily-high-label">Daily high</span>
              <div className="outlook-temperature">{number(selectedDay.high)}<span>°C</span></div>
              <h2>{selectedDay.high === null ? 'Forecast on its way' : selectedDay.condition}</h2>
              <p>{selectedDay.high === null ? 'Your daily outlook will appear here.' : <>Low of {number(selectedDay.low)}° · {selectedDay.rainMm === null ? 'Rain data unavailable' : selectedDay.rainMm >= 0.5 ? 'Keep an umbrella handy' : 'A mostly dry day'}</>}</p>
            </div>
            <SkyIllustration wet={(selectedDay.rainMm ?? 0) >= 0.5} />
          </div>
          <div className="outlook-stats">
            <div><WeatherIcon name="drop" /><span>Rainfall<strong>{selectedDay.rainMm === null ? '—' : selectedDay.rainMm.toFixed(1)} <small>mm</small></strong></span></div>
            <div><WeatherIcon name="wind" /><span>Average wind<strong>{number(selectedDay.windMph)} <small>mph</small></strong></span></div>
            <div><WeatherIcon name="wind" /><span>Peak gust<strong>{number(selectedDay.gustMph)} <small>mph</small></strong></span></div>
          </div>
        </section>

        <aside className="week-briefing">
          <div className="briefing-heading"><span className="briefing-icon"><WeatherIcon name="sun" /></span><span className="eyebrow">The bigger picture</span></div>
          <h2>A look at <br />the week ahead.</h2>
          <p>{hasData ? weekSummary : 'We’re bringing the weather models together to give you a useful overview of the coming week.'}</p>
          <div className="briefing-source"><span className="status-dot" /><span>{hasData ? `${modelCount} weather model${modelCount === 1 ? '' : 's'}. One local outlook.` : 'Powered by Open-Meteo'}</span></div>
        </aside>
      </div>

      <section className="weekly-section" aria-labelledby="weekly-title">
        <div className="section-heading"><h2 id="weekly-title">The next 7 days</h2><span><span className="desktop-hint">Select a day to explore</span><span className="mobile-hint">Swipe & select</span> <WeatherIcon name="arrow" /></span></div>
        <div className="day-cards">
          {days.map((day, index) => (
            <button key={day.date} type="button" className={`day-card ${selectedIndex === index ? 'day-card--selected' : ''}`} onClick={() => setSelectedIndex(index)} aria-pressed={selectedIndex === index} aria-label={`${day.dayName}, ${dateLabel(day.date)}, ${day.high === null ? 'forecast unavailable' : `${day.condition}, high ${number(day.high)}, low ${number(day.low)} degrees Celsius`}`}>
              <span className="day-name">{day.shortDay}</span>
              <span className="day-date">{dateLabel(day.date)}</span>
              <WeatherIcon name={iconFor(day)} className="day-weather-icon" />
              <span className="day-card-condition">{day.high === null ? 'Awaiting data' : day.condition}</span>
              <span className="day-card-temps"><strong>{number(day.high)}°</strong><span>{number(day.low)}°</span></span>
              <span className="day-card-rain"><WeatherIcon name="drop" />{day.rainMm === null ? '—' : day.rainMm.toFixed(1)} mm</span>
              <span className="day-card-wind"><WeatherIcon name="wind" />{number(day.windMph)} mph</span>
            </button>
          ))}
        </div>
      </section>

      <section className="hourly-section" aria-labelledby="hourly-title">
        <div className="section-heading"><div><p className="eyebrow">A closer look</p><h2 id="hourly-title">{selectedDay.dayName}, hour by hour</h2></div><span>Local time · °C</span></div>
        <div className="hourly-scroll" ref={hourlyScroll} tabIndex={0} role="region" aria-label={`${selectedDay.dayName} hourly forecast, scroll for more`}>
          <div className="hourly-grid">
            {hourly.map((hour) => <div className="hourly-item" key={hour.time}>
              <span className="hourly-time">{toLocalTime(hour.time, 'time')}</span>
              <span className={`hourly-condition hourly-condition--${hour.condition.icon ?? 'unknown'}`} role="img" aria-label={hour.condition.label} title={hour.condition.label}>
                {hour.condition.icon ? <WeatherIcon name={hour.condition.icon} /> : <span aria-hidden="true">—</span>}
              </span>
              <strong>{number(hour.temperature)}°</strong>
              <span className="hourly-rain"><WeatherIcon name="drop" />{hour.rain === null ? '—' : hour.rain.toFixed(1)} mm</span>
              <span className="hourly-wind" title="Wind speed" aria-label={hour.wind === null ? 'Wind speed unavailable' : `Wind speed: ${number(hour.wind)} miles per hour`}><WeatherIcon name="wind" />{number(hour.wind)} mph</span>
            </div>)}
          </div>
        </div>
        <p className="hourly-caption">Hourly forecast · Rainfall is the forecast total for that hour.</p>
      </section>
      <p className="forecast-note"><span className="note-mark">i</span> Based on available ECMWF, GFS and UKMO forecasts. Explore the model tabs for the full picture.</p>
    </div>
  );
}
