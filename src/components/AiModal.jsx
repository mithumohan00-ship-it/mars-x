import React, { useState, useRef, useEffect } from 'react';
import { useMars } from '../context/MarsContext.jsx';
import { CHIPS } from '../engine/aiService.js';

export const AiModal = () => {
  const { mode, aiOpen, setAiOpen, aiLog, askAI } = useMars();
  const [inputVal, setInputVal] = useState('');
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [aiLog]);

  if (mode !== 'terrain') return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!inputVal.trim()) return;
    const q = inputVal.trim();
    setInputVal('');
    askAI(q);
  };

  const handleChipClick = (c) => {
    askAI(c);
  };

  return (
    <>
      <button
        id="aibtn"
        className="glass"
        onClick={() => setAiOpen(true)}
      >
        <div className="orb" />
        <div>
          <div className="l1">MISSION INTELLIGENCE</div>
          <div className="l2">ASK MARS-X AI ▸</div>
        </div>
      </button>

      {aiOpen && (
        <div id="ai" className="glass" style={{ display: 'flex' }}>
          <div className="ph">
            MARS-X Mission Intelligence
            <button className="x" id="aiClose" onClick={() => setAiOpen(false)}>
              ✕
            </button>
          </div>

          <div className="stat">
            <span>● CORE ONLINE · GROUNDED IN MISSION DATA</span>
            <span>SIM</span>
          </div>

          <div id="ailog" ref={logRef}>
            {aiLog.map((item, idx) => (
              <div key={idx} className={`msg ${item.role}`}>
                {item.text}
              </div>
            ))}
          </div>

          <div className="chips" id="chips">
            {CHIPS.map((chip, idx) => (
              <span
                key={idx}
                className="chip"
                onClick={() => handleChipClick(chip)}
              >
                {chip}
              </span>
            ))}
          </div>

          <form id="aiform" onSubmit={handleSubmit}>
            <input
              id="aiin"
              placeholder="Query mission computer…"
              autoComplete="off"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
            />
            <button
              className="btn sm"
              type="submit"
              style={{ clipPath: 'none', border: 'none', borderLeft: '1px solid var(--line)' }}
            >
              SEND
            </button>
          </form>
        </div>
      )}
    </>
  );
};
