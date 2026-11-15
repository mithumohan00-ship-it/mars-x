import React, { useEffect } from 'react';
import { useMars } from '../context/MarsContext.jsx';

export const TerrainProbe = () => {
  const { probeData, setProbeData } = useMars();

  useEffect(() => {
    if (!probeData) return;
    const timer = setTimeout(() => {
      setProbeData(null);
    }, 4500);
    return () => clearTimeout(timer);
  }, [probeData, setProbeData]);

  return (
    <>
      {probeData && (
        <div
          id="probe"
          className="glass"
          style={{
            display: 'block',
            position: 'fixed',
            bottom: '90px',
            left: '320px',
            zIndex: 35
          }}
        >
          <div className="ph" style={{ padding: '7px 11px' }}>
            Terrain Probe <span className="tag">SIM</span>
          </div>
          <div className="bd" id="prB">
            <div className="kv">
              <span>Lat/Lon</span>
              <b>{probeData.lat} {probeData.lon}</b>
              <span>Elevation</span>
              <b>{probeData.elev} m</b>
              <span>Slope</span>
              <b>{probeData.slope}°</b>
              <span>Unit</span>
              <b style={{ maxWidth: '130px', whiteSpace: 'normal' }}>
                {probeData.unit}
              </b>
              <span>Spectral idx</span>
              <b>{probeData.spectral}</b>
              <span>Ground temp</span>
              <b>{probeData.temp} °C</b>
              <span>Dose (model)</span>
              <b>{probeData.rad} mSv/d</b>
              <span>Hazard</span>
              <b>{probeData.hazard}</b>
            </div>
          </div>
        </div>
      )}
      <div id="cursorll" />
    </>
  );
};
