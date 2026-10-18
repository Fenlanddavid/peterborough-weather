import { useTeleconnections } from '../hooks/useTeleconnections';
import { WeatherIcon } from '../components/WeatherIcon';
import type { TeleconnectionIndex } from '../api/teleconnections';

function IndexCard({ index, label }: { index: TeleconnectionIndex | null; label: string }) {
  if (!index) return (
    <div className="tc-index-card tc-index-card--empty">
      <span className="tc-index-label">{label}</span>
      <span className="tc-index-value">—</span>
    </div>
  );

  const isPositive = index.value > 0;
  const isStrong = Math.abs(index.value) > 1.0;
  const trendArrow = index.trend === 'rising' ? '↑' : index.trend === 'falling' ? '↓' : '';

  return (
    <div className={`tc-index-card ${isStrong ? 'tc-index-card--strong' : ''}`}>
      <span className="tc-index-label">{label}</span>
      <span className={`tc-index-value ${isPositive ? 'tc-positive' : 'tc-negative'}`}>
        {isPositive ? '+' : ''}{index.value.toFixed(2)}
        {trendArrow && <span className="tc-trend">{trendArrow}</span>}
      </span>
      {index.date && <span className="tc-index-date">{index.date}</span>}
    </div>
  );
}

function MJOWheel({ phase, amplitude }: { phase: number; amplitude: number }) {
  const strong = amplitude > 1.5;
  const phaseLabels = ['', 'W. Hem / Africa', 'Indian Ocean', 'Indian Ocean', 'Maritime Continent', 'Maritime Continent', 'W. Pacific', 'W. Pacific', 'W. Hem / Africa'];

  return (
    <div className="tc-mjo-card">
      <div className="tc-mjo-header">
        <span className="tc-index-label">MJO</span>
        <span className={`tc-mjo-strength ${strong ? 'tc-mjo-strong' : 'tc-mjo-weak'}`}>
          {strong ? 'Active' : 'Weak'} · Amplitude {amplitude.toFixed(1)}
        </span>
      </div>
      <div className="tc-mjo-wheel">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((p) => (
          <div key={p} className={`tc-mjo-phase ${p === phase ? 'tc-mjo-phase--active' : ''}`}>
            <span className="tc-mjo-phase-num">{p}</span>
          </div>
        ))}
      </div>
      <p className="tc-mjo-location">Phase {phase}: {phaseLabels[phase] ?? 'Unknown'}</p>
    </div>
  );
}

