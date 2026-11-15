import React from 'react';
import { useMars } from '../context/MarsContext.jsx';
import { GEO_UNITS, LEVEL, LEVELC } from '../engine/dataProvider.js';

const LAYERS = [
  {
    id: 'terrain',
    name: 'Terrain',
    sw: '#c98a5a',
    lg: 'Relief, regolith albedo, rocks · off = holographic wireframe'
  },
  {
    id: 'elevation',
    name: 'Elevation',
    sw: 'linear-gradient(90deg,#30123b,#28bceb,#a4fc3c,#fb8022,#7a0403)',
    lg: 'grad'
  },
  { id: 'geology', name: 'Geological', sw: '#ff5c7a', lg: 'geo' },
  { id: 'mineral', name: 'Mineral / Spectral', sw: '#5cffc0', lg: 'min' },
  {
    id: 'temperature',
    name: 'Temperature',
    sw: 'linear-gradient(90deg,#140659,#1a73ff,#ff7319,#fff27f)',
    lg: 'temp'
  },
  {
    id: 'radiation',
    name: 'Radiation',
    sw: 'linear-gradient(90deg,#e61a26,#ffd933)',
    lg: 'rad'
  },
  { id: 'atmosphere', name: 'Atmospheric', sw: '#ffcf9c', lg: 'atm' },
  {
    id: 'imagery',
    name: 'Rover Imagery',
    sw: '#b48cff',
    lg: 'Observation footprints · click to open'
  },
  { id: 'hazards', name: 'Hazards', sw: '#ff4a4a', lg: 'haz' },
  { id: 'targets', name: 'Science Targets', sw: '#ffad3b', lg: '3 targets · Mount Sharp NW flank' }
];

export const LayersPanel = () => {
  const { mode, layers, toggleLayer, storeRef, envRef } = useMars();

  if (mode !== 'terrain') return null;

  const store = storeRef.current;
  const env = envRef.current || {
    pressureHpa: 7.2,
    dustTau: 0.65,
    windMs: 6.2,
    windDir: 'ENE'
  };

  const renderLegend = (L) => {
    switch (L.lg) {
      case 'grad':
        return (
          <>
            <div className="grad" style={{ background: L.sw }} />
            <div className="row">
              <span>{store.minM ? Math.round(store.minM) : -4500} m</span>
              <span>{store.maxM ? Math.round(store.maxM) : -3900} m</span>
            </div>
            Contours 25 m · index 100 m
          </>
        );
      case 'geo':
        const geoUnits = (store?.geoTable && store.geoTable.length) ? store.geoTable : GEO_UNITS;
        return geoUnits.map((u) => (
          <div key={u.name}>
            <span className="chip">
              <i style={{ background: u.hl }} />
              {u.name}
            </span>
          </div>
        ));
      case 'min':
        return (
          <>
            <span className="chip">
              <i style={{ background: '#4dffbf' }} />
              Phyllosilicate
            </span>
            <span className="chip">
              <i style={{ background: '#ff4d99' }} />
              Hematite
            </span>
            <span className="chip">
              <i style={{ background: '#ffe64d' }} />
              Sulfate
            </span>
            <br />
            Spectral index 0–1 · hotspots pulse
          </>
        );
      case 'temp':
        return (
          <>
            <div className="grad" style={{ background: L.sw }} />
            <div className="row">
              <span>{store.tRange ? store.tRange[0].toFixed(0) : -45} °C</span>
              <span>{store.tRange ? store.tRange[1].toFixed(0) : -15} °C</span>
            </div>
            Afternoon ground temp · SIM
          </>
        );
      case 'rad':
        return (
          <>
            <div className="grad" style={{ background: L.sw }} />
            <div className="row">
              <span>{store.rRange ? store.rRange[0].toFixed(2) : '0.55'}</span>
              <span>{store.rRange ? store.rRange[1].toFixed(2) : '0.85'} mSv/d</span>
            </div>
            Surface dose estimate · SIM
          </>
        );
      case 'atm':
        return `P ${env.pressureHpa} hPa · τ ${env.dustTau} · wind ${env.windMs} m/s ${env.windDir}`;
      case 'haz':
        return [1, 2, 3, 4].map((l) => (
          <span key={l} className="chip">
            <i style={{ background: LEVELC[l] }} />
            {LEVEL[l]}
          </span>
        ));
      default:
        return L.lg;
    }
  };

  return (
    <div id="layers" className="glass">
      <div className="ph">
        Data Layers <span className="tag">HOLO</span>
      </div>
      <div className="list" id="laylist">
        {LAYERS.map((L) => {
          const isOn = !!layers[L.id];
          return (
            <React.Fragment key={L.id}>
              <div
                className={`lay ${isOn ? 'on' : ''}`}
                data-l={L.id}
                onClick={() => toggleLayer(L.id)}
              >
                <span className="cb" />
                {L.name}
                <span className="sw" style={{ background: L.sw }} />
              </div>
              <div className="legend">{renderLegend(L)}</div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
