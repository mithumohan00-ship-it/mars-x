import React from 'react';
import { useMars } from '../context/MarsContext.jsx';

export const SysBar = () => {
  const {
    mode,
    clockInfo,
    tabletMode,
    toggleTablet,
    fxHigh,
    toggleFX,
    runDemo,
    activeRegionId,
    REGIONS_CONFIG
  } = useMars();

  if (mode === 'boot' || mode === 'landing') return null;

  const reg = (REGIONS_CONFIG && REGIONS_CONFIG[activeRegionId]) || {
    name: 'Gale Crater',
    sector: 'Mount Sharp NW'
  };

  return (
    <div id="sysbar">
      <div className="glass loc" id="locbox">
        {mode === 'terrain' ? (
          <>
            {reg.name.toUpperCase()} · <b>{reg.sector.split('·')[0].trim().toUpperCase()}</b>
          </>
        ) : (
          <>
            ORBIT · <b>MARS GLOBAL</b>
          </>
        )}
      </div>

      <div className="clock glass" id="clock">
        SOL <b>{String(clockInfo.sol).padStart(4, '0')}</b> · SIM
        <br />
        LMST <b>{clockInfo.lmst}</b>
      </div>

      <span className="sim-badge">
        <i />
        SIMULATION DATA
      </span>

      <button
        className={`btn sm ${tabletMode ? 'on' : ''}`}
        id="bTablet"
        title="Rugged-tablet layout"
        onClick={toggleTablet}
      >
        TABLET
      </button>

      <button
        className="btn sm"
        id="bFx"
        title="Reduced animation / effects for weaker hardware"
        onClick={toggleFX}
      >
        FX: {fxHigh ? 'HIGH' : 'REDUCED'}
      </button>

      <button className="btn sm amber" id="bDemo2" onClick={runDemo}>
        DEMO
      </button>
    </div>
  );
};
