import React, { useEffect, useRef } from 'react';
import { useMars } from '../context/MarsContext.jsx';
import gsap from 'gsap';

export const DemoCaption = () => {
  const { demoActive, demoStep, stopDemo } = useMars();
  const progressRef = useRef(null);

  useEffect(() => {
    if (demoActive && progressRef.current) {
      gsap.fromTo(
        progressRef.current,
        { width: '0%' },
        { width: '100%', duration: demoStep.secs || 6, ease: 'none' }
      );
    }
  }, [demoActive, demoStep]);

  if (!demoActive) return null;

  return (
    <div id="caption" className="glass" style={{ display: 'flex' }}>
      <span className="n" id="capN">
        {String(demoStep.n || 1).padStart(2, '0')}/12
      </span>
      <span className="tt" id="capT">
        {demoStep.text || 'DEMO'}
      </span>
      <button className="btn sm danger" id="capX" onClick={stopDemo}>
        EXIT DEMO
      </button>
      <div className="pg" id="capP" ref={progressRef} />
    </div>
  );
};
