import type { OutlookWeek } from '../types';
import type { TeleconnectionContext } from './regime';

export function temperatureSignal(anomaly: number | null): string {
  if (anomaly === null) return 'Temperature uncertain';
  return anomaly >= 0.5 ? 'Warmer than usual' : anomaly <= -0.5 ? 'Cooler than usual' : 'Near usual temperatures';
}

export function rainfallSignal(total: number | null, anomaly: number | null): string {
  if (total === null || anomaly === null || total - anomaly <= 0) return 'Rainfall uncertain';
  const ratio = anomaly / (total - anomaly);
  return ratio >= 0.2 && anomaly >= 2 ? 'Wetter than usual' : ratio <= -0.2 && anomaly <= -2 ? 'Drier than usual' : 'Near usual rainfall';
}

export function monthlySummary(weeks: OutlookWeek[], teleconnections?: TeleconnectionContext | null): string {
  if (weeks.length < 4) return 'Only part of the four-week outlook is available. Check the weekly signals below.';
  const temperature = weeks.every((week) => week.temperatureAnomaly !== null)
    ? temperatureSignal(weeks.reduce((sum, week) => sum + week.temperatureAnomaly!, 0) / weeks.length) : null;
  const rainfall = weeks.every((week) => week.rainfallMm !== null && week.rainfallAnomaly !== null)
    ? rainfallSignal(weeks.reduce((sum, week) => sum + week.rainfallMm!, 0), weeks.reduce((sum, week) => sum + week.rainfallAnomaly!, 0)) : null;
  const tempText = temperature === 'Warmer than usual' ? 'Temperatures lean warmer than usual overall.'
    : temperature === 'Cooler than usual' ? 'Temperatures lean cooler than usual overall.'
    : temperature === 'Near usual temperatures' ? 'Temperatures look close to the seasonal average overall.' : 'The temperature signal is incomplete.';
  const rainText = rainfall === 'Wetter than usual' ? 'Rainfall leans wetter than usual.'
    : rainfall === 'Drier than usual' ? 'Rainfall leans drier than usual.'
    : rainfall === 'Near usual rainfall' ? 'Rainfall looks close to the seasonal average.' : 'The rainfall signal is uncertain.';

  let tcText = '';
  // The temperature interpretation below is winter guidance, not an all-season rule.
  const winterOutlook = weeks.every((week) => [11, 12, 1, 2, 3].includes(Number(week.date.slice(5, 7))));
  if (winterOutlook && teleconnections?.mjoOutlook?.strong) {
    const mjo = teleconnections.mjoOutlook;
    // Check if MJO outlook aligns with or contradicts the model outlook
    const modelSaysCold = temperature === 'Cooler than usual';
    const modelSaysWarm = temperature === 'Warmer than usual';
    const mjoSaysCold = mjo.phase >= 6 && mjo.phase <= 8;
    const mjoSaysWarm = mjo.phase >= 2 && mjo.phase <= 3;

    if ((modelSaysCold && mjoSaysCold) || (modelSaysWarm && mjoSaysWarm)) {
      tcText = ` The active MJO in Phase ${mjo.phase} may support this temperature signal.`;
    } else if ((modelSaysCold && mjoSaysWarm) || (modelSaysWarm && mjoSaysCold)) {
      tcText = ` Note: the MJO in Phase ${mjo.phase} may work against this signal in the coming weeks.`;
    }
  }

  return `${tempText} ${rainText}${tcText}`;
}
