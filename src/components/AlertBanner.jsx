import React from 'react';
import { useMars } from '../context/MarsContext.jsx';

export const AlertBanner = () => {
  const { hazardAlert, setHazardAlert } = useMars();

  if (!hazardAlert) return null;

  return (
    <div id="alert" className="glass" style={{ display: 'block' }}>
      <div className="ph">
        ⚠ Terrain Hazard
        <button className="x" id="alClose" onClick={() => setHazardAlert(null)}>
          ✕
        </button>
      </div>
      <div className="bd" id="alB">
        <b>{hazardAlert.title}</b>
        <br />
        {hazardAlert.hazardName}
        <br />
        <br />
        RECOMMENDED
        <br />
        <b>{hazardAlert.recommended}</b>
        <br />
        <br />
        SAFETY IMPACT
        <br />
        <b style={{ color: 'var(--green)', fontSize: '16px' }}>
          {hazardAlert.safetyImpact}
        </b>
      </div>
    </div>
  );
};
