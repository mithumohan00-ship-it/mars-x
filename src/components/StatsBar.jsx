import React from 'react';
import { useMars } from '../context/MarsContext.jsx';

export const StatsBar = () => {
  const { mode, stats, recRoute, evaActive, surfaceActive } = useMars();

  if (mode !== 'terrain') return null;

  const isRecording = evaActive || surfaceActive;

  let distVal = isRecording
    ? (stats.dist && stats.dist.includes('/') ? stats.dist : `0.00 / ${(recRoute ? recRoute.distM / 1000 : 2.4).toFixed(1)} km`)
    : (stats.dist && stats.dist !== '— km' && stats.dist !== '—'
        ? stats.dist
        : (recRoute ? `${(recRoute.distM / 1000).toFixed(1)} km` : '2.4 km'));

  let evaVal = isRecording
    ? (stats.eva && stats.eva.startsWith('T+') ? stats.eva : 'T+0m 00s')
    : (stats.eva && stats.eva !== '—'
        ? stats.eva
        : (recRoute ? `${Math.floor(recRoute.evaMin / 60)}h ${recRoute.evaMin % 60}m` : '1h 45m'));

  let targetsVal = stats.targets && stats.targets !== '0 / 3'
    ? stats.targets
    : (recRoute ? `${recRoute.order?.length || 3} / 3` : '3 / 3');

  let avoidedVal = stats.avoided && stats.avoided !== '—'
    ? stats.avoided
    : (recRoute ? String(Math.round(recRoute.avoided)) : '4');

  let riskVal = stats.risk && stats.risk !== '—' && stats.risk !== '-'
    ? stats.risk
    : (recRoute?.risk?.t || 'NOMINAL');

  let riskColor = stats.riskObj?.col || recRoute?.risk?.col || (
    riskVal === 'CRITICAL' || riskVal === 'NO-GO' ? '#ff4a4a' :
    riskVal === 'CAUTION' ? '#ffad3b' : '#5fe1ff'
  );

  let safetyPct = stats.safetyPct ?? (recRoute ? recRoute.safety : Math.max(0, 100 - (stats.riskScore || 15)));

  let scienceVal = stats.science != null && stats.science !== '—' && stats.science !== 0
    ? stats.science
    : (recRoute ? Math.round(recRoute.science) : 85);

  let sciencePct = typeof scienceVal === 'number' ? scienceVal : (recRoute ? recRoute.science : 85);

  return (
    <div id="stats" className="glass">
      <div className="hd" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        STATUS
        {isRecording && (
          <span
            className="pill c-crit"
            style={{
              padding: '1px 6px',
              fontSize: '9px',
              letterSpacing: '0.12em',
              animation: 'recBlink 1.2s infinite ease-in-out'
            }}
          >
            ● REC
          </span>
        )}
      </div>

      <div className="st">
        <div className="lb">{isRecording ? 'LIVE DISTANCE' : 'DISTANCE'}</div>
        <div className="vl" id="sDist">{distVal}</div>
      </div>

      <div className="st">
        <div className="lb">{isRecording ? 'RECORDED TIME' : 'EST. TIME'}</div>
        <div className="vl" id="sEva">{evaVal}</div>
      </div>

      <div className="st">
        <div className="lb">SCI. TARGETS</div>
        <div className="vl" id="sTg">{targetsVal}</div>
      </div>

      <div className="st">
        <div className="lb">HAZARDS AVOIDED</div>
        <div className="vl" id="sHz">{avoidedVal}</div>
      </div>

      <div className="st">
        <div className="lb">RISK</div>
        <div className="vl" id="sRisk" style={{ color: riskColor }}>
          {riskVal}
        </div>
        <div className="pb">
          <i
            id="sRiskB"
            style={{
              width: `${Math.min(100, Math.max(0, safetyPct))}%`,
              backgroundColor: riskColor,
              boxShadow: `0 0 6px ${riskColor}`
            }}
          />
        </div>
      </div>

      <div className="st">
        <div className="lb">SCIENCE VALUE</div>
        <div className="vl amber" id="sSci">
          {scienceVal === '—' ? '— / 100' : `${scienceVal} / 100`}
        </div>
        <div className="pb">
          <i
            id="sSciB"
            style={{
              width: `${Math.min(100, Math.max(0, sciencePct))}%`,
              background: 'var(--amber)',
              boxShadow: '0 0 6px var(--amber)'
            }}
          />
        </div>
      </div>
    </div>
  );
};
