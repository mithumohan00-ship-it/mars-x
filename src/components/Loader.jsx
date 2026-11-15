import React from 'react';
import { useMars } from '../context/MarsContext.jsx';

export const Loader = () => {
  const { mode, bootProgress, bootReady, bootRows } = useMars();

  if (mode !== 'boot') return null;

  return (
    <div id="loader">
      <div className="ring" />
      <div className="ring r2" />
      <div className="logo">MARS-X</div>
      <div className="sub">HUMAN SURFACE EXPLORATION SYSTEM</div>
      <div className="rows" id="lrows">
        {bootRows.map((r, i) => (
          <div
            key={i}
            className={`row ${r.status !== 'pending' ? 'show' : ''} ${r.status === 'done' ? 'done' : ''}`}
          >
            <span>{r.name}</span>
            <span className="ck">{r.status === 'done' ? '✓' : '…'}</span>
          </div>
        ))}
      </div>
      <div className="bar">
        <i id="lbar" style={{ width: `${bootProgress}%` }} />
      </div>
      <div className="ready" id="lready" style={{ opacity: bootReady ? 1 : 0 }}>
        SYSTEM READY
      </div>
    </div>
  );
};
