import { useState } from 'react';
import { Nav } from './components/Nav';
import { LoadingBar } from './components/LoadingBar';
import { Summary } from './views/Summary';
import { Trends } from './views/Trends';
import { Models } from './views/Models';
import { Ensembles } from './views/Ensembles';
import { About } from './views/About';
import { useWeatherData } from './hooks/useWeatherData';
import { timeAgo } from './hooks/useLocalTime';
import { LOCATION } from './config/models';

function App() {
  const [view, setView] = useState('summary');
  const { runs, ensembles, loading, progress, lastUpdated, error, refresh } = useWeatherData();

  return (
    <div className="app">
      <header className="app-header">
        <h1>{LOCATION.name} Weather Trends</h1>
        <div className="header-meta">
          {lastUpdated && <span className="data-age">Data: {timeAgo(lastUpdated)}</span>}
          <button className="refresh-btn" onClick={refresh} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </header>

      <LoadingBar progress={progress} />

      {error && <div className="error-banner">{error}</div>}

      <Nav active={view} onNavigate={setView} />

      <main className="app-main">
        {view === 'summary' && <Summary runs={runs} />}
        {view === 'trends' && <Trends runs={runs} />}
        {view === 'models' && <Models runs={runs} />}
        {view === 'ensembles' && <Ensembles ensembles={ensembles} />}
        {view === 'about' && <About runs={runs} ensembles={ensembles} lastUpdated={lastUpdated} />}
      </main>

      <footer className="app-footer">
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
