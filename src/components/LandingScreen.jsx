import React, { useRef, useEffect } from 'react';
import { useMars } from '../context/MarsContext.jsx';
import gsap from 'gsap';

export const LandingScreen = () => {
  const { mode, enterMissionControl, runDemo, engineRef } = useMars();
  const landingRef = useRef(null);
  const titleRef = useRef(null);

  useEffect(() => {
    if (mode === 'landing') {
      const handleMouseMove = (e) => {
        const nx = e.clientX / window.innerWidth - 0.5;
        const ny = e.clientY / window.innerHeight - 0.5;
        if (titleRef.current) {
          gsap.to(titleRef.current, { x: nx * -18, y: ny * -10, duration: 1 });
        }
        if (engineRef.current && engineRef.current.globeObjects?.group) {
          gsap.to(engineRef.current.globeObjects.group.rotation, {
            x: ny * 0.15,
            duration: 1.5
          });
        }
      };
      window.addEventListener('mousemove', handleMouseMove);
      return () => window.removeEventListener('mousemove', handleMouseMove);
    }
  }, [mode, engineRef]);

  if (mode !== 'landing') return null;

  const handleExplore = () => {
    enterMissionControl(true);
    setTimeout(() => {
      if (engineRef.current) engineRef.current.spin = false;
    }, 1600);
  };

  return (
    <div id="landing" ref={landingRef}>
      <div className="l-kicker">MISSION PLANNING &amp; NAVIGATION · v1.0 PROTOTYPE</div>
      <div className="l-title" id="ltitle" ref={titleRef}>
        MARS-X
      </div>
      <div className="l-sub">Human Surface Exploration &amp; Mission Intelligence</div>
      <div className="l-desc">
        Integrating planetary science, terrain intelligence and mission planning for the first generation of human Mars explorers.
      </div>
      <div className="l-actions">
        <button
          className="btn primary mag"
          id="bEnter"
          onClick={() => enterMissionControl(false)}
        >
          ▶ Enter Mission Control
        </button>
        <button className="btn mag" id="bExplore" onClick={handleExplore}>
          ◎ Explore Mars
        </button>
        <button className="btn amber mag" id="bDemo" onClick={runDemo}>
          ◉ Demo Mode
        </button>
      </div>
      <div className="l-tele">
        <div>
          TARGET <b>GALE CRATER · AEOLIS MONS</b>
          <br />
          5.4°S 137.8°E · FLOOR ≈ −4.5 KM
        </div>
        <div style={{ textAlign: 'center' }}>
          PRIORITY RULE
          <br />
          <b>SAFETY → SCIENCE → EFFICIENCY</b>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className="sim-badge">
            <i />
            SIMULATION DATA
          </span>
          <br />
          NASA DATA INTERFACES READY
        </div>
      </div>
    </div>
  );
};
