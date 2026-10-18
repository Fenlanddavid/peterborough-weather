export interface ModelConfig {
  id: string;
  label: string;
  family: 'ECMWF' | 'NOAA' | 'UKMO';
  runCycles: number[]; // UTC hours
  colour: string;
  type: 'deterministic';
  isOverlay?: boolean; // UKV — show but exclude from family comparison
}

export interface EnsembleConfig {
  id: string;
  label: string;
  family: 'ECMWF' | 'NOAA' | 'UKMO';
  members: number;
  colour: string;
  type: 'ensemble';
}

export const DETERMINISTIC_MODELS: ModelConfig[] = [
  { id: 'ecmwf_ifs025', label: 'ECMWF IFS', family: 'ECMWF', runCycles: [0, 6, 12, 18], colour: '#2563eb', type: 'deterministic' },
  { id: 'ecmwf_aifs025_single', label: 'ECMWF AIFS', family: 'ECMWF', runCycles: [0, 6, 12, 18], colour: '#60a5fa', type: 'deterministic' },
  { id: 'gfs_global', label: 'GFS', family: 'NOAA', runCycles: [0, 6, 12, 18], colour: '#dc2626', type: 'deterministic' },
  { id: 'ncep_aigfs025', label: 'AIGFS', family: 'NOAA', runCycles: [0, 6, 12, 18], colour: '#f87171', type: 'deterministic' },
  { id: 'ukmo_global_deterministic_10km', label: 'UKMO Global', family: 'UKMO', runCycles: [0, 6, 12, 18], colour: '#16a34a', type: 'deterministic' },
  { id: 'ukmo_uk_deterministic_2km', label: 'UKV', family: 'UKMO', runCycles: [0, 6, 12, 18], colour: '#86efac', type: 'deterministic', isOverlay: true },
];

export const ENSEMBLE_MODELS: EnsembleConfig[] = [
  { id: 'ecmwf_ifs025', label: 'ECMWF ENS', family: 'ECMWF', members: 51, colour: '#2563eb', type: 'ensemble' },
  { id: 'gfs025', label: 'GEFS', family: 'NOAA', members: 31, colour: '#dc2626', type: 'ensemble' },
  { id: 'ukmo_global_ensemble_20km', label: 'MOGREPS-G', family: 'UKMO', members: 36, colour: '#16a34a', type: 'ensemble' },
];

export const VARIABLES = [
  { id: 'temperature_2m', label: 'Temperature', unit: '°C', precision: 1 },
  { id: 'precipitation', label: 'Precipitation', unit: 'mm', precision: 1 },
  { id: 'wind_speed_10m', label: 'Wind Speed', unit: 'mph', precision: 0, convertFromMs: true },
  { id: 'wind_gusts_10m', label: 'Wind Gusts', unit: 'mph', precision: 0, convertFromMs: true },
  { id: 'pressure_msl', label: 'Pressure', unit: 'hPa', precision: 0 },
] as const;

export type VariableId = (typeof VARIABLES)[number]['id'];

export const LOCATION = {
  name: 'Peterborough',
  latitude: 52.5736,
  longitude: -0.2400,
};

export const FAMILY_COLOURS: Record<string, string> = {
  ECMWF: '#2563eb',
  NOAA: '#dc2626',
  UKMO: '#16a34a',
};

export const RUN_LOOKBACK_HOURS = 120;
export const MS_PER_HOUR = 3600_000;
