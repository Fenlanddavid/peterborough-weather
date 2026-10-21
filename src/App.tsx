import { lazy, Suspense, useState } from 'react';
import { Nav } from './components/Nav';
import { LoadingBar } from './components/LoadingBar';
import { InstallApp } from './components/InstallApp';
import { Forecast } from './views/Forecast';
import { Summary } from './views/Summary';
import { Seasonal } from './views/Seasonal';
import { Teleconnections } from './views/Teleconnections';
import { useWeatherData } from './hooks/useWeatherData';
import { timeAgo } from './hooks/useLocalTime';
import { LOCATION } from './config/models';
import { WeatherIcon } from './components/WeatherIcon';
import { useEnsembles } from './hooks/useEnsembles';
import './App.css';
import './Home.css';
import './views/NightSky.css';
import './views/Seasonal.css';

// Recharts is only used here; keep it out of the bundle every other screen waits for.
const Trends = lazy(() => import('./views/Trends').then((module) => ({ default: module.Trends })));
const NightSky = lazy(() => import('./views/NightSky').then((module) => ({ default: module.NightSky })));
const SourceProbe = import.meta.env.DEV ? lazy(() => import('./views/SourceProbe').then(m => ({ default: m.SourceProbe }))) : null;

function App() {
  const [view, setView] = useState('forecast');
  const isOverview = ['forecast', 'summary', 'nightsky', 'seasonal'].includes(view);
  const { runs, loading, progress, lastUpdated, error, refresh } = useWeatherData();
  const ensembles = useEnsembles(['forecast', 'summary', 'nightsky'].includes(view));

  return (
    <div className={`app ${isOverview ? 'app--home' : ''} ${view === 'nightsky' ? 'app--nightsky' : view === 'seasonal' ? 'app--seasonal' : ''}`}>
      {isOverview ? <header className="home-header">
        <a className="home-brand" href="#" aria-label="Peterborough Weather home" onClick={(event) => { event.preventDefault(); setView('forecast'); }}>
          <span className="brand-mark"><WeatherIcon name="sun" /></span>
          <span>Peterborough<span className="brand-subtitle">WEATHER & OUTLOOK</span></span>
        </a>
        <div className="home-header-meta">
          <span className="home-location"><WeatherIcon name="pin" />Peterborough, UK</span>
          <span className="home-data-age">{lastUpdated ? `Checked ${timeAgo(lastUpdated)}` : loading ? 'Updating forecast' : 'Awaiting forecast'}</span>
          <button className="home-refresh" onClick={refresh} disabled={loading} aria-label={loading ? 'Updating forecast' : 'Refresh forecast'}><WeatherIcon name="refresh" /><span>{loading ? 'Updating' : 'Refresh'}</span></button>
        </div>
      </header> : <header className="app-header">
        <h1>{LOCATION.name} Weather Trends</h1>
        <div className="header-meta">
          {lastUpdated && <span className="data-age">Checked: {timeAgo(lastUpdated)}</span>}
          <button className="refresh-btn" onClick={refresh} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </header>}

      <LoadingBar progress={progress} />


      <Nav active={view} onNavigate={setView} />
      <InstallApp />

      <main className="app-main">
        {view === 'forecast' && <Forecast runs={runs} loading={loading} hasError={!!error} lastUpdated={lastUpdated} ensembles={ensembles.index} />}
        {view === 'summary' && <Summary runs={runs} loading={loading} hasError={!!error} ensembles={ensembles.index} />}
        {view === 'nightsky' && <Suspense fallback={<p role="status">Loading Night Sky…</p>}><NightSky runs={runs} loading={loading} hasError={!!error} ensembles={ensembles.index} /></Suspense>}
        {view === 'trends' && <Suspense fallback={<p className="forecast-status" role="status">Loading charts…</p>}><Trends runs={runs} /></Suspense>}
        {view === 'seasonal' && <Seasonal />}
        {view === 'teleconnections' && <Teleconnections />}
        {SourceProbe && <details><summary>Development source probe</summary><Suspense fallback={<p>Loading probes…</p>}><SourceProbe /></Suspense></details>}
      </main>

      <footer className="app-footer">
        {view === 'forecast' && <span className="footer-local"><WeatherIcon name="pin" />Made for a little corner of Cambridgeshire.</span>}
        <span>
          Data from{' '}
          <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
            Open-Meteo
          </a>
          {' · '}<a href={`${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.txt`}>Library notices</a>
        </span>
      </footer>
    </div>
  );
}

export default App;
