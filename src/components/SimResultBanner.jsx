import React from 'react';
import { useMars } from '../context/MarsContext.jsx';

export const SimResultBanner = () => {
  const { lastSim, setLastSim } = useMars();

  if (!lastSim) return null;

  const sg = (v, d = 0) => (v >= 0 ? '+' : '−') + Math.abs(+v).toFixed(d);

  return (
    <div id="simres" className="glass" style={{ display: 'block' }}>
      <div className="ph">
        Mission Simulation
        <button className="x" id="srClose" onClick={() => setLastSim(null)}>
          ✕
        </button>
      </div>
      <div className="bd" id="srB">
        {lastSim.title ? (
          <>
            <div className="big c-crit">{lastSim.title}</div>
            <div style={{ color: 'var(--amber)', margin: '6px 0' }}>{lastSim.status}</div>
            <div style={{ color: 'var(--dim)', fontSize: '11px' }}>{lastSim.desc}</div>
          </>
        ) : (
          <>
            <div className="big c-crit" style={{ fontSize: '12px' }}>
              ORIGINAL ROUTE {lastSim.prev?.id} ❌{' '}
              {lastSim.ev?.id === 'blocked' ? 'BLOCKED' : 'INVALIDATED'}
            </div>
            <div className="big" style={{ color: 'var(--green)' }}>
              ALTERNATIVE ROUTE FOUND · {lastSim.r?.id}
            </div>
            <div className="kv" style={{ fontSize: '11px' }}>
              <span>Additional distance</span>
              <b>{sg(lastSim.dd, 1)} km</b>
              <span>Additional EVA</span>
              <b>{sg(Math.round(lastSim.de))} min</b>
              <span>Safety</span>
              <b style={{ color: lastSim.ds >= 0 ? 'var(--green)' : 'var(--amber)' }}>
                {sg(lastSim.ds)}%
              </b>
              <span>Science loss</span>
              <b style={{ color: lastSim.dsc < 0 ? 'var(--amber)' : 'var(--green)' }}>
                {sg(lastSim.dsc)}%
              </b>
              <span>Risk</span>
              <b style={{ color: lastSim.r?.risk?.col || 'inherit' }}>
                {lastSim.r?.risk?.t}
              </b>
            </div>
            <div style={{ marginTop: '10px' }}>
              STATUS:{' '}
              <b style={{ color: 'var(--green)' }}>
                {lastSim.status}
              </b>
            </div>
            {lastSim.note && (
              <div style={{ color: 'var(--dim)', marginTop: '4px' }}>
                {lastSim.note}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
