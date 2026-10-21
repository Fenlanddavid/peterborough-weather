import { useState } from 'react';
import { sourceProbes } from '../data/probes';
import { scheduledFetch, HttpError } from '../data/scheduler';

export function SourceProbe() {
  const [rows, setRows] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true); setRows([`Browser origin: ${location.origin}; deployed Pages origin must be tested separately from localhost.`]);
    for (const probe of sourceProbes().filter(p => !p.nodeOnly)) {
      try {
        const r = await scheduledFetch(probe.url, { timeout: 20_000 });
        const text = await r.text();
        setRows(rows => [...rows, `${probe.id}: readable HTTP ${r.status}, ${text.length} bytes · ${probe.url}`]);
      } catch (error) { setRows(rows => [...rows, `${probe.id}: ${error instanceof HttpError ? `observable HTTP ${error.status}` : 'unreadable; HTTP status unknown (CORS or network)'}: ${String(error)} · ${probe.url}`]); }
    }
    setRunning(false);
  };
  return <section><h1>Source probes (development)</h1><p>These are live requests. An unreadable Access-Control-Allow-Origin header does not imply fetch failure. AviationWeather is Node-only.</p><button disabled={running} onClick={run}>Run browser probes</button><pre style={{ whiteSpace: 'pre-wrap' }}>{rows.join('\n')}</pre></section>;
}
