import React from 'react';
import { useMars } from '../context/MarsContext.jsx';

export const ScanOverlay = () => {
  const { scanActive, scanText } = useMars();

  if (!scanActive) return null;

  return (
    <div id="scanov" style={{ display: 'block', opacity: 1 }}>
      <div className="t">{scanText}</div>
    </div>
  );
};
