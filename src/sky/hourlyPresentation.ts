import type { IconName } from '../components/WeatherIcon';

/** Sky symbols describe cloud cover. Observing suitability also includes darkness,
 * moonlight, precipitation and wind, so it keeps its own small, labelled badge. */
export function skyHourlyPresentation(cloud: number | null, score: number | null, darkMinutes: number) {
  const known = cloud !== null && Number.isFinite(cloud) && cloud >= 0 && cloud <= 1;
  const condition: { label: string; icon: IconName; tone: string } = !known ? { label: 'Sky unknown', icon: 'eye', tone: 'unknown' }
    : cloud < 0.3 ? { label: 'Mostly clear', icon: 'stars', tone: 'clear' }
    : cloud < 0.65 ? { label: 'Some cloud', icon: 'cloud-stars', tone: 'mixed' }
    : cloud < 0.9 ? { label: 'Mostly cloudy', icon: 'cloud', tone: 'cloudy' }
    : { label: 'Overcast', icon: 'cloud', tone: 'cloudy' };
  const suitability = darkMinutes === 0 ? { label: 'Twilight', tone: 'twilight' }
    : score === null || !Number.isFinite(score) ? { label: 'Limited data', tone: 'unknown' }
    : score >= 55 ? { label: 'Good viewing', tone: 'good' }
    : score >= 35 ? { label: 'Fair viewing', tone: 'fair' }
    : { label: 'Poor viewing', tone: 'poor' };
  return { ...condition, suitability, cloudLabel: known ? `${Math.round(cloud * 100)}% cloud` : 'Cloud unknown' };
}
