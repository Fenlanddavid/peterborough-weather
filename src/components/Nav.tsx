import { useEffect, useRef } from 'react';

interface NavProps {
  active: string;
  onNavigate: (view: string) => void;
}

const primaryTab = { id: 'forecast', label: 'Forecast' };

const technicalTabs = [
  { id: 'summary', label: 'Summary' },
  { id: 'nightsky', label: 'Night Sky' },
  { id: 'trends', label: 'Trends' },
  { id: 'models', label: 'Models' },
  { id: 'ensembles', label: 'Ensembles' },
  { id: 'teleconnections', label: 'Drivers' },
];

export function Nav({ active, onNavigate }: NavProps) {
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const selected = nav.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (selected && nav.current) {
      const bounds = nav.current.getBoundingClientRect();
      const tab = selected.getBoundingClientRect();
      if (tab.left < bounds.left || tab.right > bounds.right) {
        nav.current.scrollLeft += tab.left < bounds.left ? tab.left - bounds.left : tab.right - bounds.right;
      }
    }
  }, [active]);
  return (
    <nav className="nav" aria-label="Main navigation" ref={nav}>
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
