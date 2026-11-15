import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { useMars } from '../context/MarsContext.jsx';
import { LEVEL, LEVELC, MPU } from '../engine/dataProvider.js';
import { fmtClock, fmtHMS, compass } from '../engine/math.js';

export const HudOverlay = () => {
  const {
    hudActive,
    toggleHUD,
    surfaceActive,
    exitSurface,
    hudData,
    recRoute,
    storeRef,
    envRef,
    cons,
    engineRef
  } = useMars();

  const tapeRef = useRef(null);
  const radarRef = useRef(null);

  // Keyboard shortcut: ESC to exit Surface mode or HUD
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (surfaceActive) {
          exitSurface();
        } else if (hudActive) {
          toggleHUD(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [surfaceActive, hudActive, exitSurface, toggleHUD]);

  // Entrance animation
  useEffect(() => {
    if (hudActive) {
      gsap.fromTo(
        '#hud',
        { opacity: 0, scale: 1.06 },
        { opacity: 1, scale: 1, duration: 0.8, ease: 'power3.out' }
      );
    }
  }, [hudActive]);

  // Build compass tape tick marks
  useEffect(() => {
    if (!hudActive) return;
    const tape = tapeRef.current;
    if (!tape || tape.childElementCount > 0) return;
    let h = '';
    for (let d = -360; d <= 720; d += 15) {
      const v = ((d % 360) + 360) % 360;
      const lab =
        v % 90 === 0
          ? ['N', 'E', 'S', 'W'][v / 90]
          : v % 45 === 0
          ? ['NE', 'SE', 'SW', 'NW'][(v - 45) / 90]
          : String(v).padStart(3, '0');
      h += `<span class="${v % 45 === 0 ? 'mj' : ''}" style="position:absolute;left:${(d + 360) * 4}px">${lab}</span>`;
    }
    tape.innerHTML = h;
  }, [hudActive]);

  // Update tape position and radar canvas on hudData change
  useEffect(() => {
    if (!hudActive) return;

    // Compass Tape position
    if (tapeRef.current && tapeRef.current.parentElement) {
      const w = tapeRef.current.parentElement.clientWidth || 620;
      const hd = hudData.heading || 0;
      tapeRef.current.style.transform = `translateX(${w / 2 - (hd + 360) * 4}px)`;
    }

    // Radar Canvas
    const canvas = radarRef.current;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    const W = canvas.width;
    const S = W / 2;
    const sc = S / 22;
    const px = hudData.px || (storeRef.current?.hab ? storeRef.current.hab.x : 0);
    const pz = hudData.pz || (storeRef.current?.hab ? storeRef.current.hab.z : 0);
    const hd = hudData.heading || 0;

    g.clearRect(0, 0, W, W);
    g.save();
    g.translate(S, S);
    g.beginPath();
    g.arc(0, 0, S - 2, 0, Math.PI * 2);
    g.clip();

    // Radar background
    g.fillStyle = 'rgba(0,20,30,.45)';
    g.fillRect(-S, -S, W, W);

    // Range rings
    g.strokeStyle = 'rgba(95,225,255,.25)';
    [0.33, 0.66, 1].forEach((f) => {
      g.beginPath();
      g.arc(0, 0, (S - 2) * f, 0, Math.PI * 2);
      g.stroke();
    });

    // Rotate field to heading
    g.rotate((hd * Math.PI) / 180);
    const tx = (x, z) => [(x - px) * sc, -(z - pz) * sc];

    // Draw hazard zones
    const zones = [...(storeRef.current?.hazards || []), ...(cons?.extraZones || [])];
    for (const zn of zones) {
      const [a, b] = tx(zn.x, zn.z);
      g.fillStyle = (LEVELC[zn.level] || '#ff4a4a') + '44';
      g.beginPath();
      g.arc(a, b, zn.r * sc, 0, Math.PI * 2);
      g.fill();
    }

    // Draw route and waypoints
    if (recRoute && recRoute.line) {
      g.strokeStyle = '#5fe1ff';
      g.lineWidth = 3;
      g.beginPath();
      recRoute.line.forEach((p, i) => {
        const [a, b] = tx(p.x, p.z);
        if (i === 0) g.moveTo(a, b);
        else g.lineTo(a, b);
      });
      g.stroke();

      if (recRoute.waypoints) {
        recRoute.waypoints.forEach((w) => {
          const [a, b] = tx(w.x, w.z);
          g.fillStyle =
            w.type === 'target'
              ? '#ffad3b'
              : w.type === 'hazard'
              ? '#ff4a4a'
              : '#fff';
          g.fillRect(a - 4, b - 4, 8, 8);
        });
      }
    }

    // Radar sweep
    const sw = ((performance.now() / 1000) * 1.5) % (Math.PI * 2);
    g.rotate((-hd * Math.PI) / 180 + sw);
    const gr = g.createLinearGradient(0, 0, S, 0);
    gr.addColorStop(0, 'rgba(95,225,255,.5)');
    gr.addColorStop(1, 'rgba(95,225,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, S, -0.35, 0);
    g.fill();

    g.restore();

    // Center icon (astronaut position)
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(S, S - 9);
    g.lineTo(S - 6, S + 6);
    g.lineTo(S + 6, S + 6);
    g.fill();
  }, [hudActive, hudData, recRoute, storeRef, cons]);

  if (!hudActive && !surfaceActive) return null;

  const env = envRef.current || { lmstStart: 360 };
  const engine = engineRef.current;
  const eva = engine?.eva;
  const tm = eva ? eva.min || 0 : 0;
  const cd = eva && eva.pos ? eva.pos.d : 0;

  let targetText = '—';
  let distText = '— m';
  let nextWpText = '—';
  let warnText = null;

  if (recRoute && recRoute.waypoints) {
    const next = recRoute.waypoints.find((w) => w.type === 'target' && w.d > cd + 1);
    const nwp = recRoute.waypoints.find((w) => w.d > cd + 1 && w.type !== 'hazard');
    const nextTargetName = next
      ? (typeof next.target === 'object' && next.target?.name
          ? next.target.name
          : next.name || 'TARGET')
      : 'RETURN TO HAB';
    targetText = nextTargetName
      .replace('GEOLOGICAL ', '')
      .replace('LAYERED SEDIMENTARY FORMATION', 'LAYERED FORMATION')
      .replace('CLAY-BEARING OUTCROP', 'CLAY OUTCROP');

    const dist = next ? next.d - cd : (recRoute.distM != null ? recRoute.distM - cd : 0);
    distText = `${Math.max(0, Math.round(dist))} m`;
    nextWpText = nwp
      ? `${(nwp.name || 'WAYPOINT').replace('DEPART ', '')} · ${Math.max(0, Math.round(nwp.d - cd))} m`
      : 'HABITAT';

    const px = hudData.px || 0;
    const pz = hudData.pz || 0;
    const nh = storeRef.current?.nearestHazard
      ? storeRef.current.nearestHazard(px, pz, [
          ...(storeRef.current?.hazards || []),
          ...(cons?.extraZones || [])
        ])
      : null;
    if (nh && nh.d < 2.8) {
      warnText = {
        name: nh.z?.name || 'HAZARD',
        dist: Math.max(0, Math.round(nh.d * MPU)),
        level: LEVEL[nh.z?.level] || 'WARNING',
        desc: nh.z?.desc || 'HOLD ROUTE'
      };
    }
  } else {
    targetText = 'NO EVA PLANNED';
    distText = '— m';
  }

  const o2 = Math.max(0, 98 - tm * 0.055);
  const hd = hudData.heading || 0;
  const compassHeading = `${compass(hd)} ${String(Math.round(hd) % 360).padStart(3, '0')}°`;

  return (
    <>
      {hudActive && (
        <div id="hud" style={{ display: 'block' }}>
          <svg className="visor" viewBox="0 0 1600 900" preserveAspectRatio="none">
            <defs>
              <radialGradient id="vg" cx="50%" cy="50%" r="70%">
                <stop offset="62%" stopColor="#000" stopOpacity="0" />
                <stop offset="100%" stopColor="#02121c" stopOpacity=".85" />
              </radialGradient>
            </defs>
            <rect width="1600" height="900" fill="url(#vg)" />
            <path
              d="M60 140 Q40 450 60 760"
              stroke="#5fe1ff"
              strokeOpacity=".35"
              fill="none"
              strokeWidth="2"
            />
            <path
              d="M1540 140 Q1560 450 1540 760"
              stroke="#5fe1ff"
              strokeOpacity=".35"
              fill="none"
              strokeWidth="2"
            />
            <path
              d="M300 60 Q800 20 1300 60"
              stroke="#5fe1ff"
              strokeOpacity=".25"
              fill="none"
              strokeWidth="1.5"
            />
            <path
              d="M300 840 Q800 880 1300 840"
              stroke="#5fe1ff"
              strokeOpacity=".25"
              fill="none"
              strokeWidth="1.5"
            />
            <g stroke="#5fe1ff" strokeOpacity=".6" fill="none" strokeWidth="2">
              <path d="M120 120 h60 M120 120 v60" />
              <path d="M1480 120 h-60 M1480 120 v60" />
              <path d="M120 780 h60 M120 780 v-60" />
              <path d="M1480 780 h-60 M1480 780 v-60" />
            </g>
          </svg>

          <div className="top">
            <div className="tape">
              <div id="tape" ref={tapeRef} />
            </div>
            <div className="hdg" id="hHdg">
              {compassHeading}
            </div>
          </div>

          <div className="blk L">
            <div className="act">● MISSION ACTIVE</div>
            <div className="lb">EVA TIME</div>
            <div className="vl" id="hEva">
              {fmtHMS(tm)}
            </div>
            <div className="lb">OXYGEN</div>
            <div className="vl" id="hO2">
              {Math.round(o2)}%
            </div>
            <div className="o2">
              <i id="hO2b" style={{ width: `${o2}%` }} />
            </div>
            <div className="lb">RISK</div>
            <div
              className="vl"
              id="hRisk"
              style={{ color: recRoute ? recRoute.risk.col : '#5fe1ff' }}
            >
              {recRoute ? recRoute.risk.t : 'LOW'}
            </div>
          </div>

          <div className="blk R">
            <div className="lb">TARGET</div>
            <div className="vl" id="hTgt">
              {targetText}
            </div>
            <div className="lb">DISTANCE TO TARGET</div>
            <div className="vl" id="hDist">
              {distText}
            </div>
            <div className="lb">NEXT WAYPOINT</div>
            <div className="vl" id="hWp" style={{ fontSize: '16px' }}>
              {nextWpText}
            </div>
          </div>

          <div className="ret" />

          {warnText && (
            <div className="warn" id="hWarn" style={{ display: 'block' }}>
              ⚠ {warnText.name} · {warnText.dist} m
              <br />
              <small style={{ letterSpacing: '.1em' }}>
                {warnText.level} · {warnText.desc}
              </small>
            </div>
          )}

          <div className="timer" id="hTimer">
            MISSION CLOCK {fmtClock(env.lmstStart + tm)} LMST · T+{fmtHMS(tm)}
          </div>

          <canvas id="radar" ref={radarRef} width={340} height={340} />

          <div className="sb" id="hSb">
            SUIT P 29.6 kPa · CO₂ NOMINAL
            <br />
            COMMS ▮▮▮▮ HAB-1 LINK
            <br />
            SIMULATION DATA
          </div>
        </div>
      )}

      {surfaceActive && (
        <div id="surfhelp" style={{ display: 'block' }}>
          SURFACE MODE · DRAG TO LOOK · <span className="kbd">W</span>
          <span className="kbd">A</span>
          <span className="kbd">S</span>
          <span className="kbd">D</span> MOVE · <span className="kbd">SHIFT</span> FAST ·{' '}
          <span className="kbd">ESC</span> EXIT
        </div>
      )}
    </>
  );
};
