import { useState } from 'react';
import { Nav } from './components/Nav';
import { LoadingBar } from './components/LoadingBar';
import { InstallApp } from './components/InstallApp';
import { Forecast } from './views/Forecast';
import { Summary } from './views/Summary';
import { Trends } from './views/Trends';
import { Models } from './views/Models';
import { Ensembles } from './views/Ensembles';
import { Teleconnections } from './views/Teleconnections';
import { About } from './views/About';
import { useWeatherData } from './hooks/useWeatherData';
import { timeAgo } from './hooks/useLocalTime';
import { LOCATION } from './config/models';
import { WeatherIcon } from './components/WeatherIcon';
import './Home.css';

function App() {
  const [view, setView] = useState('forecast');
  const { runs, ensembles, loading, progress, lastUpdated, error, refresh } = useWeatherData();

  return (
    <div className={`app ${view === 'forecast' ? 'app--home' : ''}`}>
      {view === 'forecast' ? <header className="home-header">
        <a className="home-brand" href="#" aria-label="Peterborough Weather home" onClick={(event) => { event.preventDefault(); setView('forecast'); }}>
          <span className="brand-mark"><WeatherIcon name="sun" /></span>
          <span>Peterborough<span className="brand-subtitle">WEATHER & OUTLOOK</span></span>
        </a>
        <div className="home-header-meta">
          <span className="home-location"><WeatherIcon name="pin" />Peterborough, UK</span>
          <span className="home-data-age">{lastUpdated ? `Updated ${timeAgo(lastUpdated)}` : loading ? 'Updating forecast' : 'Awaiting forecast'}</span>
          <button className="home-refresh" onClick={refresh} disabled={loading} aria-label={loading ? 'Updating forecast' : 'Refresh forecast'}><WeatherIcon name="refresh" /><span>{loading ? 'Updating' : 'Refresh'}</span></button>
        </div>
      </header> : <header className="app-header">
        <h1>{LOCATION.name} Weather Trends</h1>
        <div className="header-meta">
          {lastUpdated && <span className="data-age">Data: {timeAgo(lastUpdated)}</span>}
          <button className="refresh-btn" onClick={refresh} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </header>}

      <LoadingBar progress={progress} />

      {error && <div className="error-banner">{error}</div>}

      <Nav active={view} onNavigate={setView} />
      <InstallApp />

      <main className="app-main">
        {view === 'forecast' && <Forecast runs={runs} loading={loading} hasError={!!error} lastUpdated={lastUpdated} />}
        {view === 'summary' && <Summary runs={runs} />}
        {view === 'trends' && <Trends runs={runs} />}
        {view === 'models' && <Models runs={runs} />}
        {view === 'ensembles' && <Ensembles ensembles={ensembles} />}
        {view === 'teleconnections' && <Teleconnections />}
        {view === 'about' && <About runs={runs} ensembles={ensembles} lastUpdated={lastUpdated} />}
      </main>

      <footer className="app-footer">
        {view === 'forecast' && <span className="footer-local"><WeatherIcon name="pin" />Made for a little corner of Cambridgeshire.</span>}
        <span>
          Data from{' '}
          <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
            Open-Meteo
          </a>
        </span>
      </footer>
    </div>
  );
}

export default App;
