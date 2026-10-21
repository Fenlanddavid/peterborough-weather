/** Shared by the Node collector and the development-only browser view. */
export interface Probe { id: string; provider: string; model: string; url: string; nodeOnly?: boolean }
const location = { latitude: '52.5736', longitude: '-0.2400', timezone: 'GMT', wind_speed_unit: 'ms' };
const weather = (endpoint: string, params: Record<string, string>) => `${endpoint}?${new URLSearchParams({ ...location, ...params })}`;
export const ENSEMBLE_CANDIDATES = ['ecmwf_ifs025', 'gfs025', 'ukmo_global_ensemble_20km'];
export const ENSEMBLE_VARIABLES = ['temperature_2m', 'precipitation', 'wind_gusts_10m', 'snowfall', 'cloud_cover'] as const;
export const SKY_VARIABLES = ['cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'temperature_2m', 'dew_point_2m', 'relative_humidity_2m', 'visibility', 'wind_speed_250hPa'] as const;
export const SKY_MODELS = ['ecmwf_ifs025', 'gfs_global', 'ukmo_global_deterministic_10km'];
export function sourceProbes(): Probe[] {
  const probes: Probe[] = [];
  for (const model of ENSEMBLE_CANDIDATES) for (const variable of ENSEMBLE_VARIABLES) probes.push({
    id: `ensemble-${model}-${variable}`, provider: 'Open-Meteo Ensemble', model,
    url: weather('https://ensemble-api.open-meteo.com/v1/ensemble', { models: model, hourly: variable, forecast_days: '8' }),
  });
  for (const model of SKY_MODELS) for (const variable of SKY_VARIABLES) probes.push({
    id: `sky-${model}-${variable}`, provider: 'Open-Meteo Forecast', model,
    url: weather('https://api.open-meteo.com/v1/forecast', { models: model, hourly: variable, forecast_days: '8' }),
  });
  for (const model of ['ecmwf_ifs025_ensemble', 'ncep_gefs025', 'ukmo_global_ensemble_20km']) probes.push({ id: `metadata-${model}`, provider: 'Open-Meteo model updates', model, url: `https://api.open-meteo.com/data/${model}/static/meta.json` });
  for (const model of ENSEMBLE_CANDIDATES) probes.push({ id: `runtime-ensemble-${model}`, provider: 'Open-Meteo Ensemble', model, url: weather('https://ensemble-api.open-meteo.com/v1/ensemble', { models: model, hourly: ENSEMBLE_VARIABLES.join(','), forecast_days: '9', temperature_unit: 'celsius', precipitation_unit: 'mm' }) });
  for (const model of SKY_MODELS) {
    probes.push({ id: `runtime-sky-core-${model}`, provider: 'Open-Meteo Forecast', model, url: weather('https://api.open-meteo.com/v1/forecast', { models: model, hourly: 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,temperature_2m,dew_point_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,precipitation', forecast_days: '9', temperature_unit: 'celsius', precipitation_unit: 'mm' }) });
    probes.push({ id: `runtime-sky-optional-${model}`, provider: 'Open-Meteo Forecast', model, url: weather('https://api.open-meteo.com/v1/forecast', { models: model, hourly: model === 'ecmwf_ifs025' ? 'wind_speed_250hPa' : 'visibility,wind_speed_250hPa', forecast_days: '9', temperature_unit: 'celsius', precipitation_unit: 'mm' }) });
  }
  for (const model of ['ecmwf_ifs025', 'ecmwf_aifs025_single', 'gfs_global', 'ncep_aigfs025', 'ukmo_global_deterministic_10km', 'ukmo_uk_deterministic_2km']) probes.push({ id: `deterministic-${model}`, provider: 'Open-Meteo Single Runs', model, url: weather('https://single-runs-api.open-meteo.com/v1/forecast', { models: model, run: new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10) + 'T00:00', hourly: 'temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m,pressure_msl,snowfall,weather_code,is_day,cloud_cover', forecast_days: '7', temperature_unit: 'celsius', precipitation_unit: 'mm' }) });
  probes.push(
    { id: 'single-runs', provider: 'Open-Meteo Single Runs', model: 'ecmwf_ifs025', url: weather('https://single-runs-api.open-meteo.com/v1/forecast', { models: 'ecmwf_ifs025', hourly: 'temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m,pressure_msl,snowfall,weather_code,is_day,cloud_cover', run: new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10) + 'T00:00', forecast_days: '7' }) },
    { id: 'previous-runs', provider: 'Open-Meteo Previous Runs', model: 'gfs_global', url: weather('https://previous-runs-api.open-meteo.com/v1/forecast', { models: 'gfs_global', hourly: 'temperature_2m_previous_day1,wind_speed_10m_previous_day1', past_days: '2', forecast_days: '1' }) },
    { id: 'air-quality', provider: 'Open-Meteo / CAMS', model: 'cams_global', url: weather('https://air-quality-api.open-meteo.com/v1/air-quality', { hourly: 'aerosol_optical_depth,dust', domains: 'cams_global', forecast_days: '7' }) },
    { id: 'seasonal-monthly', provider: 'Open-Meteo Seasonal', model: 'ecmwf_seas5', url: weather('https://seasonal-api.open-meteo.com/v1/seasonal', { models: 'ecmwf_seas5', monthly: 'temperature_2m_anomaly,precipitation_mean,precipitation_anomaly', forecast_days: '210' }) },
    { id: 'seasonal-weekly', provider: 'Open-Meteo Seasonal', model: 'ecmwf_ec46', url: weather('https://seasonal-api.open-meteo.com/v1/seasonal', { models: 'ecmwf_ec46', weekly: 'temperature_2m_anomaly,precipitation_mean,precipitation_anomaly', forecast_days: '46' }) },
    { id: 'kp-current', provider: 'NOAA SWPC', model: 'estimated Kp', url: 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json' },
    { id: 'kp-forecast', provider: 'NOAA SWPC', model: 'Kp forecast', url: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json' },
    { id: 'ovation', provider: 'NOAA SWPC', model: 'OVATION', url: 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json' },
    { id: 'solar-mag', provider: 'NOAA SWPC', model: 'DSCOVR GSM', url: 'https://services.swpc.noaa.gov/products/solar-wind/mag-2-hour.json' },
    { id: 'solar-plasma', provider: 'NOAA SWPC', model: 'DSCOVR plasma', url: 'https://services.swpc.noaa.gov/products/solar-wind/plasma-2-hour.json' },
    { id: 'solar-mag-replacement', provider: 'NOAA SWPC', model: 'RTSW active spacecraft / GSM', url: 'https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json' },
    { id: 'solar-plasma-replacement', provider: 'NOAA SWPC', model: 'RTSW active spacecraft', url: 'https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json' },
    { id: 'aurorawatch', provider: 'Lancaster University', model: 'AuroraWatch UK', url: 'https://aurorawatch-api.lancs.ac.uk/0.2/status/current-status.xml' },
    { id: 'iss', provider: 'CelesTrak', model: '25544', url: 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE' },
    { id: 'metar', provider: 'AviationWeather', model: 'EGXT', url: 'https://aviationweather.gov/api/data/metar?ids=EGXT&format=json&hours=72', nodeOnly: true },
  );
  return probes;
}
