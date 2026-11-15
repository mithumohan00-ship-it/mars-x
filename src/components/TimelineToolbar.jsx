import React from 'react';
import { useMars } from '../context/MarsContext.jsx';

export const TimelineToolbar = () => {
  const {
    mode,
    surfaceActive,
    enterSurface,
    exitSurface,
    hudActive,
    toggleHUD,
    returnToOrbit,
    planEVA,
    evaActive,
    startEVA,
    stopEVA
  } = useMars();

  if (mode !== 'terrain') return null;

  const handleMarswalkToggle = () => {
    if (evaActive) {
      stopEVA();
    } else {
      startEVA({ dur: 52, follow: true });
    }
  };

  const handleSurfaceToggle = () => {
    if (surfaceActive) {
      exitSurface();
    } else {
      enterSurface();
    }
  };

  return (
    <div id="toolbar">
      <button
        className={`btn primary mag ${evaActive ? 'on' : ''}`}
        id="walkBtn"
        onClick={handleMarswalkToggle}
        style={evaActive ? {
          background: 'rgba(255, 60, 60, 0.28)',
          borderColor: '#ff4a4a',
          color: '#ff8a8a',
          boxShadow: '0 0 16px rgba(255, 74, 74, 0.5)'
        } : {}}
      >
        {evaActive ? '⏹ Stop Marswalk (Recording)' : '▶ Start Marswalk'}
      </button>
      <button className="btn" id="planBtn" onClick={() => planEVA()}>
        ⬡ Plan Safe Route
      </button>
      <button
        className={`btn ${surfaceActive ? 'on' : ''}`}
        id="surfBtn"
        onClick={handleSurfaceToggle}
      >
        {surfaceActive ? '⇡ Exit Surface Mode' : '⇣ Enter Surface Mode'}
      </button>
      <button
        className={`btn ${hudActive ? 'on' : ''}`}
        id="hudBtn"
        onClick={() => toggleHUD()}
      >
        {hudActive ? '◑ Deactivate HUD' : '◐ Activate HUD'}
      </button>
      <button className="btn sm" id="orbitBtn" onClick={returnToOrbit}>
        ⇡ Orbit
      </button>
    </div>
  );
};
