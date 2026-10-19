/** Major annual meteor showers and monthly sky events for Peterborough (52.57°N, -0.24°W) */

export interface MeteorShower {
  name: string;
  /** Parent body / origin */
  parent: string;
  /** Month-day of active period start (MM-DD) */
  activeFrom: string;
  /** Month-day of active period end (MM-DD) */
  activeTo: string;
  /** Month-day of peak (MM-DD) */
  peakFrom: string;
  peakTo: string;
  /** Zenithal hourly rate at peak under ideal conditions */
  zhr: number | string;
  /** Best direction to look */
  radiantDirection: string;
  /** Brief observing tip */
  tip: string;
}

export interface SkyEvent {
  /** Month this event occurs (1–12) */
  month: number;
  /** Day of month (approximate) */
  day: number;
  title: string;
  description: string;
  type: 'planet' | 'eclipse' | 'solstice' | 'equinox' | 'other';
}

export const METEOR_SHOWERS: MeteorShower[] = [
  { name: 'Quadrantids', parent: 'Asteroid 2003 EH1', activeFrom: '01-01', activeTo: '01-06', peakFrom: '01-03', peakTo: '01-04', zhr: 120, radiantDirection: 'NE (Boötes)', tip: 'Sharp peak — a few hours of strong activity. Best after midnight when the radiant is high.' },
  { name: 'Lyrids', parent: 'Comet Thatcher', activeFrom: '04-16', activeTo: '04-25', peakFrom: '04-22', peakTo: '04-23', zhr: 18, radiantDirection: 'E (Lyra)', tip: 'A reliable spring shower. Look east after midnight towards Vega.' },
  { name: 'Eta Aquariids', parent: 'Comet Halley', activeFrom: '04-19', activeTo: '05-28', peakFrom: '05-05', peakTo: '05-06', zhr: 50, radiantDirection: 'SE (Aquarius)', tip: 'Radiant is low from UK latitudes — best in the hour before dawn. Fast meteors.' },
  { name: 'Delta Aquariids', parent: 'Comet 96P/Machholz', activeFrom: '07-12', activeTo: '08-23', peakFrom: '07-28', peakTo: '07-29', zhr: 25, radiantDirection: 'S (Aquarius)', tip: 'Broad peak, moderate rates. Overlaps with early Perseids.' },
  { name: 'Perseids', parent: 'Comet Swift-Tuttle', activeFrom: '07-17', activeTo: '08-24', peakFrom: '08-12', peakTo: '08-13', zhr: 100, radiantDirection: 'NE (Perseus)', tip: 'The headline summer shower. Warm nights and high rates — lie back and look up from 22:00.' },
  { name: 'Draconids', parent: 'Comet 21P/Giacobini-Zinner', activeFrom: '10-06', activeTo: '10-10', peakFrom: '10-08', peakTo: '10-09', zhr: 'variable', radiantDirection: 'NW (Draco)', tip: 'Usually quiet but capable of outbursts. Best in the evening — unusual for a meteor shower.' },
  { name: 'Orionids', parent: 'Comet Halley', activeFrom: '10-02', activeTo: '11-07', peakFrom: '10-21', peakTo: '10-22', zhr: 20, radiantDirection: 'SE (Orion)', tip: 'Fast, bright meteors. Best after midnight when Orion is high in the south.' },
  { name: 'Southern Taurids', parent: 'Comet Encke', activeFrom: '09-10', activeTo: '11-20', peakFrom: '10-10', peakTo: '10-10', zhr: 5, radiantDirection: 'S (Taurus)', tip: 'Low rates but known for fireballs. Worth watching for bright, slow-moving meteors.' },
  { name: 'Northern Taurids', parent: 'Comet Encke', activeFrom: '10-20', activeTo: '12-10', peakFrom: '11-12', peakTo: '11-12', zhr: 5, radiantDirection: 'S (Taurus)', tip: 'Complements the Southern Taurids. Another fireball shower — quality over quantity.' },
  { name: 'Leonids', parent: 'Comet Tempel-Tuttle', activeFrom: '11-06', activeTo: '11-30', peakFrom: '11-17', peakTo: '11-18', zhr: 15, radiantDirection: 'E (Leo)', tip: 'Occasional storm years (next ~2034). Best after midnight facing east.' },
  { name: 'Geminids', parent: 'Asteroid 3200 Phaethon', activeFrom: '12-04', activeTo: '12-17', peakFrom: '12-13', peakTo: '12-14', zhr: 150, radiantDirection: 'Overhead (Gemini)', tip: 'The year\'s richest shower. Active from early evening — wrap up warm and find dark sky.' },
  { name: 'Ursids', parent: 'Comet 8P/Tuttle', activeFrom: '12-17', activeTo: '12-26', peakFrom: '12-22', peakTo: '12-23', zhr: 10, radiantDirection: 'N (Ursa Minor)', tip: 'A gentle shower near the winter solstice. Circumpolar radiant — visible all night.' },
];

