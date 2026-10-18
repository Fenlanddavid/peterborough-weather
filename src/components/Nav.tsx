interface NavProps {
  active: string;
  onNavigate: (view: string) => void;
}

const primaryTab = { id: 'forecast', label: 'Forecast' };

const technicalTabs = [
  { id: 'summary', label: 'Summary' },
  { id: 'trends', label: 'Trends' },
  { id: 'models', label: 'Models' },
  { id: 'ensembles', label: 'Ensembles' },
  { id: 'teleconnections', label: 'Drivers' },
];

export function Nav({ active, onNavigate }: NavProps) {
  return (
    <nav className="nav" aria-label="Main navigation">
      <button
        className={`nav-tab nav-tab-primary ${active === primaryTab.id ? 'active' : ''}`}
        aria-current={active === primaryTab.id ? 'page' : undefined}
        onClick={() => onNavigate(primaryTab.id)}
      >
        {primaryTab.label}
      </button>

      <span className="nav-separator" />

      {technicalTabs.map((tab) => (
        <button
          key={tab.id}
          className={`nav-tab nav-tab-secondary ${active === tab.id ? 'active' : ''}`}
          aria-current={active === tab.id ? 'page' : undefined}
          onClick={() => onNavigate(tab.id)}
        >
          {tab.label}
        </button>
      ))}

      <span className="nav-separator" />

      <button
        className={`nav-tab nav-tab-secondary ${active === 'about' ? 'active' : ''}`}
        aria-current={active === 'about' ? 'page' : undefined}
        onClick={() => onNavigate('about')}
      >
        About
      </button>
    </nav>
  );
}
