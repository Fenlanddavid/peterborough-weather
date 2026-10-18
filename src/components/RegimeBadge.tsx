import { useTeleconnections } from '../hooks/useTeleconnections';
import { WeatherIcon } from './WeatherIcon';

export function RegimeBadge() {
  const { snapshot, context, loading } = useTeleconnections();

  if (loading && !context) return null;
  if (!context || !snapshot || context.regime.id === 'unavailable') return null;

  const naoLabel = snapshot.nao
    ? `NAO ${snapshot.nao.value > 0 ? '+' : ''}${snapshot.nao.value.toFixed(1)}`
    : null;

  const mjoLabel = snapshot.mjo && snapshot.mjo.amplitude > 1.5
    ? `MJO Phase ${snapshot.mjo.phase}`
    : null;

  return (
    <section className="regime-badge" aria-label="Pattern from latest reported indices">
      <div className="regime-badge-inner">
        <div className="regime-badge-header">
          <WeatherIcon name="sun" />
          <div>
            <span className="eyebrow">Latest reported pattern</span>
            <h3>{context.regime.label}</h3>
          </div>
          <span className={`tc-confidence tc-confidence--${context.regime.confidence}`}>
            {context.regime.confidence}
          </span>
        </div>
        <p className="regime-badge-impact">{context.regime.ukImpact}</p>
        <div className="regime-badge-chips">
          {naoLabel && <span className="regime-chip">{naoLabel}{snapshot.nao?.date ? ` · ${snapshot.nao.date}` : ''}</span>}
          {mjoLabel && <span className="regime-chip">{mjoLabel}</span>}
          <span className="regime-chip">{context.ensoState}</span>
        </div>
        {context.mjoOutlook?.strong && (
          <p className="regime-badge-mjo">{context.mjoOutlook.naoImplication}</p>
        )}
      </div>
    </section>
  );
}
