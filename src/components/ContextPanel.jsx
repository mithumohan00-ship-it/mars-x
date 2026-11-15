import React from 'react';
import * as THREE from 'three';
import { useMars } from '../context/MarsContext.jsx';
import { AERIAL } from '../engine/threeEngine.js';
import { LEVEL, LEVELC, MPU } from '../engine/dataProvider.js';
import { fmtClock, fmtHM } from '../engine/math.js';

const PANELS = {
  mission: 'MISSION',
  map: 'MAP',
  science: 'SCIENCE',
  route: 'ROUTE',
  safety: 'SAFETY',
  sim: 'SIMULATION',
  log: 'MISSION LOG'
};

const EVENTS = [
  { id: 'weather', t: '⚠ Weather Change', d: 'Dust storm front approaching from NE' },
  { id: 'unavailable', t: '⚠ Target Unavailable', d: 'Unstable scree slope blocks Target 02' },
  { id: 'blocked', t: '⚠ Route Blocked', d: 'Active rockfall blocks nominal canyon traverse' },
  { id: 'slope', t: '⚠ High Terrain Risk', d: 'Slope threshold reduced to 18°' },
  { id: 'comm', t: '⚠ Communication Loss', d: 'Rover repeater offline beyond 1.2 km of HAB-1' }
];

function explainRoute(routes, rec, store) {
  if (!rec) return 'No candidate meets the safety threshold. Route should not proceed.';
  const L = [
    `Route ${rec.id} provides the best balance between terrain safety (${rec.safety}%), route distance (${(rec.distM / 1000).toFixed(1)} km) and scientific return (${rec.science}/100).`
  ];
  for (const r of routes) {
    if (r === rec) continue;
    if (r.riskScore >= 48) {
      const z = r.entered ? r.entered[0] : null;
      L.push(
        `Route ${r.id} rejected — ${r.risk.t} risk${z ? ` (enters ${z.name})` : ''}. Safety outranks its ${r.science}/100 science value.`
      );
    } else if (r.science < rec.science) {
      const miss = (store.targets || [])
        .filter((t) => rec.order.includes(t.id) && !r.order.includes(t.id))
        .map((t) => t.code);
      L.push(
        `Route ${r.id} is ${r.safety > rec.safety ? `safer (+${r.safety - rec.safety}%) but` : ''} returns less science (${r.science}/100${miss.length ? `, omits ${miss.join(', ')}` : ''}).`
      );
    } else {
      L.push(
        `Route ${r.id} scores lower overall (${Math.round(r.score || 0)} vs ${Math.round(rec.score || 0)}).`
      );
    }
  }
  return L.join('\n');
}

