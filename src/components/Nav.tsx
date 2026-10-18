interface NavProps {
  active: string;
  onNavigate: (view: string) => void;
}

const tabs = [
  { id: 'summary', label: 'Summary' },
  { id: 'trends', label: 'Trends' },
  { id: 'models', label: 'Models' },
  { id: 'ensembles', label: 'Ensembles' },
  { id: 'about', label: 'About' },
];

export function Nav({ active, onNavigate }: NavProps) {
  return (
    <nav className="nav">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`nav-tab ${active === tab.id ? 'active' : ''}`}
          onClick={() => onNavigate(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