/** Fixed annual sky events (solstices, equinoxes, notable recurring phenomena) */
export const ANNUAL_EVENTS: SkyEvent[] = [
  { month: 3, day: 20, title: 'Spring equinox', description: 'Day and night are roughly equal. The Sun crosses the celestial equator heading north.', type: 'equinox' },
  { month: 6, day: 21, title: 'Summer solstice', description: 'The longest day. Shortest window of true darkness for stargazing — but the warmest nights.', type: 'solstice' },
  { month: 9, day: 22, title: 'Autumn equinox', description: 'Day and night are roughly equal again. Nights are drawing in — darker skies return.', type: 'equinox' },
  { month: 12, day: 21, title: 'Winter solstice', description: 'The shortest day. Long, dark nights — ideal for deep-sky observing if skies are clear.', type: 'solstice' },
  { month: 2, day: 1, title: 'Zodiacal light season (evening)', description: 'Look west after twilight for a faint cone of light along the ecliptic. Best from dark sites with a flat western horizon.', type: 'other' },
  { month: 10, day: 1, title: 'Zodiacal light season (morning)', description: 'Look east before dawn for a faint cone of light along the ecliptic. Best from dark sites.', type: 'other' },
];

/** Parse MM-DD to a Date in the given year */
function parseMMDD(mmdd: string, year: number): Date {
  const [m, d] = mmdd.split('-').map(Number);
  return new Date(year, m - 1, d);
}

export interface ActiveShower extends MeteorShower {
  /** Is the shower currently at or near peak? */
  isPeak: boolean;
  /** Days until peak (negative if past peak) */
  daysToPeak: number;
  /** Human-readable peak date label */
  peakLabel: string;
  /** Status label */
  status: 'Peak tonight' | 'Peak approaching' | 'Active now' | 'Coming soon';
}

/**
 * Get meteor showers relevant to a given date:
 * - currently active showers
 * - showers peaking within the next 30 days
 */
export function getRelevantShowers(dateStr: string): ActiveShower[] {
  const now = new Date(`${dateStr}T12:00:00Z`);
  const year = now.getFullYear();
  const results: ActiveShower[] = [];

  for (const shower of METEOR_SHOWERS) {
    const activeStart = parseMMDD(shower.activeFrom, year);
    const activeEnd = parseMMDD(shower.activeTo, year);
    const peakStart = parseMMDD(shower.peakFrom, year);
    const peakEnd = parseMMDD(shower.peakTo, year);

    // Handle year-wrapping (e.g. Dec-Jan for Quadrantids)
    if (activeEnd < activeStart) activeEnd.setFullYear(year + 1);
    if (peakEnd < peakStart) peakEnd.setFullYear(year + 1);

    const isActive = now >= activeStart && now <= activeEnd;
    const daysToPeakStart = Math.round((peakStart.getTime() - now.getTime()) / 86400_000);
    const daysToPeakEnd = Math.round((peakEnd.getTime() - now.getTime()) / 86400_000);
    const isPeak = daysToPeakStart <= 0 && daysToPeakEnd >= 0;
    const isApproaching = daysToPeakStart > 0 && daysToPeakStart <= 30;

    if (!isActive && !isApproaching) continue;

    const peakDate = peakStart;
    const peakLabel = `${peakDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}${
      shower.peakFrom !== shower.peakTo ? '–' + parseMMDD(shower.peakTo, year).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''
    }`;

    let status: ActiveShower['status'];
    if (isPeak) status = 'Peak tonight';
    else if (isActive && daysToPeakStart > 0 && daysToPeakStart <= 3) status = 'Peak approaching';
    else if (isActive) status = 'Active now';
    else status = 'Coming soon';

    results.push({
      ...shower,
      isPeak,
      daysToPeak: daysToPeakStart,
      peakLabel,
      status,
    });
  }

  // Sort: peak tonight first, then by days to peak
  results.sort((a, b) => {
    if (a.isPeak && !b.isPeak) return -1;
    if (!a.isPeak && b.isPeak) return 1;
    return a.daysToPeak - b.daysToPeak;
  });

  return results;
}

/** Get annual sky events for the current month (±15 days) */
export function getMonthlyEvents(dateStr: string): SkyEvent[] {
  const now = new Date(`${dateStr}T12:00:00Z`);
  const month = now.getMonth() + 1;
  return ANNUAL_EVENTS.filter((e) => {
    // Within ±1 month
    const diff = e.month - month;
    return diff === 0 || diff === 1 || diff === -11; // current or next month (wrapping Dec→Jan)
  });
}