export const ContextPanel = () => {
  const {
    panel,
    mode,
    storeRef,
    providerRef,
    nasaRef,
    envRef,
    routes,
    recRoute,
    cons,
    lastSim,
    included,
    selTarget,
    selectTarget,
    planEVA,
    resetSim,
    triggerEvent,
    selectedRegionId,
    selectRegion,
    descendToRegion,
    activeRegionId,
    REGIONS_CONFIG,
    flyToGale,
    returnToOrbit,
    toggleLayer,
    layers,
    logs,
    engineRef,
    evaActive,
    startEVA,
    stopEVA,
    stats
  } = useMars();

  if (mode === 'boot' || mode === 'landing') return null;

  const inT = mode === 'terrain';
  const store = storeRef.current;
  const provider = providerRef.current;
  const nasa = nasaRef.current;
  const env = envRef.current || {
    sol: 412,
    pressureHpa: 7.2,
    airTempC: -48,
    groundTempC: -22,
    windMs: 6.2,
    windDir: 'ENE',
    dustTau: 0.65,
    radiation: 0.68,
    sunrise: '05:42',
    sunset: '18:14',
    lmstStart: 360
  };

  const zones = [...(store.hazards || []), ...(cons.extraZones || [])];

  const activeReg = (REGIONS_CONFIG && REGIONS_CONFIG[activeRegionId]) || (REGIONS_CONFIG && REGIONS_CONFIG['gale-msharp-nw']) || {
    name: 'Gale Crater · Mount Sharp',
    sector: 'NW approach · 5 × 5 km',
    lat: -5.4,
    lon: 137.8
  };
  const selectedReg = (REGIONS_CONFIG && REGIONS_CONFIG[selectedRegionId]) || activeReg;

  const handleRouteHover = (rId, enter) => {
    if (engineRef.current && engineRef.current.terrainObjects?.routeVis) {
      const v = engineRef.current.terrainObjects.routeVis[rId];
      if (v && v.r !== recRoute) {
        v.mat.uniforms.uOpacity.value = enter ? 1.0 : 0.4;
      }
    }
  };

  const handleWaypointClick = (w) => {
    if (engineRef.current && inT) {
      engineRef.current.flyToPoint(w.x, w.z, 16);
    }
  };

  const handleHazardClick = (z) => {
    if (engineRef.current && inT) {
      if (!layers.hazards) toggleLayer('hazards');
      engineRef.current.flyToPoint(z.x, z.z, 26);
    }
  };

  const handleCam = (type) => {
    if (!engineRef.current || !inT) return;
    const engine = engineRef.current;
    if (type === 'aerial') {
      engine.camTo(AERIAL.pos, AERIAL.tgt, 2);
    } else if (type === 'top') {
      engine.camTo(new THREE.Vector3(0, 150, 0.1), new THREE.Vector3(0, 0, 0), 2);
    } else if (type === 'sharp') {
      const sharpY = engine.store.hU(32, -32) + 4;
      engine.camTo(new THREE.Vector3(-5, 40, 10), new THREE.Vector3(32, sharpY, -32), 2.2);
    } else if (type === 'hab') {
      engine.flyToPoint(store.hab.x, store.hab.z, 14);
    }
  };

  const renderNeedTerrain = () => (
    <>
      <div className="sec">
        <p>This view needs the surface terrain model. Descend to the mission region first.</p>
      </div>
      <button className="btn primary" onClick={() => descendToRegion(selectedRegionId)}>
        ⇣ Engage {selectedReg.name.toUpperCase()} descent
      </button>
    </>
  );

  return (
    <div id="ctx" className="glass">
      <div className="ph">
        <span id="ctxT">{PANELS[panel]}</span>
        <span className="tag" id="ctxTag">
          {inT ? 'SIMULATION DATA' : 'ORBIT'}
        </span>
      </div>

      <div className="body" id="ctxB">
        {panel === 'mission' && (
          <>
            <div className="sec">
              <h4>Objective</h4>
              <p>Investigate planetary geology, surface hazards and science targets in {activeReg.name}.</p>
            </div>
            <div className="sec">
              <h4>Region</h4>
              <div className="kv">
                <span>Site</span>
                <b>{activeReg.name}</b>
                <span>Sector</span>
                <b>{activeReg.sector}</b>
                <span>Centre</span>
                <b>{Math.abs(activeReg.lat).toFixed(2)}°{activeReg.lat < 0 ? 'S' : 'N'} {Math.abs(activeReg.lon).toFixed(2)}°{activeReg.lon < 0 ? 'W' : 'E'}</b>
                <span>Elevation range</span>
                <b>
                  {store.minM
                    ? `${Math.round(store.minM)} → ${Math.round(store.maxM)} m`
                    : '—'}
                </b>
                <span>Vertical exaggeration</span>
                <b>×1.75</b>
              </div>
            </div>
            <div className="sec">
              <h4>Environment · Sol {env.sol}</h4>
              <div className="kv">
                <span>Pressure</span>
                <b>{env.pressureHpa} hPa</b>
                <span>Air / ground temp</span>
                <b>
                  {env.airTempC} / {env.groundTempC} °C
                </b>
                <span>Wind</span>
                <b>
                  {env.windMs} m/s {env.windDir}
                </b>
                <span>Dust opacity τ</span>
                <b>{env.dustTau}</b>
                <span>Surface dose (model)</span>
                <b>{env.radiation} mSv/day</b>
                <span>Sunrise / sunset</span>
                <b>
                  {env.sunrise} / {env.sunset} LMST
                </b>
              </div>
              <p className="mono" style={{ fontSize: '9px', color: 'var(--amber)', marginTop: '6px' }}>
                SIMULATION DATA — not NASA measurements
              </p>
            </div>
            <div className="sec">
              <h4>Decision Rule</h4>
              <p style={{ font: '600 13px var(--fh)', letterSpacing: '.16em', color: '#fff' }}>
                SAFETY → SCIENCE → EFFICIENCY
              </p>
              <p style={{ fontSize: '12px', marginTop: '4px' }}>
                Routes above MODERATE risk are never recommended, whatever their science value. Every recommendation states why.
              </p>
            </div>
            <div className="sec">
              <h4>Data Architecture</h4>
              <div className="pipeline">
                <div className="n">NASA DATA</div>
                <div className="a">↓</div>
                <div className="n">DATA NORMALIZATION</div>
                <div className="a">↓</div>
                <div className="n">GEOSPATIAL STORE</div>
                <div className="a">↓</div>
                <div className="n">MAP ENGINE</div>
                <div className="a">↓</div>
                <div className="n">ANALYTICS / ROUTE ENGINE</div>
                <div className="a">↓</div>
                <div className="n">3D VISUALIZATION</div>
              </div>
            </div>
            <div className="sec">
              <h4>Providers</h4>
              <div className="prov">
                <span>{provider.name}</span>
                <b style={{ color: 'var(--amber)' }}>{provider.status}</b>
              </div>
              <div className="prov">
                <span>{nasa.name}</span>
                <b style={{ color: 'var(--dim)' }}>{nasa.status}</b>
              </div>
              {nasa.cfg &&
                Object.entries(nasa.cfg).map(([k, v]) => (
                  <div key={k} className="prov" style={{ color: 'var(--dim)' }}>
                    <span>{k}</span>
                    <b style={{ maxWidth: '210px', textAlign: 'right' }}>{v}</b>
                  </div>
                ))}
            </div>

            <div className="sec">
              <h4>Planetary Data Sources</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <a
                  href="https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="card"
                  style={{ textDecoration: 'none', padding: '10px 12px', display: 'block' }}
                >
                  <div className="t" style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--cyan)' }}>
                    <span>USGS ASTROGEOLOGY MARS MAPS</span>
                    <span>↗</span>
                  </div>
                  <div className="s" style={{ marginTop: '4px', fontSize: '11px', color: '#b9cbdc' }}>
                    Interactive Mars GIS · MOLA Elevation DTM · USGS Global Geologic Maps · CTX mosaics
                  </div>
                </a>

                <a
                  href="https://mars.nasa.gov/mars2020/multimedia/raw-images/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="card"
                  style={{ textDecoration: 'none', padding: '10px 12px', display: 'block' }}
                >
                  <div className="t" style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--amber)' }}>
                    <span>NASA MARS 2020 RAW IMAGERY</span>
                    <span>↗</span>
                  </div>
                  <div className="s" style={{ marginTop: '4px', fontSize: '11px', color: '#b9cbdc' }}>
                    Perseverance & Curiosity Raw Imagery Archive · Mastcam-Z · SuperCam RMI science feeds
                  </div>
                </a>
              </div>
            </div>
          </>
        )}

        {panel === 'map' && (
          <>
            <div className="sec">
              <h4>Exploration Regions</h4>
              {Object.values(REGIONS_CONFIG || {}).map((r) => {
                const isSelected = (inT ? activeRegionId : selectedRegionId) === r.id;
                return (
                  <div
                    key={r.id}
                    className={`card ${isSelected ? 'sel' : ''}`}
                    data-site={r.id}
                    onClick={() => {
                      if (!inT) {
                        selectRegion(r.id);
                      } else {
                        descendToRegion(r.id);
                      }
                    }}
                  >
                    <div className="t">
                      {r.name.toUpperCase()}
                      <span
                        className="pill"
                        style={{ color: 'var(--green)' }}
                      >
                        {inT && activeRegionId === r.id ? 'ACTIVE' : 'READY'}
                      </span>
                    </div>
                    <div className="s">
                      {Math.abs(r.lat).toFixed(1)}°{r.lat < 0 ? 'S' : 'N'}{' '}
                      {Math.abs(r.lon).toFixed(1)}°{r.lon < 0 ? 'W' : 'E'} ·{' '}
                      {r.scienceTargets.length} targets · {r.hazards.length} hazards
                    </div>
                  </div>
                );
              })}
            </div>

            {inT ? (
              <>
                <div className="sec">
                  <h4>Camera</h4>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <button className="btn sm" onClick={() => handleCam('aerial')}>
                      AERIAL
                    </button>
                    <button className="btn sm" onClick={() => handleCam('top')}>
                      TOP-DOWN
                    </button>
                    <button className="btn sm" onClick={() => handleCam('sharp')}>
                      REGION PEAK
                    </button>
                    <button className="btn sm" onClick={() => handleCam('hab')}>
                      HABITAT
                    </button>
                  </div>
                </div>
                <button className="btn" id="pOrbit" onClick={returnToOrbit}>
                  ⇡ Return to orbit
                </button>
              </>
            ) : (
              <>
                <div className="sec">
                  <h4>Orbital Controls</h4>
                  <p style={{ fontSize: '12px' }}>
                    Drag to rotate · scroll to zoom · right-drag to pan · click a marker to select.
                  </p>
                </div>
                <button
                  className="btn primary"
                  id="pDesc"
                  onClick={() => descendToRegion(selectedRegionId)}
                >
                  ⇣ Engage {selectedReg.name.toUpperCase()} descent
                </button>
              </>
            )}
          </>
        )}

        {!inT && panel !== 'mission' && panel !== 'map' && panel !== 'log' && panel !== 'sim' && renderNeedTerrain()}

        {inT && panel === 'science' && (
          <>
            <div className="sec">
              <h4>Science Targets · {activeReg.name}</h4>
              {store.targets.map((t) => {
                const gone = cons.removed.has(t.id);
                const inc = included.has(t.id);
                return (
                  <div
                    key={t.id}
                    className={`card ${(typeof selTarget === 'object' ? selTarget?.id : selTarget) === t.id ? 'sel' : ''} ${gone ? 'bad' : ''}`}
                    data-t={t.id}
                    onClick={() => selectTarget(t.id)}
                  >
                    <div className="t">
                      {t.code}
                      <span className="stars">
                        {'★'.repeat(t.stars)}
                        {'☆'.repeat(5 - t.stars)}
                      </span>
                    </div>
                    <div style={{ font: '600 13px var(--fh)', marginTop: '3px' }}>
                      {t.name}
                    </div>
                    <div className="s">
                      {t.objective}
                      <br />
                      PRIORITY {t.priority} ·{' '}
                      {gone ? (
                        <span className="c-crit">UNAVAILABLE</span>
                      ) : inc ? (
                        'IN ROUTE PLAN'
                      ) : (
                        'EXCLUDED'
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mono" style={{ fontSize: '9px', color: 'var(--dim)' }}>
              Targets are simulation analogues. Toggle inclusion from each target's panel.
            </p>
          </>
        )}

        {inT && panel === 'route' && (
          <>
            {!routes ? (
              <>
                <div className="sec">
                  <p>
                    No route planned. The route engine compares candidates for safety, terrain difficulty, slope, distance and scientific value — never just the shortest path.
                  </p>
                </div>
                <button className="btn primary" id="pPlan" onClick={() => planEVA()}>
                  ⬡ Plan Safe Route
                </button>
              </>
            ) : (
              <>
                <div className="sec">
                  <h4>Route Comparison</h4>
                  {routes.map((r) => (
                    <div
                      key={r.id}
                      className={`card ${r === recRoute ? 'rec' : ''} ${r.riskScore >= 48 ? 'bad' : ''}`}
                      data-r={r.id}
                      onMouseEnter={() => handleRouteHover(r.id, true)}
                      onMouseLeave={() => handleRouteHover(r.id, false)}
                    >
                      <div className="t">
                        ROUTE {r.id}
                        {r === recRoute ? (
                          <span className="pill" style={{ color: 'var(--green)' }}>
                            OPTIMAL
                          </span>
                        ) : r.riskScore >= 48 ? (
                          <span className="pill c-crit">REJECTED</span>
                        ) : null}
                      </div>
                      <div className="s">
                        {r.name} · {r.desc}
                      </div>
                      <div className="kv" style={{ marginTop: '7px' }}>
                        <span>Distance</span>
                        <b>{(r.distM / 1000).toFixed(1)} km</b>
                        <span>Risk</span>
                        <b className={r.risk.c}>{r.risk.t}</b>
                        <span>Science value</span>
                        <b>{r.science}</b>
                        <span>Traverse time</span>
                        <b>{fmtHM(r.evaMin)}</b>
                        <span>Max slope</span>
                        <b>{r.maxSlope.toFixed(1)}°</b>
                        <span>Targets</span>
                        <b>{r.order.map((i) => i.replace('T', '0')).join(' → ')}</b>
                      </div>
                    </div>
                  ))}
                </div>

                {recRoute ? (
                  <>
                    <div className="sec">
                      <h4>Recommendation</h4>
                      <p
                        style={{
                          font: '700 15px var(--fh)',
                          letterSpacing: '.16em',
                          color: 'var(--green)'
                        }}
                      >
                        ROUTE {recRoute.id} — OPTIMAL
                      </p>
                      <p style={{ fontSize: '12px', whiteSpace: 'pre-line', marginTop: '6px' }}>
                        {explainRoute(routes, recRoute, store)}
                      </p>
                    </div>

                    <div className="sec">
                      <h4>Waypoints</h4>
                      {recRoute.waypoints.map((w, idx) => (
                        <div
                          key={`${w.name}-${idx}`}
                          className="prov"
                          style={{ cursor: 'pointer' }}
                          onClick={() => handleWaypointClick(w)}
                        >
                          <span
                            style={{
                              color:
                                w.type === 'target'
                                  ? 'var(--amber)'
                                  : w.type === 'hazard'
                                  ? '#ff8f8f'
                                  : w.type === 'return'
                                  ? 'var(--green)'
                                  : '#cfe8ff'
                            }}
                          >
                            {w.name}
                          </span>
                          <b>
                            {(w.d / 1000).toFixed(2)} km · {fmtClock(env.lmstStart + w.t)}
                          </b>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="c-crit">No candidate meets the safety threshold.</p>
                )}

                <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                  <button
                    className={`btn primary ${evaActive ? 'on' : ''}`}
                    onClick={() => {
                      if (evaActive) stopEVA();
                      else startEVA({ dur: 52, follow: true });
                    }}
                    style={evaActive ? { background: 'rgba(255, 60, 60, 0.28)', borderColor: '#ff4a4a', color: '#ff8a8a' } : {}}
                  >
                    {evaActive ? '⏹ Stop Marswalk' : '▶ Start Marswalk'}
                  </button>
                  <button className="btn" id="pPlan" onClick={() => planEVA()}>
                    ⟲ Recalculate
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {inT && panel === 'safety' && (
          <>
            <div className="sec">
              <h4>Mission Safety Layer</h4>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
                {[1, 2, 3, 4].map((l) => (
                  <span key={l} className="pill" style={{ color: LEVELC[l] }}>
                    {LEVEL[l]}
                  </span>
                ))}
              </div>
              <button
                className={`btn sm ${layers.hazards ? 'on' : ''}`}
                id="pHaz"
                onClick={() => toggleLayer('hazards')}
              >
                {layers.hazards ? 'HAZARD LAYER ON' : 'SHOW HAZARD LAYER'}
              </button>
            </div>

            <div className="sec">
              <h4>Detected Hazards ({zones.length})</h4>
              {zones.map((z, idx) => (
                <div
                  key={`${z.name}-${idx}`}
                  className="card"
                  onClick={() => handleHazardClick(z)}
                >
                  <div className="t" style={{ fontSize: '11px' }}>
                    {z.name}
                    <span className="pill" style={{ color: LEVELC[z.level] }}>
                      {LEVEL[z.level]}
                    </span>
                  </div>
                  <div className="s">
                    {z.desc || ''} · radius {Math.round(z.r * MPU)} m
                    {z.sim ? ' · SIM EVENT' : ''}
                    {recRoute && recRoute.zoneMin && recRoute.zoneMin[idx] != null
                      ? ` · route clearance ${Math.max(
                          0,
                          Math.round((recRoute.zoneMin[idx] - z.r * 0.55) * MPU)
                        )} m`
                      : ''}
                  </div>
                </div>
              ))}
            </div>

            <div className="sec">
              <h4>Engine Limits</h4>
              <div className="kv">
                <span>Max walkable slope</span>
                <b>{cons.blockSlope}°</b>
                <span>CRITICAL zones</span>
                <b>Hard-blocked</b>
                <span>Comms constraint</span>
                <b>
                  {cons.comm
                    ? `${Math.round(((cons.comm.r * MPU) / 1000) * 10) / 10} km of HAB-1`
                    : 'None'}
                </b>
              </div>
            </div>
          </>
        )}

        {!inT && panel === 'sim' && (
          <>
            <div className="sec">
              <h4>Mission Simulation Hub</h4>
              <p style={{ fontSize: '12px', marginBottom: '10px' }}>
                All 6 exploration regions feature complete planetary simulation packages. Select any region below to simulate surface traversal, science targets, and hazard scenarios.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
                {Object.values(REGIONS_CONFIG).map((r) => {
                  const isSel = selectedRegionId === r.id;
                  return (
                    <div
                      key={r.id}
                      className={`card ${isSel ? 'sel' : ''}`}
                      style={{ cursor: 'pointer', padding: '10px 12px' }}
                      onClick={() => selectRegion(r.id)}
                    >
                      <div className="t" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{r.name.toUpperCase()}</span>
                        <span className="pill" style={{ color: 'var(--green)' }}>READY</span>
                      </div>
                      <div className="s" style={{ marginTop: '4px', fontSize: '11px' }}>
                        {r.sector} · {Math.abs(r.lat).toFixed(1)}°{r.lat < 0 ? 'S' : 'N'} {Math.abs(r.lon).toFixed(1)}°{r.lon < 0 ? 'W' : 'E'}
                      </div>
                      <div className="mono" style={{ fontSize: '10px', color: 'var(--cyan)', marginTop: '4px' }}>
                        {r.scienceTargets.length} Science Targets · {r.hazards.length} Hazards · Base {r.baseElevM} m
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button
                  className="btn primary"
                  onClick={() => descendToRegion(selectedRegionId)}
                >
                  ⇣ Engage {selectedReg.name.toUpperCase()} Descent
                </button>
                <button
                  className="btn"
                  style={{ borderColor: 'var(--cyan)', color: 'var(--cyan)' }}
                  onClick={async () => {
                    await descendToRegion(selectedRegionId);
                    setTimeout(() => planEVA({ quick: false }), 500);
                  }}
                >
                  ⚡ Auto-Simulate {selectedReg.name.toUpperCase()} Mission
                </button>
              </div>
            </div>
          </>
        )}

        {inT && panel === 'sim' && (
          <>
            <div className="sec">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <h4>Active Simulation</h4>
                <span className="pill" style={{ color: 'var(--cyan)' }}>
                  {activeReg.name.toUpperCase()}
                </span>
              </div>
              <p style={{ fontSize: '12px', marginBottom: '10px' }}>
                Simulating surface exploration in {activeReg.name}. Inject a contingency to test autonomous real-time rerouting, or switch to simulate any other region.
              </p>

              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '10px', color: 'var(--dim)', letterSpacing: '0.12em', marginBottom: '6px' }}>
                  SWITCH SIMULATION REGION:
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
                  {Object.values(REGIONS_CONFIG).map((r) => (
                    <button
                      key={r.id}
                      className={`btn sm ${activeRegionId === r.id ? 'primary on' : ''}`}
                      style={{ fontSize: '10px', padding: '6px 8px', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                      onClick={() => descendToRegion(r.id)}
                    >
                      {r.name.split('·')[0].trim()}
                    </button>
                  ))}
                </div>
              </div>

              <h4>Contingency Injections</h4>
              {EVENTS.map((e) => (
                <button
                  key={e.id}
                  className="ev"
                  data-ev={e.id}
                  onClick={() => triggerEvent(e.id)}
                >
                  <span>
                    {e.t}
                    <small>{e.d}</small>
                  </span>
                </button>
              ))}
            </div>

            {cons.events && cons.events.length > 0 && (
              <div className="sec">
                <h4>Active Conditions</h4>
                <p className="mono" style={{ fontSize: '11px' }}>
                  {cons.events.map((e) => {
                    const ev = EVENTS.find((x) => x.id === e);
                    return (
                      <React.Fragment key={e}>
                        ▸ {ev ? ev.t.replace('⚠ ', '') : e}
                        <br />
                      </React.Fragment>
                    );
                  })}
                </p>
              </div>
            )}

            {lastSim && lastSim.r && (
              <div className="sec">
                <h4>Last Reroute</h4>
                <div className="kv">
                  <span>Route</span>
                  <b>
                    {lastSim.prev.id} → {lastSim.r.id}
                  </b>
                  <span>Additional distance</span>
                  <b>
                    {(lastSim.dd >= 0 ? '+' : '') + lastSim.dd.toFixed(1)} km
                  </b>
                  <span>Additional duration</span>
                  <b>
                    {(lastSim.de >= 0 ? '+' : '') + Math.round(lastSim.de)} min
                  </b>
                  <span>Safety</span>
                  <b>
                    {(lastSim.ds >= 0 ? '+' : '') + lastSim.ds}%
                  </b>
                  <span>Science</span>
                  <b>
                    {(lastSim.dsc >= 0 ? '+' : '') + lastSim.dsc}%
                  </b>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
              <button className="btn primary sm" onClick={() => planEVA({ quick: false })}>
                ⬡ Plan Safe Route
              </button>
              <button className="btn sm" id="pReset" onClick={resetSim}>
                ⟲ Reset Nominal
              </button>
            </div>
          </>
        )}

        {panel === 'log' && (
          <>
            <div className="sec" style={{ marginBottom: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <h4>Mission Telemetry Log</h4>
                <span className="pill" style={{ color: 'var(--cyan)' }}>
                  ACTIVE LOG
                </span>
              </div>
              <p style={{ fontSize: '11px', marginBottom: '10px' }}>
                Mission telemetry records autonomous traverse telemetry, sampling benchmarks, and environmental contingencies.
              </p>
              <div className="kv" style={{ fontSize: '11px', marginBottom: '10px' }}>
                <span>Total Distance</span>
                <b>{stats?.dist || '—'}</b>
                <span>Traverse Time</span>
                <b>{stats?.eva || '—'}</b>
                <span>Targets Logged</span>
                <b>{stats?.targets || '—'}</b>
                <span>Active Region</span>
                <b>{activeReg?.name || 'Gale Crater'}</b>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button
                  className="btn sm"
                  style={{ fontSize: '10px', flex: 1 }}
                  onClick={() => {
                    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(logs, null, 2));
                    const dl = document.createElement('a');
                    dl.setAttribute("href", dataStr);
                    dl.setAttribute("download", `marsx_telemetry_${Date.now()}.json`);
                    dl.click();
                  }}
                >
                  ⬇ Export Telemetry (.JSON)
                </button>
                <a
                  href="https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn sm"
                  style={{ fontSize: '10px', textDecoration: 'none', color: 'var(--cyan)', borderColor: 'var(--cyan)' }}
                >
                  USGS Maps ↗
                </a>
              </div>
            </div>

            <div className="sec">
              <h4 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Recorded Mission Telemetry ({logs.length})</span>
                <span className="mono" style={{ fontSize: '9px', color: 'var(--dim)' }}>SOL 412</span>
              </h4>
            </div>

            <div className="logs-container">
              {logs.length === 0 ? (
                <p>No telemetry recorded yet.</p>
              ) : (
                logs
                  .slice()
                  .reverse()
                  .map((l, i) => (
                    <div key={i} className={`log ${l.lv}`}>
                      <time>{l.t}</time>
                      {l.m}
                    </div>
                  ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