export function Teleconnections() {
  const { snapshot, context, loading, failed, refresh } = useTeleconnections();

  const hasData = snapshot && (snapshot.nao || snapshot.ao || snapshot.enso || snapshot.pna || snapshot.ea || snapshot.scand || snapshot.mjo);

  return (
    <div className="view-teleconnections">
      <div className="tc-intro">
        <div>
          <p className="eyebrow">Large-scale patterns</p>
          <h1>Teleconnections</h1>
          <p>The atmospheric oscillations that shape our weather, days and weeks ahead.</p>
        </div>
        <button className="tc-refresh" onClick={refresh} disabled={loading}>
          <WeatherIcon name="refresh" />
          <span>{loading ? 'Updating' : 'Refresh'}</span>
        </button>
      </div>

      {(loading || failed || !hasData) && (
        <div className="tc-status" role="status">
          {loading ? 'Updating teleconnection data…'
            : failed ? hasData ? 'Refresh failed. Showing previously saved indices.' : 'Teleconnection data could not be loaded. Try Refresh to reconnect.'
            : 'Teleconnection data is unavailable.'}
        </div>
      )}

      {context && (
        <section className="tc-regime" aria-labelledby="regime-title">
          <div className="tc-regime-header">
            <div>
              <span className="eyebrow">Indicative regime</span>
              <h2 id="regime-title">{context.regime.label}</h2>
            </div>
            <span className={`tc-confidence tc-confidence--${context.regime.confidence}`}>
              {context.regime.confidence} confidence
            </span>
          </div>
          <p className="tc-regime-desc">{context.regime.description}</p>
          <div className="tc-regime-impact">
            <WeatherIcon name="pin" />
            <div>
              <strong>What it means for Peterborough</strong>
              <p>{context.regime.ukImpact}</p>
            </div>
          </div>
        </section>
      )}

      <section className="tc-indices" aria-labelledby="indices-title">
        <h2 id="indices-title">Latest reported indices</h2>
        <div className="tc-indices-grid">
          <IndexCard index={snapshot?.nao ?? null} label="NAO" />
          <IndexCard index={snapshot?.ao ?? null} label="AO" />
          <IndexCard index={snapshot?.enso ?? null} label="ENSO" />
          <IndexCard index={snapshot?.pna ?? null} label="PNA" />
          <IndexCard index={snapshot?.ea ?? null} label="EA" />
          <IndexCard index={snapshot?.scand ?? null} label="SCAND" />
        </div>
        {context && <p className="tc-enso-state"><strong>Background state:</strong> {context.ensoState}</p>}
      </section>

      {snapshot?.mjo && (
        <section className="tc-mjo-section" aria-labelledby="mjo-title">
          <h2 id="mjo-title">Madden–Julian Oscillation</h2>
          <MJOWheel phase={snapshot.mjo.phase} amplitude={snapshot.mjo.amplitude} />
          {context?.mjoOutlook && (
            <div className="tc-mjo-outlook">
              <p className="tc-mjo-implication">{context.mjoOutlook.naoImplication}</p>
              {context.mjoOutlook.leadDays && (
                <p className="tc-mjo-lead">Potential UK influence: {context.mjoOutlook.leadDays} after the observation{snapshot.mjo.date ? ` (${snapshot.mjo.date})` : ''}.</p>
              )}
              <p className="tc-mjo-confidence">{context.mjoOutlook.confidenceNote}</p>
            </div>
          )}
        </section>
      )}

      {context && context.modelNotes.length > 0 && (
        <section className="tc-model-notes" aria-labelledby="notes-title">
          <h2 id="notes-title">Model guidance notes</h2>
          <ul>
            {context.modelNotes.map((note, i) => <li key={i}>{note}</li>)}
          </ul>
        </section>
      )}

      <section className="tc-explainer">
        <h2>How teleconnections work</h2>
        <div className="tc-explainer-grid">
          <div>
            <h3>NAO</h3>
            <p>The North Atlantic Oscillation measures the pressure difference between Iceland and the Azores. It's the dominant driver of UK weather patterns, especially in winter.</p>
          </div>
          <div>
            <h3>AO</h3>
            <p>The Arctic Oscillation tracks the strength of the polar vortex. When it's negative, cold Arctic air is more likely to spill southward into Europe.</p>
          </div>
          <div>
            <h3>MJO</h3>
            <p>The Madden–Julian Oscillation is a tropical weather pattern that circles the equator every 30–60 days. Its phase can influence the NAO with a 10–14 day lag.</p>
          </div>
          <div>
            <h3>ENSO</h3>
            <p>El Niño and La Niña set the background state of the tropical Pacific. They modulate the jet stream and can tilt the odds toward certain weather regimes for months at a time.</p>
          </div>
        </div>
      </section>

      <p className="tc-source">
        Indices from{' '}
        <a href="https://www.cpc.ncep.noaa.gov/" target="_blank" rel="noopener noreferrer">NOAA CPC</a>
        {' '}via{' '}
        <a href="https://iamelnino.com/teleconnections" target="_blank" rel="noopener noreferrer">Global Teleconnections Dashboard</a>.
        {snapshot?.fetchedAt && <> Last checked {new Date(snapshot.fetchedAt).toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}.</>}
      </p>
    </div>
  );
}
