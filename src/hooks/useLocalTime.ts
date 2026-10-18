import { useEffect, useState } from 'react';

/** Refresh the browsing time while open and when returning to the app. */
export function useLocalNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = () => setNow(new Date());
    const onVisible = () => { if (!document.hidden) update(); };
    const timer = window.setInterval(update, 60_000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', update);
    };
  }, []);
  return now;
}

/** Calendar date in Peterborough rather than the device's time zone. */
export function getLocalDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/** UTC forecast hours belonging to a calendar day in Peterborough, including clock changes. */
export function getLocalDayHours(dateISO: string): string[] {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const midnightUTC = Date.parse(`${dateISO}T00:00:00Z`);
  const selectedDate = formatter.format(new Date(`${dateISO}T12:00:00Z`));
  const hours: string[] = [];
  // UK local midnight is either 23:00 UTC on the previous day or 00:00 UTC.
  for (let offset = -1; offset < 25; offset++) {
    const time = new Date(midnightUTC + offset * 3600_000);
    if (formatter.format(time) === selectedDate) hours.push(time.toISOString().slice(0, 16));
  }
  return hours;
}

/** Today starts with the current hour; other selected days start at 09:00 local time. */
export function getHourlyForecastTimes(dateISO: string, now: Date): string[] {
  const isToday = dateISO === getLocalDate(now);
  const currentHour = Math.floor(now.getTime() / 3600_000) * 3600_000;
  return getLocalDayHours(dateISO).filter((time) => isToday
    ? Date.parse(`${time}Z`) >= currentHour
    : Number(toLocalTime(time, 'time').slice(0, 2)) >= 9);
}

/** Format a UTC ISO string to Europe/London local time */
export function toLocalTime(utcISO: string, formatStr: 'short' | 'long' | 'time' = 'short'): string {
  const date = new Date(utcISO.endsWith('Z') ? utcISO : utcISO + 'Z');
  const opts: Intl.DateTimeFormatOptions = { timeZone: 'Europe/London' };

  switch (formatStr) {
    case 'short':
      return date.toLocaleString('en-GB', { ...opts, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    case 'long':
      return date.toLocaleString('en-GB', { ...opts, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    case 'time':
      return date.toLocaleString('en-GB', { ...opts, hour: '2-digit', minute: '2-digit' });
  }
}

/** Format relative time ("2h ago") */
export function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
