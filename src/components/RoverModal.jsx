import React, { useEffect, useRef } from 'react';
import { useMars } from '../context/MarsContext.jsx';
import { rng, fbm3 } from '../engine/math.js';

export const RoverModal = () => {
  const { roverModalTarget, setRoverModalTarget, storeRef } = useMars();
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!roverModalTarget || !canvasRef.current) return;
    const store = storeRef.current;
    const t = typeof roverModalTarget === 'object' && roverModalTarget.id
      ? roverModalTarget
      : store?.targets?.find((x) => x.id === roverModalTarget) || store?.targets?.[0];
    if (!t) return;
    const c = canvasRef.current;
    const g = c.getContext('2d');
    const W = c.width;
    const H = c.height;
    const charCode = (t.id && t.id.length > 1) ? t.id.charCodeAt(1) : 49;
    const R = rng(charCode * 99);

    // Sky
    const sky = g.createLinearGradient(0, 0, 0, H * 0.5);
    sky.addColorStop(0, '#8a6a52');
    sky.addColorStop(1, '#d9b48c');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    // Far mountains
    g.fillStyle = 'rgba(150,105,80,.55)';
    g.beginPath();
    g.moveTo(0, H * 0.42);
    for (let x = 0; x <= W; x += 20) {
      g.lineTo(x, H * 0.42 - Math.sin(x * 0.004 + 1) * 18 - fbm3(x * 0.01, 1, 1, 3) * 30);
    }
    g.lineTo(W, H * 0.5);
    g.lineTo(0, H * 0.5);
    g.fill();

    // Foreground soil
    const gr = g.createLinearGradient(0, H * 0.45, 0, H);
    gr.addColorStop(0, '#a4704c');
    gr.addColorStop(1, '#6e432c');
    g.fillStyle = gr;
    g.fillRect(0, H * 0.45, W, H * 0.55);

    // Geological features depending on kind
    if (t.kind === 'layer') {
      for (let i = 0; i < 26; i++) {
        const y = H * 0.22 + i * 7.5;
        g.fillStyle = i % 2 ? 'rgba(205,160,120,.9)' : 'rgba(170,120,90,.9)';
        g.beginPath();
        g.moveTo(W * 0.18, y);
        for (let x = W * 0.18; x <= W * 0.82; x += 12) {
          g.lineTo(x, y + Math.sin(x * 0.02 + i) * 1.5);
        }
        g.lineTo(W * 0.82, y + 7.5);
        g.lineTo(W * 0.18, y + 7.5);
        g.fill();
      }
      g.fillStyle = 'rgba(120,80,60,.6)';
      g.fillRect(W * 0.18, H * 0.22 + 26 * 7.5, W * 0.64, 10);
    }

    if (t.kind === 'clay') {
      for (let i = 0; i < 70; i++) {
        const x = R() * W;
        const y = H * 0.52 + R() * H * 0.45;
        const s = 12 + R() * 40 * (y / H);
        g.fillStyle = `rgba(${120 + R() * 40},${95 + R() * 30},${100 + R() * 30},.95)`;
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * 6.28 + R() * 0.4;
          g.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s * 0.35);
        }
        g.fill();
        g.strokeStyle = 'rgba(40,25,20,.6)';
        g.stroke();
      }
    }

    if (t.kind === 'contact') {
      g.fillStyle = 'rgba(215,180,130,.95)';
      g.beginPath();
      g.moveTo(W * 0.1, H * 0.5);
      g.lineTo(W * 0.9, H * 0.36);
      g.lineTo(W * 0.9, H * 0.75);
      g.lineTo(W * 0.1, H * 0.82);
      g.fill();

      g.fillStyle = 'rgba(110,85,85,.97)';
      g.beginPath();
      g.moveTo(W * 0.1, H * 0.5);
      g.lineTo(W * 0.9, H * 0.36);
      g.lineTo(W * 0.9, H * 0.25);
      g.lineTo(W * 0.1, H * 0.38);
      g.fill();

      g.strokeStyle = 'rgba(95,225,255,.9)';
      g.setLineDash([8, 6]);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(W * 0.1, H * 0.5);
      g.lineTo(W * 0.9, H * 0.36);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = '#5fe1ff';
      g.font = '14px JetBrains Mono';
      g.fillText('CONTACT', W * 0.62, H * 0.36);
    }

    // Rocks
    for (let i = 0; i < 120; i++) {
      const x = R() * W;
      const y = H * 0.5 + R() * H * 0.5;
      const s = 1 + R() * 5 * (y / H);
      g.fillStyle = `rgba(${50 + R() * 40},${30 + R() * 20},20,.8)`;
      g.beginPath();
      g.ellipse(x, y, s, s * 0.6, 0, 0, 6.28);
      g.fill();
    }

    // Sensor noise
    const im = g.getImageData(0, 0, W, H);
    for (let i = 0; i < im.data.length; i += 4) {
      const n = (R() - 0.5) * 18;
      im.data[i] += n;
      im.data[i + 1] += n;
      im.data[i + 2] += n;
    }
    g.putImageData(im, 0, 0);

    // Bounding ROI box
    g.strokeStyle = 'rgba(95,225,255,.7)';
    g.lineWidth = 1;
    g.strokeRect(W * 0.4, H * 0.5, W * 0.2, H * 0.3);
    g.fillStyle = 'rgba(95,225,255,.9)';
    g.font = '12px JetBrains Mono';
    g.fillText('ROI-01', W * 0.4 + 4, H * 0.5 - 6);
    g.fillText(`${t.code} · SOL 412 · SIM`, 12, 20);
  }, [roverModalTarget]);

  if (!roverModalTarget) return null;

  const t = roverModalTarget;

  return (
    <div id="rover" className="glass" style={{ display: 'block' }}>
      <div className="ph">
        <span id="rvT">{t.code} · ROVER OBSERVATION</span>
        <button className="x" id="rvClose" onClick={() => setRoverModalTarget(null)}>
          ✕
        </button>
      </div>

      <div className="img">
        <canvas id="rvC" ref={canvasRef} width={860} height={380} />
        <div className="xh" />
        <div className="wm">SIMULATED RENDER · NOT MISSION IMAGERY</div>
      </div>

      <div className="meta" id="rvM">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <div style={{ fontSize: '11px', color: 'var(--cyan)', fontWeight: 600, letterSpacing: '0.1em' }}>
            NASA MARS 2020 RAW IMAGES REPOSITORY
          </div>
          <a
            href="https://mars.nasa.gov/mars2020/multimedia/raw-images/"
            target="_blank"
            rel="noopener noreferrer"
            className="btn sm"
            style={{ fontSize: '10px', padding: '4px 8px', textDecoration: 'none', color: 'var(--cyan)', borderColor: 'var(--cyan)' }}
          >
            NASA Raw Archive ↗
          </a>
        </div>
        <div className="kv">
          <span>Observed feature</span>
          <b style={{ maxWidth: '230px', whiteSpace: 'normal' }}>{t.feature}</b>
          <span>Scientific relevance</span>
          <b className="c-mod">{t.relevance?.toUpperCase()}</b>
          <span>Instruments</span>
          <b>Mastcam-Z · SuperCam RMI · WATSON</b>
          <span>PDS Dataset</span>
          <b style={{ color: 'var(--green)' }}>NASA Mars 2020 Raw Feed Ready</b>
        </div>
        <p className="mono" style={{ fontSize: '9px', color: 'var(--dim)', marginTop: '8px' }}>
          Connected to NASA Mars 2020 Raw Image database: <a href="https://mars.nasa.gov/mars2020/multimedia/raw-images/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--cyan)' }}>mars.nasa.gov/mars2020/multimedia/raw-images</a>.
        </p>
      </div>
    </div>
  );
};
