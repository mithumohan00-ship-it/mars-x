import React from 'react';
import { useMars } from '../context/MarsContext.jsx';
import { DataNormalizer, GEO_UNITS, MPU } from '../engine/dataProvider.js';
import { fmtClock } from '../engine/math.js';

export const TargetModal = () => {
  const {
    selTarget,
    closeTarget,
    storeRef,
    envRef,
    recRoute,
    cons,
    included,
    toggleTargetIncluded,
    setRoverModalTarget,
    setAiOpen,
    askAI,
    activeRegionId
  } = useMars();

  if (!selTarget) return null;

  const targetId = typeof selTarget === 'object' ? selTarget.id : selTarget;
  const store = storeRef.current;
  const t = typeof selTarget === 'object' && (selTarget.x !== undefined || selTarget.e !== undefined)
    ? selTarget
    : store?.targets?.find((x) => x.id === targetId) || store?.targets?.[0];
  if (!t) return null;

  const env = envRef.current || { sol: 412, lmstStart: 360 };
  const region = activeRegionId || store?.regionId || 'gale-msharp-nw';
  const rawX = t.x !== undefined ? t.x : (t.e !== undefined ? t.e / MPU : 0);
  const rawZ = t.z !== undefined ? t.z : (t.n !== undefined ? t.n / MPU : 0);
  const tx = isNaN(rawX) ? 0 : rawX;
  const tz = isNaN(rawZ) ? 0 : rawZ;

  const ll = DataNormalizer.localToLatLon(tx * MPU, tz * MPU, region);
  const rawEl = store?.eM ? store.eM(tx, tz) : 0;
  const el = isNaN(rawEl) ? 0 : Math.round(rawEl);
  const rawSl = store?.slope ? store.slope(tx, tz) : 0;
  const sl = isNaN(rawSl) ? 0 : rawSl;
  const uIdx = store?.unit ? store.unit(tx, tz) : 0;
  const unit = (store?.geoTable && store.geoTable[uIdx]?.name) || GEO_UNITS[uIdx]?.name || 'Regolith';
  const rawMin = store?.mineral ? store.mineral(tx, tz) : 0.45;
  const specStr = isNaN(rawMin) ? '0.45' : rawMin.toFixed(2);
  const rawTemp = store?.temp ? store.temp(tx, tz) : -24.0;
  const tempStr = isNaN(rawTemp) ? '-24.0' : rawTemp.toFixed(1);
  const nh = store?.nearestHazard
    ? store.nearestHazard(tx, tz, [...(store.hazards || []), ...(cons?.extraZones || [])])
    : { d: 999, z: { name: 'CLEAR', level: 0 } };
  const hazDist = isNaN(nh.d) ? 0 : Math.max(0, Math.round(nh.d * MPU));

  // Leg info if in recommended route
  let lt = null;
  if (recRoute && recRoute.waypoints) {
    const wi = recRoute.waypoints.findIndex(
      (w) => w.target === t.id || w.target?.id === t.id || w.short === t.code
    );
    if (wi >= 0) {
      const w = recRoute.waypoints[wi];
      const prev = recRoute.waypoints[wi - 1];
      lt = { leg: w.dwell ? 12 : 24, arrive: w.t, from: prev };
    }
  }

  const isGone = cons.removed.has(t.id);
  const isIncluded = included.has(t.id);

  const handleRoverClick = () => {
    setRoverModalTarget(t);
  };

  const handleAskAI = () => {
    setAiOpen(true);
    askAI(`Is ${(t.code || 'Target').replace('TARGET ', 'Target ')} safe?`);
  };

  return (
    <div id="tinfo" className="glass" style={{ transform: 'none', right: 16 }}>
      <div className="ph">
        Science Target <button className="x" id="tClose" onClick={closeTarget}>✕</button>
      </div>

      <div id="tBody">
        <div className="hero">
          <div className="code">{t.code} · {t.id}</div>
          <div className="name">{t.name}</div>
          <div style={{ marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span className="stars">
              {'★'.repeat(t.stars || 4)}{'☆'.repeat(5 - (t.stars || 4))}
            </span>
            <span
              className="pill"
              style={{ color: t.priority === 'VERY HIGH' ? '#ff7a4a' : '#ffad3b' }}
            >
              PRIORITY {t.priority || 'HIGH'}
            </span>
          </div>
        </div>

        <div className="bd">
          <div className="sec">
            <h4>Mission Objective</h4>
            <p>{t.objective || 'Investigate geological contact and collect spectral data.'}</p>
          </div>

          <div className="sec">
            <h4>Site Data</h4>
            <div className="kv">
              <span>Position</span>
              <b>
                {isNaN(ll.lat) ? '5.4000°S' : `${Math.abs(ll.lat).toFixed(4)}°${ll.lat < 0 ? 'S' : 'N'}`}{' '}
                {isNaN(ll.lon) ? '137.8000°E' : `${Math.abs(ll.lon).toFixed(4)}°${ll.lon < 0 ? 'W' : 'E'}`}
              </b>
              <span>Elevation</span>
              <b>{el} m</b>
              <span>Local slope</span>
              <b>{sl.toFixed(1)}°</b>
              <span>Geologic unit</span>
              <b>{unit}</b>
              <span>Spectral index</span>
              <b>{specStr}</b>
              <span>Ground temp</span>
              <b>{tempStr} °C</b>
              <span>Nearest hazard</span>
              <b>{nh.z?.name || 'CLEAR'} · {hazDist} m</b>
              {lt && (
                <>
                  <span>Walk from {lt.from?.short || 'HAB'}</span>
                  <b>{Math.round(lt.leg)} min</b>
                  <span>Arrival</span>
                  <b>{fmtClock(env.lmstStart + lt.arrive)} LMST</b>
                </>
              )}
            </div>
          </div>

          <div className="sec">
            <h4>Planned Observations</h4>
            <p className="mono" style={{ fontSize: '11px' }}>
              {t.instr && t.instr.map((s, idx) => (
                <React.Fragment key={idx}>
                  ▸ {s}
                  <br />
                </React.Fragment>
              ))}
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {isGone ? (
              <span className="pill c-crit">UNAVAILABLE · SIM EVENT</span>
            ) : (
              <button
                className={`btn sm ${isIncluded ? 'on' : ''}`}
                id="tInc"
                onClick={() => toggleTargetIncluded(t.id)}
              >
                {isIncluded ? '✓ IN ROUTE' : '+ ADD TO ROUTE'}
              </button>
            )}
            <button className="btn sm" id="tImg" onClick={handleRoverClick}>
              ROVER IMAGERY
            </button>
            <a
              href="https://mars.nasa.gov/mars2020/multimedia/raw-images/"
              target="_blank"
              rel="noopener noreferrer"
              className="btn sm"
              style={{ textDecoration: 'none', color: 'var(--cyan)' }}
            >
              NASA RAW ↗
            </a>
            <button className="btn sm" id="tAsk" onClick={handleAskAI}>
              ASK AI
            </button>
          </div>

          <div style={{ marginTop: '12px', display: 'flex', gap: '8px', fontSize: '9px' }}>
            <a
              href="https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--dim)', textDecoration: 'underline' }}
            >
              USGS Astrogeology GIS Maps ↗
            </a>
            <span style={{ color: 'var(--line2)' }}>·</span>
            <a
              href="https://mars.nasa.gov/mars2020/multimedia/raw-images/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--dim)', textDecoration: 'underline' }}
            >
              NASA Mars 2020 Raw Feed ↗
            </a>
          </div>

          <p className="mono" style={{ fontSize: '9px', color: 'var(--dim)', marginTop: '6px' }}>
            SIMULATION DATA · target is an analogue placed on the modelled terrain
          </p>
        </div>
      </div>
    </div>
  );
};
