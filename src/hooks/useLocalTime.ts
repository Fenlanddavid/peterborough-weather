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
