import React from 'react';
import { useMars } from '../context/MarsContext.jsx';

export const CompleteModal = () => {
  const {
    evaDebrief,
    setEvaDebrief,
    startEVA,
    stopEVA,
    surfaceActive,
    exitSurface
  } = useMars();

  if (!evaDebrief) return null;

  const d = evaDebrief;
  const r = d.route;

  const handleReplay = () => {
    setEvaDebrief(null);
    if (surfaceActive) exitSurface();
    startEVA({ dur: 26, follow: true, replay: true });
  };

  const handleClose = () => {
    setEvaDebrief(null);
    stopEVA();
  };

  return (
    <div id="complete" className="glass" style={{ display: 'block' }}>
      <div className="ph">
        EVA Debrief <span className="tag">SIMULATION</span>
      </div>
      <div className="bd" id="cB">
        <h2>MISSION COMPLETE</h2>
        <div className="mono" style={{ fontSize: '11px', color: 'var(--dim)', marginTop: '6px' }}>
          ROUTE {r.id} · {r.name} ·{' '}
          {d.contingenciesCount > 0
            ? `${d.contingenciesCount} contingency event(s) handled`
            : 'nominal'}
        </div>

        <div className="grid">
          <div>
            <span>TOTAL DISTANCE</span>
            <b>{d.distKm} km</b>
          </div>
          <div>
            <span>SCIENCE TARGETS</span>
            <b>{d.targetsCount}</b>
          </div>
          <div>
            <span>OBSERVATIONS</span>
            <b>{d.observations}</b>
          </div>
          <div>
            <span>HAZARDS AVOIDED</span>
            <b>{d.hazardsAvoided}</b>
          </div>
          <div>
            <span>EVA TIME</span>
            <b>{d.evaTimeFormatted}</b>
          </div>
          <div>
            <span>SCIENCE RETURN</span>
            <b style={{ color: 'var(--amber)' }}>{d.scienceReturnPercent}%</b>
          </div>
          <div>
            <span>SAFETY SCORE</span>
            <b style={{ color: 'var(--green)' }}>{d.safetyScore}%</b>
          </div>
          <div>
            <span>ELEV. GAIN</span>
            <b>{d.elevationGain} m</b>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button className="btn primary" id="cReplay" onClick={handleReplay}>
            ⟲ Replay EVA
          </button>
          <button className="btn" id="cClose" onClick={handleClose}>
            Close Debrief
          </button>
        </div>

        <p className="mono" style={{ fontSize: '9px', color: 'var(--dim)', marginTop: '12px' }}>
          SIMULATION DATA · values computed by the MARS-X route engine on modelled terrain
        </p>
      </div>
    </div>
  );
};
