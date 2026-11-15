import React from 'react';
import { useMars } from '../context/MarsContext.jsx';

const TABS = [
  { id: 'mission', label: 'MISSION' },
  { id: 'map', label: 'MAP' },
  { id: 'science', label: 'SCIENCE' },
  { id: 'route', label: 'ROUTE' },
  { id: 'safety', label: 'SAFETY' },
  { id: 'sim', label: 'SIMULATION' },
  { id: 'log', label: 'MISSION LOG' }
];

export const Navbar = () => {
  const { mode, panel, setPanel, selTarget, closeTarget } = useMars();

  if (mode === 'boot' || mode === 'landing') return null;

  const handleTabClick = (tabId) => {
    if (selTarget && tabId !== 'science') {
      closeTarget();
    }
    setPanel(tabId);
  };

  return (
    <nav id="nav" className="glass">
      <div className="brand">
        MARS<span>-</span>X
      </div>
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`nb ${panel === t.id ? 'active' : ''}`}
          onClick={() => handleTabClick(t.id)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
};
