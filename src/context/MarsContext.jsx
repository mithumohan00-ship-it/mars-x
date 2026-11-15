import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import gsap from 'gsap';
import {
  REGION, REGIONS_CONFIG, GEO_UNITS, LEVEL, LEVELC, MPU,
  SimulationDataProvider, NasaPdsDataProvider, DataNormalizer, GeoStore
} from '../engine/dataProvider.js';
import { RouteEngine, VARIANTS, STOP_MIN } from '../engine/routeEngine.js';
import { MarsXEngine, AERIAL } from '../engine/threeEngine.js';
import { answer, CHIPS } from '../engine/aiService.js';
import { pad2, fmtHM, fmtClock, dirWord, bearing, sleep, tween, lerp, smooth } from '../engine/math.js';

const MarsContext = createContext(null);

export const MarsProvider = ({ children }) => {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);

  // Core domain singletons
  const storeRef = useRef(new GeoStore());
  const providerRef = useRef(new SimulationDataProvider());
  const nasaRef = useRef(new NasaPdsDataProvider());
  const routeEngineRef = useRef(null);
  const habRef = useRef(null);
  const envRef = useRef(null);

  // Reactive UI State
  const [bootProgress, setBootProgress] = useState(0);
  const [bootReady, setBootReady] = useState(false);
  const [bootRows, setBootRows] = useState([]);
  const [mode, setMode] = useState('boot'); // 'boot', 'landing', 'globe', 'terrain'
  const [selectedRegionId, setSelectedRegionId] = useState('gale-msharp-nw');
  const [activeRegionId, setActiveRegionId] = useState('gale-msharp-nw');
  const [panel, setPanel] = useState('mission');
  const [layers, setLayers] = useState({
    terrain: true,
    elevation: true,
    geology: false,
    mineral: false,
    temperature: false,
    radiation: false,
    atmosphere: false,
    imagery: false,
    hazards: false,
    targets: true
  });
  const [included, setIncluded] = useState(new Set(['T1', 'T2', 'T3']));
  const [selTarget, setSelTarget] = useState(null);
  const [roverModalTarget, setRoverModalTarget] = useState(null);

  const [routes, setRoutes] = useState(null);
  const [recRoute, setRecRoute] = useState(null);
  const recRouteRef = useRef(null);
  const [stats, setStats] = useState({
    dist: '— km',
    eva: '—',
    targets: '0 / 3',
    avoided: '—',
    risk: '—',
    riskScore: 0,
    science: 0,
    riskObj: null
  });

  const [timelineNodes, setTimelineNodes] = useState([]);
  const [timelineFill, setTimelineFill] = useState(0);
  const [timelineTag, setTimelineTag] = useState('NO EVA PLANNED');

  const [cons, setCons] = useState({
    extraZones: [],
    removed: new Set(),
    blockSlope: 30,
    slopeMul: 1,
    comm: null,
    events: []
  });

  const [lastSim, setLastSim] = useState(null);
  const [hazardAlert, setHazardAlert] = useState(null);
  const [scanActive, setScanActive] = useState(false);
  const [scanText, setScanText] = useState('SCANNING ALTERNATIVES…');

  const [surfaceActive, setSurfaceActive] = useState(false);
  const [hudActive, setHudActive] = useState(false);
  const [hudData, setHudData] = useState({
    heading: 0,
    compassHeading: 'N 000°',
    px: 0,
    pz: 0
  });

  const [evaActive, setEvaActive] = useState(false);
  const [evaDebrief, setEvaDebrief] = useState(null);

  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.cons = cons;
    }
  }, [cons]);

  const [demoActive, setDemoActive] = useState(false);
  const [demoStep, setDemoStep] = useState({ n: 1, text: '', secs: 8 });

  const [aiOpen, setAiOpen] = useState(false);
  const [aiLog, setAiLog] = useState([
    {
      role: 'ai',
      text: 'MARS-X AI online.\nContext: Gale Crater · Mount Sharp NW · 3 targets · 8 hazard zones.\nAll values are SIMULATION DATA.'
    }
  ]);

  const [probeData, setProbeData] = useState(null);
  const [tabletMode, setTabletMode] = useState(false);
  const [fxHigh, setFxHigh] = useState(true);
  const [logs, setLogs] = useState([]);
  const [labels, setLabels] = useState([]);
  const [clockInfo, setClockInfo] = useState({ sol: 412, lmst: '06:00' });

  // Add Log Entry
  const addLog = useCallback((m, lv = '') => {
    const now = new Date();
    const sol = envRef.current ? envRef.current.sol : 412;
    const t = `SOL ${sol} · ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
    setLogs((prev) => {
      const next = [...prev, { m, lv, t }];
      return next.length > 200 ? next.slice(-200) : next;
    });
  }, []);

  // Update Stats Animation
  const updateStats = useCallback((r) => {
    if (!r) {
      setStats({
        dist: '— km',
        eva: '—',
        targets: '0 / 3',
        avoided: '—',
        risk: 'NO-GO',
        riskScore: 100,
        science: 0,
        riskObj: { t: 'NO-GO', c: 'c-crit', col: '#ff4a4a' }
      });
      return;
    }
    setStats({
      dist: (r.distM / 1000).toFixed(1) + ' km',
      eva: fmtHM(r.evaMin),
      targets: `${r.order.length} / ${storeRef.current.targets.length}`,
      avoided: String(Math.round(r.avoided)),
      risk: r.risk.t,
      riskScore: r.riskScore,
      science: Math.round(r.science),
      riskObj: r.risk
    });
  }, []);

  // Build Timeline Nodes
  const buildTimeline = useCallback((r) => {
    if (!r) {
      setTimelineNodes([]);
      setTimelineTag('NO EVA PLANNED');
      return;
    }
    const total = r.track[r.track.length - 1].t;
    const env = envRef.current || { lmstStart: 360 };
    setTimelineTag(
      `ROUTE ${r.id} · ${fmtHM(total)} · LMST ${fmtClock(env.lmstStart)}–${fmtClock(env.lmstStart + total)}`
    );

    const items = r.waypoints.filter((w) => w.type !== 'hazard');
    let lastF = -1;
    let alt = false;
    const nodes = items.map((w) => {
      const f = w.t / total;
      alt = f - lastF < 0.09 ? !alt : false;
      lastF = f;
      const nm =
        w.type === 'hab'
          ? w.end ? 'HABITAT' : 'DEPART HABITAT'
          : w.type === 'target'
          ? 'SCIENCE ' + w.name
          : w.name;
      return {
        key: `${w.name}-${w.t}`,
        t: w.t,
        leftPercent: (w.t / total) * 100,
        timeFormatted: fmtClock(env.lmstStart + w.t),
        name: nm,
        isTarget: w.type === 'target',
        alt
      };
    });
    setTimelineNodes(nodes);
    setTimelineFill(0);
  }, []);

  // Compute Routes
  const computeRoutes = useCallback((customIncluded = null, customCons = null) => {
    if (!routeEngineRef.current) return { routes: [], rec: null };
    const activeCons = customCons || cons;
    const ctx = routeEngineRef.current.context(activeCons);
    const activeIncluded = customIncluded || included;
    let avail = (storeRef.current.targets || []).filter(
      (t) => activeIncluded.has(t.id) && !activeCons.removed.has(t.id)
    );
    if (!avail.length && storeRef.current.targets && storeRef.current.targets.length) {
      avail = storeRef.current.targets.filter((t) => !activeCons.removed.has(t.id));
    }
    const calculated = VARIANTS.map((v) =>
      routeEngineRef.current.plan(v, ctx, avail, habRef.current)
    ).filter(Boolean);

    const ok = calculated.filter((r) => r.riskScore < 48);
    let best = null;
    let bs = -1;
    for (const r of ok) {
      const s = 0.45 * r.science + 0.35 * r.safety + 0.2 * r.eff;
      r.score = s;
      if (s > bs) {
        bs = s;
        best = r;
      }
    }
    calculated.forEach((r) => {
      if (r.score == null) r.score = 0.45 * r.science + 0.35 * r.safety + 0.2 * r.eff;
    });

    return { ctx, routes: calculated, rec: best || calculated[0] || null };
  }, [cons, included]);

  // Hazard Alert Trigger
  const hazardAlertPopup = useCallback((calcRoutes, rec) => {
    const risky = calcRoutes
      .filter((r) => r !== rec && r.entered.length)
      .sort((a, b) => b.riskScore - a.riskScore)[0];
    if (!risky) return;
    const z = [...risky.entered].sort((a, b) => b.level - a.level)[0];
    const at = rec.zoneAt ? rec.zoneAt[storeRef.current.hazards.indexOf(z)] : null;
    const dir = at ? dirWord(bearing(at.x - z.x, at.z - z.z)) : 'alternate';
    const word =
      {
        slope: 'steep slope',
        cliff: 'cliff scarp',
        sand: 'soft-sand dune field',
        rough: 'boulder field',
        crater: 'crater rim',
        channel: 'channel walls',
        blocked: 'obstruction'
      }[z.type] || 'hazard';

    setHazardAlert({
      title: `Route ${risky.id} (${risky.name.toLowerCase()}) approaching ${word}.`,
      hazardName: `${z.name} · ${LEVEL[z.level]}`,
      recommended: `Use alternate ${dir} approach (Route ${rec.id}).`,
      safetyImpact: `+${Math.max(0, rec.safety - risky.safety)}%`
    });

    addLog(`Hazard advisory: Route ${risky.id} enters ${z.name}; ${dir} approach recommended`, 'warn');
  }, [addLog]);

  // Plan Safe EVA
  const planEVA = useCallback(async ({ quick = false, silent = false } = {}) => {
    const engine = engineRef.current;
    if (!engine || engine.mode !== 'terrain' || engine.planning) return;
    if (engine.eva) {
      engine.stopEVA();
      setEvaActive(false);
    }
    engine.planning = true;

    if (!layers.targets) {
      setLayers((prev) => ({ ...prev, targets: true }));
      engine.setLayer('targets', true, cons);
    }

    if (!quick) {
      setScanText('ROUTE ENGINE · EVALUATING CANDIDATES');
      setScanActive(true);
    }
    addLog('Route engine: evaluating candidate EVAs (safety · slope · distance · science)');

    const t0 = performance.now();
    const res = computeRoutes();
    const dt = performance.now() - t0;

    if (!quick) await sleep(Math.max(0, 900 - dt));
    setScanActive(false);

    engine.clearRouteVis();
    if (!res.rec) {
      addLog('No safe route found — EVA not recommended', 'crit');
      engine.planning = false;
      updateStats(null);
      return;
    }

    const ROUTECOL = { A: 0xff6a4a, B: 0x5fe1ff, C: 0x7a8cff };
    for (const r of res.routes) {
      if (r === res.rec) continue;
      const v = engine.makeRouteVis(r, ROUTECOL[r.id], { radius: 0.09, opacity: 0.4 });
      engine.T.routeVis[r.id] = v;
      engine.animateRoute(v, quick ? 0.6 : 1.8);
    }

    const vr = engine.makeRouteVis(res.rec, 0x5fe1ff);
    engine.T.routeVis[res.rec.id] = vr;
    vr.mat.uniforms.uColor.value.set(0x6ff6ff);
    engine.activeRoute = res.rec;

    if (!quick && !engine.surface) engine.overview(2);
    engine.buildWaypoints(res.rec);
    const pr = engine.animateRoute(vr, quick ? 1 : 3.6);

    setRoutes(res.routes);
    setRecRoute(res.rec);
    recRouteRef.current = res.rec;
    updateStats(res.rec);
    buildTimeline(res.rec);
    if (!silent) setPanel('route');

    addLog(
      `Recommended: ROUTE ${res.rec.id} · ${(res.rec.distM / 1000).toFixed(2)} km · risk ${res.rec.risk.t} · science ${res.rec.science} (${Math.round(dt)} ms)`,
      'ok'
    );

    await pr;
    if (!quick && !silent) hazardAlertPopup(res.routes, res.rec);
    engine.planning = false;
  }, [computeRoutes, layers.targets, cons, addLog, updateStats, buildTimeline, hazardAlertPopup]);

  // Select Science Target
  const selectTarget = useCallback((id) => {
    const engine = engineRef.current;
    if (!engine || engine.mode !== 'terrain') return;
    const store = storeRef.current;
    const targetId = typeof id === 'object' ? id.id : id;
    const M = engine.T.markers.find((m) => m.t.id === targetId);
    const t = (M && M.t) || store.targets.find((x) => x.id === targetId);
    if (!t) return;

    setSelTarget(t);
    if (!layers.targets) {
      setLayers((prev) => ({ ...prev, targets: true }));
      engine.setLayer('targets', true, cons);
    }

    if (M) {
      engine.T.markers.forEach((m) =>
        gsap.to(m.g.scale, {
          x: m === M ? 1.7 : 1.25,
          y: m === M ? 1.7 : 1.25,
          z: m === M ? 1.7 : 1.25,
          duration: 0.6,
          ease: 'back.out(2)'
        })
      );
      engine.scanBurst(M);
    }

    if (!engine.surface) engine.flyToPoint(t.x, t.z, 30);
    addLog(`Target selected: ${t.code} ${t.name}`);
  }, [layers.targets, cons, addLog]);

  // Close Science Target Modal
  const closeTarget = useCallback(() => {
    setSelTarget(null);
    setRoverModalTarget(null);
    const engine = engineRef.current;
    if (engine) {
      engine.T.markers.forEach((m) =>
        gsap.to(m.g.scale, { x: 1.25, y: 1.25, z: 1.25, duration: 0.4 })
      );
    }
  }, []);

  // Toggle Target in Plan
  const toggleTargetIncluded = useCallback((id) => {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Enter Surface Mode
  const enterSurface = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || engine.mode !== 'terrain' || engine.surface) return;
    await engine.enterSurface(recRoute);
    setSurfaceActive(true);
    setHudActive(true);
  }, [recRoute]);

  // Exit Surface Mode
  const exitSurface = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || !engine.surface) return;
    engine.exitSurface();
    setSurfaceActive(false);
  }, []);

  // Toggle HUD
  const toggleHUD = useCallback((on) => {
    const next = on !== undefined ? on : !hudActive;
    const engine = engineRef.current;
    if (engine) {
      engine.toggleHUD(next);
    }
    setHudActive(next);
  }, [hudActive]);

  // Start EVA
  const startEVA = useCallback(async ({ dur = 48, follow = false, replay = false } = {}) => {
    const engine = engineRef.current;
    if (!engine || engine.mode !== 'terrain') return;
    let r = recRouteRef.current || recRoute;
    if (!r) {
      await planEVA({ quick: true, silent: true });
      r = recRouteRef.current;
      if (!r) return;
    }
    setEvaActive(true);
    setEvaDebrief(null);
    await engine.startEVA(r, { dur, follow, replay });
  }, [recRoute, planEVA]);

  // Stop EVA
  const stopEVA = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.stopEVA();
    setEvaActive(false);
    if (recRouteRef.current) {
      updateStats(recRouteRef.current);
    }
  }, [updateStats]);

  // Trigger Contingency Event
  const triggerEvent = useCallback(async (id) => {
    const engine = engineRef.current;
    if (!engine || engine.mode !== 'terrain') return;
    let prev = recRouteRef.current || recRoute;
    if (!prev) {
      await planEVA({ quick: true, silent: true });
      prev = recRouteRef.current;
      if (!prev) return;
    }
    if (engine.eva) stopEVA();
    setEvaDebrief(null);
    const store = storeRef.current;
    const env = envRef.current;
    const updatedCons = {
      ...cons,
      extraZones: [...cons.extraZones],
      removed: new Set(cons.removed),
      events: cons.events.includes(id) ? [...cons.events] : [...cons.events, id]
    };

    let note = '';
    const EVENTS = [
      { id: 'weather', t: '⚠ WEATHER CHANGE', d: 'Regional dust front: τ 0.6 → 1.8, visibility limits slope tolerance' },
      { id: 'unavailable', t: '⚠ TARGET UNAVAILABLE', d: 'Target 02 access corridor closed by science ops' },
      { id: 'blocked', t: '⚠ ROUTE BLOCKED', d: 'Rockfall obstructs the active route mid-traverse' },
      { id: 'terrain', t: '⚠ HIGH TERRAIN RISK', d: 'Fresh slump detected · max walkable slope 30° → 24°' },
      { id: 'comms', t: '⚠ COMMUNICATION LOSS', d: 'Relay down · operate within HAB-1 mast line-of-sight' }
    ];
    const ev = EVENTS.find((e) => e.id === id);

    switch (id) {
      case 'blocked': {
        let best = null;
        for (let i = 1; i < prev.stopIdx.length; i++) {
          const a = prev.stopIdx[i - 1];
          const b = prev.stopIdx[i];
          if (!best || b - a > best.b - best.a) best = { a, b };
        }
        const p = prev.line[Math.floor(lerp(best.a, best.b, 0.45))];
        const newZ = {
          id: 'X' + updatedCons.extraZones.length,
          name: 'ROCKFALL · ROUTE BLOCKED',
          type: 'blocked',
          x: p.x,
          z: p.z,
          r: 4.5,
          level: 4,
          desc: 'Impassable debris',
          sim: true
        };
        updatedCons.extraZones.push(newZ);
        const pd = prev.track.find((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.01);
        note = `Obstruction at route km ${pd ? (pd.d / 1000).toFixed(1) : '—'} · ${Math.round(Math.hypot(p.x - habRef.current.x, p.z - habRef.current.z) * MPU)} m from HAB-1`;
        break;
      }
      case 'weather': {
        updatedCons.extraZones.push({
          id: 'DUST',
          name: 'DUST FRONT · HIGH GROUND',
          type: 'dust',
          x: 24,
          z: -20,
          r: 22,
          level: 2,
          desc: 'Low visibility · exposed terrain',
          sim: true
        });
        updatedCons.blockSlope = Math.min(updatedCons.blockSlope, 26);
        env.dustTau = 1.8;
        env.windMs = 14.5;
        engine.weatherActive = true;
        setLayers((l) => ({ ...l, atmosphere: true }));
        gsap.to(engine.T.dust.material, { opacity: 0.9, duration: 2 });
        gsap.to(engine.terrainScene.fog, { density: 0.006, duration: 3 });
        break;
      }
      case 'unavailable':
        updatedCons.removed.add('T2');
        note = 'TARGET 02 removed from plan';
        break;
      case 'terrain': {
        updatedCons.blockSlope = Math.min(updatedCons.blockSlope, 24);
        updatedCons.slopeMul = 2;
        let p = null;
        for (let f = 0.25; f < 0.8 && !p; f += 0.03) {
          const q = prev.line[Math.floor(prev.line.length * f)];
          if (
            store.targets.every((t) => Math.hypot(t.x - q.x, t.z - q.z) > 8) &&
            Math.hypot(q.x - habRef.current.x, q.z - habRef.current.z) > 7
          ) {
            p = q;
          }
        }
        p = p || prev.line[Math.floor(prev.line.length * 0.3)];
        updatedCons.extraZones.push({
          id: 'SLUMP',
          name: 'FRESH SLUMP',
          type: 'slope',
          x: p.x + 1,
          z: p.z + 1,
          r: 4,
          level: 3,
          desc: 'Unstable regolith',
          sim: true
        });
        break;
      }
      case 'comms':
        updatedCons.comm = { x: habRef.current.x, z: habRef.current.z, r: 34 };
        engine.drawComm(updatedCons);
        break;
    }

    setCons(updatedCons);
    addLog(`SIM EVENT: ${ev.t.replace('⚠ ', '')} — ${ev.d}`, 'crit');

    // 1-2: Invalidate current route visuals
    const old = engine.T.routeVis[prev.id];
    Object.entries(engine.T.routeVis).forEach(([k, v]) => {
      if (v !== old) engine.disposeVis(v);
    });
    engine.T.routeVis = {};
    engine.clearWaypoints();

    if (old) {
      gsap.to(old.mat.uniforms.uBad, { value: 1, duration: 0.5 });
      gsap.to(old.mat.uniforms.uOpacity, { value: 0.55, duration: 0.5 });
      old.parts.visible = false;
    }

    const zg = updatedCons.extraZones.slice(-1)[0];
    if (zg && !engine.T.zones.some((Z) => Z.z === zg)) {
      const g = engine.addZoneVis(zg);
      setLayers((l) => ({ ...l, hazards: true }));
      g.visible = true;
      g.scale.set(1, 0.01, 1);
      gsap.to(g.scale, { y: 1, duration: 0.8 });
    }
    engine.updateHazardAttr(updatedCons);

    // Scan
    setScanText('SCANNING ALTERNATIVES…');
    setScanActive(true);
    engine.radarSweep(zg || { x: prev.line[0].x, z: prev.line[0].z });
    if (!engine.surface) await engine.overview(1.6);
    await sleep(1400);

    // Recompute
    const ctx = routeEngineRef.current.context(updatedCons);
    const avail = store.targets.filter(
      (t) => included.has(t.id) && !updatedCons.removed.has(t.id)
    );
    const calculated = VARIANTS.map((v) =>
      routeEngineRef.current.plan(v, ctx, avail, habRef.current)
    ).filter(Boolean);

    const ok = calculated.filter((r) => r.riskScore < 48);
    let best = null;
    let bs = -1;
    for (const r of ok) {
      const sc = 0.45 * r.science + 0.35 * r.safety + 0.2 * r.eff;
      r.score = sc;
      if (sc > bs) {
        bs = sc;
        best = r;
      }
    }

    setScanActive(false);
    if (old) {
      gsap.to(old.mat.uniforms.uOpacity, {
        value: 0,
        duration: 1.2,
        delay: 0.8,
        onComplete: () => engine.disposeVis(old)
      });
    }

    if (!best) {
      setLastSim({
        title: 'NO SAFE ALTERNATIVE',
        status: 'EVA ABORTED · RETURN TO HABITAT',
        desc: 'Safety rule: no route meets the risk threshold.'
      });
      updateStats(null);
      addLog('No safe alternative · EVA aborted', 'crit');
      return;
    }

    const ROUTECOL = { A: 0xff6a4a, B: 0x5fe1ff, C: 0x7a8cff };
    for (const a of calculated) {
      if (a === best) continue;
      const v = engine.makeRouteVis(a, ROUTECOL[a.id], { radius: 0.09, opacity: 0.35 });
      engine.T.routeVis[a.id] = v;
      engine.animateRoute(v, 1.2);
    }

    const nv = engine.makeRouteVis(best, 0x4dffa6);
    engine.T.routeVis[best.id] = nv;
    engine.activeRoute = best;
    engine.buildWaypoints(best);
    const pr = engine.animateRoute(nv, 3.4);

    if (!engine.surface) {
      const pts = [0.15, 0.5, 0.85].map((f) => best.line[Math.floor(best.line.length * f)]);
      (async () => {
        for (const p of pts) {
          const tgt = new THREE.Vector3(p.x, store.hU(p.x, p.z) + 1, p.z);
          const pos = tgt.clone().add(new THREE.Vector3(-14, 18, 16));
          await engine.camTo(pos, tgt, 1.25, 'power1.inOut');
        }
        engine.overview(1.6);
      })();
    }

    setRoutes(calculated);
    setRecRoute(best);
    recRouteRef.current = best;
    updateStats(best);
    buildTimeline(best);
    setPanel('sim');

    const dd = (best.distM - prev.distM) / 1000;
    const de = best.evaMin - prev.evaMin;
    const ds = best.safety - prev.safety;
    const dsc = prev.science ? Math.round(((best.science - prev.science) / prev.science) * 100) : 0;
    const sg = (v, d = 0) => (v >= 0 ? '+' : '−') + Math.abs(+v).toFixed(d);

    setLastSim({
      ev,
      prev,
      r: best,
      dd,
      de,
      ds,
      dsc,
      sg,
      note,
      status: `MISSION CONTINUES${best.order.length < prev.order.length ? ' · REDUCED SCOPE' : ''}`
    });

    addLog(
      `Reroute: ROUTE ${best.id} · Δdist ${sg(dd, 2)} km · Δsafety ${sg(ds)}% · Δscience ${sg(dsc)}%`,
      'ok'
    );
    await pr;
  }, [recRoute, cons, included, addLog, planEVA, stopEVA, updateStats, buildTimeline]);

  // Reset Contingencies
  const resetSim = useCallback(() => {
    const engine = engineRef.current;
    const cleanCons = {
      extraZones: [],
      removed: new Set(),
      blockSlope: 30,
      slopeMul: 1,
      comm: null,
      events: []
    };
    setCons(cleanCons);
    envRef.current.dustTau = 0.62;
    envRef.current.windMs = 6.2;
    if (engine) {
      engine.weatherActive = false;
      engine.T.zones
        .filter((Z) => Z.z.sim)
        .forEach((Z) => {
          engine.T.zoneGroup.remove(Z.g);
          engine.removeLabel(Z.lab);
        });
      engine.T.zones = engine.T.zones.filter((Z) => !Z.z.sim);
      if (engine.T.comm) {
        engine.terrainScene.remove(engine.T.comm);
        engine.T.comm = null;
      }
      engine.terrainScene.fog.density = 0.0026;
      if (layers.atmosphere) engine.T.dust.material.opacity = 0.45;
      engine.updateHazardAttr(cleanCons);
    }
    setLastSim(null);
    addLog('Simulation reset · nominal conditions', 'ok');
    planEVA({ quick: true });
  }, [layers.atmosphere, addLog, planEVA]);

  // AI Dialog
  const askAI = useCallback(async (q) => {
    if (!q || !q.trim()) return;
    setAiLog((prev) => [...prev, { role: 'user', text: q }]);
    await sleep(250);

    const a = answer(q, {
      store: storeRef.current,
      engine: routeEngineRef.current,
      state: { routes, rec: recRoute, cons, included },
      ENV: envRef.current,
      HAB: habRef.current,
      VARIANTS
    });

    addLog('AI query: ' + q);
    setAiLog((prev) => [...prev, { role: 'ai', text: a }]);
  }, [routes, recRoute, cons, included, addLog]);

  // Scripted Demo Walkthrough
  const runDemo = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || demoActive) return;
    setDemoActive(true);

    let active = true;
    const D = { cancel: () => { active = false; } };
    engine._demoD = D;

    const w = async (ms) => {
      const end = performance.now() + ms;
      while (performance.now() < end) {
        if (!active) throw new Error('cancel');
        await sleep(100);
      }
    };
    const step = (n, t, secs) => {
      if (!active) throw new Error('cancel');
      setDemoStep({ n, text: t, secs });
      addLog('DEMO · ' + t);
    };

    try {
      if (engine.mode === 'terrain') await returnToOrbit();
      if (engine.surface) exitSurface();

      step(1, 'MARS GLOBE · ORBITAL OVERVIEW', 8);
      if (mode === 'landing') enterMissionControl();
      engine.spin = true;
      await w(7000);

      step(2, 'REGION SELECTION · GALE CRATER', 4);
      setPanel('map');
      const gs = engine.G.sites.find((x) => x.s.primary);
      if (gs) {
        gsap.fromTo(gs.ring.scale, { x: 1, y: 1 }, { x: 3, y: 3, duration: 0.5, yoyo: true, repeat: 3 });
      }
      await w(3000);

      step(3, 'DESCENT · GALE CRATER → MOUNT SHARP', 12);
      await flyToGale();
      await w(1200);

      step(4, 'HOLOGRAPHIC DATA LAYERS', 14);
      for (const id of ['geology', 'mineral', 'temperature', 'radiation']) {
        setLayers((prev) => ({ ...prev, [id]: true }));
        engine.setLayer(id, true, cons);
        await w(2600);
      }
      for (const id of ['temperature', 'radiation', 'geology']) {
        setLayers((prev) => ({ ...prev, [id]: false }));
        engine.setLayer(id, false, cons);
      }
      await w(1200);

      step(5, 'SCIENCE TARGETS · TARGET 01 INSPECTION', 12);
      selectTarget('T1');
      await w(7000);
      closeTarget();
      await w(800);

      step(6, 'MISSION SAFETY LAYER · HAZARD DETECTION', 7);
      setLayers((prev) => ({ ...prev, hazards: true }));
      engine.setLayer('hazards', true, cons);
      setPanel('safety');
      engine.overview(2);
      await w(6000);

      step(7, 'ROUTE ENGINE · SAFETY → SCIENCE → EFFICIENCY', 7);
      await planEVA();
      await w(1500);

      step(8, 'ROUTE COMPARISON · ROUTE B OPTIMAL', 8);
      setPanel('route');
      await engine.camTo(AERIAL.pos, AERIAL.tgt, 2.5);
      await w(5000);
      setHazardAlert(null);

      step(9, 'MISSION INTELLIGENCE · AI RECOMMENDATION', 14);
      setAiOpen(true);
      await askAI('Which route has the lowest risk?');
      await w(3500);
      await askAI('Is Target 03 safe?');
      await w(5000);
      setAiOpen(false);

      step(10, 'SIMULATED HAZARD · ROUTE BLOCKED', 10);
      setPanel('sim');
      await triggerEvent('blocked');
      await w(2500);

      step(11, 'AUTOMATIC REROUTING · MISSION CONTINUES', 6);
      await w(5500);
      setLastSim(null);

      step(12, 'EVA EXECUTION · ASTRONAUT HUD · MISSION COMPLETE', 36);
      toggleHUD(true);
      await startEVA({ dur: 30, follow: true });
      await w(500);
      toggleHUD(false);
      await w(6000);

      setDemoStep({ n: 12, text: 'DEMO COMPLETE · EXPLORE FREELY', secs: 2.5 });
      await w(2500);
    } catch (e) {
      if (e.message !== 'cancel') console.error(e);
    } finally {
      setDemoActive(false);
      engine._demoD = null;
    }
  }, [
    demoActive, mode, cons, layers, selectTarget, closeTarget,
    planEVA, askAI, triggerEvent, toggleHUD, startEVA, addLog
  ]);

  const stopDemo = useCallback(() => {
    if (engineRef.current && engineRef.current._demoD) {
      engineRef.current._demoD.cancel();
      stopEVA();
      setDemoActive(false);
      addLog('Demo exited');
    }
  }, [stopEVA, addLog]);

  // Flow: Enter Mission Control
  const enterMissionControl = useCallback((explore = false) => {
    const engine = engineRef.current;
    if (!engine) return;
    setMode('globe');
    engine.mode = 'globe';
    gsap.to(engine, {
      viewShift: 0,
      duration: 1.6,
      ease: 'power3.inOut',
      onUpdate: () => engine.applyViewShift()
    });
    engine.configGlobeControls();
    engine.camTo(new THREE.Vector3(0, 0.4, explore ? 3.4 : 3.7), new THREE.Vector3(), 1.6).then(() => {
      engine.controls.enabled = true;
    });
    setPanel('map');
    addLog('Mission control online · orbital view', 'ok');
  }, [addLog]);

  // Flow: Select exploration region on Mars globe
  const selectRegion = useCallback((id) => {
    setSelectedRegionId(id);
    const reg = REGIONS_CONFIG[id];
    if (reg) {
      addLog(`Exploration region selected: ${reg.name} · coordinates ${Math.abs(reg.lat).toFixed(1)}°${reg.lat < 0 ? 'S' : 'N'} ${Math.abs(reg.lon).toFixed(1)}°${reg.lon < 0 ? 'W' : 'E'}`, 'ok');
    }
    const engine = engineRef.current;
    if (engine) {
      if (engine.mode === 'landing') {
        enterMissionControl();
      }
      if (engine.mode === 'globe' || engine.mode === 'landing') {
        engine.focusSite(id, 1.8);
      }
    }
  }, [addLog, enterMissionControl]);

  // Flow: Descend to selected exploration region
  const descendToRegion = useCallback(async (targetId = selectedRegionId) => {
    const engine = engineRef.current;
    if (!engine || engine.busy) return;
    const reg = REGIONS_CONFIG[targetId] || REGIONS_CONFIG['gale-msharp-nw'];
    engine.busy = true;
    addLog(`Initiating descent into ${reg.name} · ${reg.sector}`, 'ok');

    if (engine.surface) exitSurface();
    if (hudActive || engine.hud) toggleHUD(false);
    stopEVA();

    const flashEl = document.querySelector('#flash');

    // Safety timeout: Ensure flash overlay and engine busy state never get stuck
    const safetyTimer = setTimeout(() => {
      if (flashEl && flashEl.style.display !== 'none') {
        flashEl.style.opacity = '0';
        flashEl.style.display = 'none';
      }
      if (engine) engine.busy = false;
    }, 5000);

    try {
      if (engine.mode === 'globe' || engine.mode === 'landing') {
        engine.spin = false;
        engine.controls.enabled = false;

        const siteObj = (engine.G.sites || []).find((x) => x.s.id === targetId);
        const m = new THREE.Vector3();
        if (siteObj) {
          siteObj.g.getWorldPosition(m);
        } else if (engine.G.gale) {
          engine.G.gale.getWorldPosition(m);
        }

        const dir = m.lengthSq() > 0.001 ? m.clone().normalize() : new THREE.Vector3(0, 0, 1);
        const s0 = engine.camera.position.clone().normalize();
        const r0 = engine.camera.position.length();
        const q = new THREE.Quaternion().setFromUnitVectors(s0, dir);
        const I = new THREE.Quaternion();
        const qs = new THREE.Quaternion();
        const look = new THREE.Vector3();
        const t0 = engine.controls.target.clone();

        await tween(1.8, (t) => {
          qs.slerpQuaternions(I, q, t);
          engine.camera.position.copy(s0).applyQuaternion(qs).multiplyScalar(lerp(r0, 2.2, t));
          look.lerpVectors(t0, new THREE.Vector3(), t);
          engine.camera.lookAt(look);
        }, 'power2.inOut');

        // Reticle Lock
        const lockEl = document.querySelector('#lock');
        if (lockEl) {
          gsap.fromTo(lockEl, { opacity: 0, scale: 1.8 }, { opacity: 1, scale: 1, duration: 0.4, ease: 'power3.out' });
          const txt = lockEl.querySelector('span');
          if (txt) {
            txt.textContent = `TARGET LOCK · ${reg.name.toUpperCase()} · ${Math.abs(reg.lat).toFixed(1)}°${reg.lat < 0 ? 'S' : 'N'} ${Math.abs(reg.lon).toFixed(1)}°${reg.lon < 0 ? 'W' : 'E'}`;
          }
        }

        await tween(1.4, (t) => {
          engine.camera.position.copy(dir).multiplyScalar(lerp(2.2, 1.09, t * t));
          look.lerpVectors(new THREE.Vector3(), m, smooth(0, 0.6, t));
          engine.camera.lookAt(look);
        }, 'power2.in');

        if (lockEl) gsap.to(lockEl, { opacity: 0, duration: 0.3 });
      } else {
        // In terrain mode already - camera rise before flash
        await engine.camTo(new THREE.Vector3(10, 160, 40), new THREE.Vector3(0, 0, 0), 1.0, 'power2.in');
      }

      // Transition Flash
      if (flashEl) {
        const flT1 = document.querySelector('#flT1');
        const flT2 = document.querySelector('#flT2');
        if (flT1) flT1.textContent = `ENTERING ${reg.name.toUpperCase()}`;
        if (flT2) flT2.textContent = `DESCENT TO ${reg.sector.toUpperCase()} · TERRAIN MODEL LOADING`;
        flashEl.style.display = 'flex';
        await new Promise((r) => gsap.to(flashEl, { opacity: 1, duration: 0.4, onComplete: r }));
      }

      // Load Region Datasets
      const provider = providerRef.current;
      const store = storeRef.current;
      const tData = await provider.getTerrain(targetId);
      const gData = await provider.getGeology(targetId, { N: tData.N });
      const sData = await provider.getSpectral(targetId, { N: tData.N });
      const thData = await provider.getThermal(targetId, { N: tData.N, elevM: tData.elevM });
      const rData = await provider.getRadiation(targetId, { N: tData.N, elevM: tData.elevM });
      const envData = await provider.getEnvironment(targetId);
      const hzData = await provider.getHazards(targetId);
      const tgData = await provider.getScienceTargets(targetId);
      const habData = await provider.getHabitat(targetId);

      store.setRegion(targetId);
      store.setTerrain(tData);
      store.geo = gData.units;
      store.geoTable = gData.table;
      store.spectral = sData;
      store.thermal = thData;
      store.radiation = rData;
      store.hazards = hzData.map((h) => DataNormalizer.hazard(h));
      store.targets = tgData.map((t) => DataNormalizer.pointToScene(t));
      store.hab = DataNormalizer.pointToScene(habData);
      habRef.current = store.hab;
      envRef.current = envData;
      routeEngineRef.current = new RouteEngine(store);

      // Rebuild 3D Scene
      await engine.rebuildTerrainScene(store, store.hab, envData);
      engine.setScene(engine.terrainScene);
      engine.mode = 'terrain';
      setMode('terrain');
      setActiveRegionId(targetId);
      setSelectedRegionId(targetId);
      const newIncluded = new Set(store.targets.map((t) => t.id));
      setIncluded(newIncluded);

      // Immediately pre-populate optimal route stats so Stats Bar is never empty
      const initRes = computeRoutes(newIncluded);
      if (initRes && initRes.rec) {
        setRoutes(initRes.routes);
        setRecRoute(initRes.rec);
        recRouteRef.current = initRes.rec;
        updateStats(initRes.rec);
        buildTimeline(initRes.rec);
      } else {
        updateStats(null);
      }

      setLastSim(null);
      setHazardAlert(null);
      setEvaDebrief(null);

      engine.configTerrainControls();
      engine.camera.position.set(8, 200, 40);
      engine.controls.target.set(-2, 0, -4);
      engine.camera.lookAt(engine.controls.target);

      // Apply active layers
      Object.entries(layers).forEach(([layerId, on]) => {
        if (on) engine.setLayer(layerId, true, cons);
      });

      setPanel('mission');
      addLog(`Terrain model loaded · ${reg.name} · ${reg.sector}`, 'ok');

      // Camera descent into aerial perspective
      await engine.camTo(AERIAL.pos, AERIAL.tgt, 1.8, 'power3.out');
    } catch (err) {
      console.error('Descent error caught:', err);
      addLog(`Descent notice: ${err.message || 'transition completed'}`, 'warn');
    } finally {
      clearTimeout(safetyTimer);
      if (flashEl) {
        gsap.to(flashEl, {
          opacity: 0,
          duration: 0.6,
          onComplete: () => {
            flashEl.style.display = 'none';
          }
        });
      }
      engine.busy = false;
    }

    // Auto-prime optimal safe EVA plan safely in background
    try {
      await planEVA({ quick: true, silent: true });
    } catch (e) {
      console.warn('Auto-prime EVA plan notice:', e);
    }
  }, [selectedRegionId, layers, cons, addLog, updateStats, buildTimeline, exitSurface, toggleHUD, stopEVA, hudActive, planEVA, computeRoutes]);

  // Backward compatibility alias for demo walkthrough
  const flyToGale = useCallback((id = 'gale-msharp-nw') => descendToRegion(id), [descendToRegion]);

  // Flow: Return to Orbit
  const returnToOrbit = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || engine.mode !== 'terrain' || engine.busy) return;
    if (engine.surface) exitSurface();
    if (hudActive || engine.hud) toggleHUD(false);
    stopEVA();
    engine.busy = true;

    const flashEl = document.querySelector('#flash');
    const safetyTimer = setTimeout(() => {
      if (flashEl && flashEl.style.display !== 'none') {
        flashEl.style.opacity = '0';
        flashEl.style.display = 'none';
      }
      if (engine) engine.busy = false;
    }, 4000);

    try {
      await engine.camTo(new THREE.Vector3(10, 210, 40), new THREE.Vector3(0, 0, 0), 1.4, 'power2.in');
      if (flashEl) {
        flashEl.style.display = 'flex';
        await new Promise((r) => gsap.to(flashEl, { opacity: 1, duration: 0.4, onComplete: r }));
      }

      engine.setScene(engine.globeScene);
      engine.mode = 'globe';
      setMode('globe');
      closeTarget();
      setLastSim(null);
      setHazardAlert(null);

      engine.configGlobeControls();
      const siteObj = (engine.G.sites || []).find((x) => x.s.id === selectedRegionId) || (engine.G.sites || [])[0];
      const m = new THREE.Vector3();
      if (siteObj) {
        siteObj.g.getWorldPosition(m);
      } else if (engine.G.gale) {
        engine.G.gale.getWorldPosition(m);
      }
      engine.camera.position.copy(m.clone().normalize().multiplyScalar(1.3));
      engine.camera.lookAt(0, 0, 0);

      if (flashEl) {
        gsap.to(flashEl, {
          opacity: 0,
          duration: 0.6,
          onComplete: () => {
            flashEl.style.display = 'none';
          }
        });
      }
      await engine.camTo(m.clone().normalize().multiplyScalar(3.1), new THREE.Vector3(), 1.8, 'power3.out');

      engine.controls.enabled = true;
      engine.spin = true;
      setPanel('map');
      addLog('Returned to orbital view');
    } catch (err) {
      console.error('Return to orbit error:', err);
    } finally {
      clearTimeout(safetyTimer);
      if (flashEl) {
        flashEl.style.opacity = '0';
        flashEl.style.display = 'none';
      }
      engine.busy = false;
    }
  }, [exitSurface, toggleHUD, stopEVA, closeTarget, selectedRegionId, addLog]);

  // Toggle Layer
  const toggleLayer = useCallback((id, value) => {
    const engine = engineRef.current;
    const nextVal = value !== undefined ? value : !layers[id];
    setLayers((prev) => ({ ...prev, [id]: nextVal }));
    if (engine) engine.setLayer(id, nextVal, cons);
    addLog(`Layer ${nextVal ? 'enabled' : 'disabled'}: ${id}`);
  }, [layers, cons, addLog]);

  // Tablet & FX Toggles
  const toggleTablet = useCallback(() => {
    setTabletMode((prev) => {
      const next = !prev;
      document.body.classList.toggle('tablet', next);
      return next;
    });
  }, []);

  const toggleFX = useCallback(() => {
    setFxHigh((prev) => {
      const next = !prev;
      const engine = engineRef.current;
      if (engine) {
        engine.fx = next;
        engine.renderer.shadowMap.enabled = next;
        engine.renderer.setPixelRatio(next ? Math.min(window.devicePixelRatio || 1, 1.75) : 1);
        document.body.classList.toggle('reduced', !next);
        engine.terrainScene.traverse((o) => {
          if (o.material) o.material.needsUpdate = true;
        });
      }
      addLog('Visual effects: ' + (next ? 'high' : 'reduced (weaker hardware)'));
      return next;
    });
  }, [addLog]);

  // Finish EVA Debrief
  const finishEVACallback = useCallback((e) => {
    const r = e.r;
    setEvaActive(false);
    setTimelineFill(100);
    updateStats(r);
    addLog(`EVA complete · EV-1 ingress HAB-1 · ${(r.distM / 1000).toFixed(2)} km`, 'ok');
    const store = storeRef.current;
    const obs =
      r.order.reduce((a, id) => a + store.targets.find((t) => t.id === id).instr.length + 1, 0) +
      Math.round(r.hot / 25);
    const sciRet = Math.round(
      (r.science / Math.max(1, r.science)) * 100
    );

    setEvaDebrief({
      route: r,
      distKm: (r.distM / 1000).toFixed(1),
      targetsCount: r.order.length,
      observations: obs,
      hazardsAvoided: r.avoided,
      evaTimeFormatted: fmtHM(r.evaMin),
      scienceReturnPercent: clamp(sciRet, 0, 100),
      safetyScore: r.safety,
      elevGainM: Math.round(r.gain),
      contingencyCount: cons.events.length
    });
  }, [cons.events, addLog, updateStats]);

  // Initial Boot
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const store = storeRef.current;
    const provider = providerRef.current;

    const engine = new MarsXEngine(
      canvas,
      (activeLabels) => setLabels(activeLabels),
      (hudUpdate) => setHudData(hudUpdate),
      addLog
    );
    engineRef.current = engine;
    engine.onSelectTarget = (id) => selectTarget(id);
    engine.onShowRover = (t) => setRoverModalTarget(t);
    engine.onFinishEVA = (e) => finishEVACallback(e);
    engine.onEvaTick = (evaData) => {
      setTimelineFill(evaData.t * 100);
      setStats({
        dist: `${(evaData.distTraversed / 1000).toFixed(2)} / ${(evaData.totalDist / 1000).toFixed(1)} km`,
        eva: `T+${Math.round(evaData.tm)}m · REM ${fmtHM(Math.max(0, evaData.evaMin - evaData.tm))}`,
        targets: `${evaData.visitedCount} / ${evaData.totalTargets}`,
        avoided: String(Math.round(evaData.avoided || 0)),
        risk: evaData.risk,
        riskScore: 100 - (evaData.safetyPct || 85),
        science: evaData.science,
        safetyPct: evaData.safetyPct,
        riskObj: evaData.riskObj
      });

      // Periodically record live telemetry packet in Mission Log
      if (!engine._lastLogTm || Math.abs(evaData.tm - engine._lastLogTm) >= 14) {
        engine._lastLogTm = evaData.tm;
        const p = evaData.p || { x: 0, z: 0 };
        const ll = DataNormalizer.localToLatLon(p.x * MPU, p.z * MPU, selectedRegionId);
        addLog(
          `[REC TELEMETRY] EV-1 GPS ${Math.abs(ll.lat).toFixed(4)}°${ll.lat < 0 ? 'S' : 'N'} ${Math.abs(ll.lon).toFixed(4)}°${ll.lon < 0 ? 'W' : 'E'} · ${(evaData.distTraversed / 1000).toFixed(2)} km traversed · Risk: ${evaData.risk}`,
          evaData.risk === 'CRITICAL' ? 'crit' : evaData.risk === 'CAUTION' ? 'warn' : 'ok'
        );
      }
    };
    engine.onSiteClick = (s) => {
      selectRegion(s.id);
    };
    engine.onProbe = (point) => {
      const x = point.x;
      const z = point.z;
      const ll = DataNormalizer.localToLatLon(x * MPU, z * MPU);
      let nearestH = null;
      for (const zn of [...store.hazards, ...cons.extraZones]) {
        const d = Math.hypot(x - zn.x, z - zn.z) - zn.r;
        if (!nearestH || d < nearestH.d) nearestH = { z: zn, d };
      }
      setProbeData({
        lat: Math.abs(ll.lat).toFixed(4) + '°S',
        lon: Math.abs(ll.lon).toFixed(4) + '°E',
        elev: Math.round(store.eM(x, z)),
        slope: store.slope(x, z).toFixed(1),
        unit: GEO_UNITS[store.unit(x, z)].name,
        spectral: store.mineral(x, z).toFixed(2),
        temp: store.temp(x, z).toFixed(1),
        rad: store.rad(x, z).toFixed(2),
        hazard: nearestH ? (nearestH.d < 0 ? nearestH.z.name : 'clear · ' + Math.round(nearestH.d * MPU) + ' m') : 'clear'
      });
    };

    // Run Engine Loop
    engine.loop();

    // Boot Sequence
    const steps = [
      {
        name: 'Loading terrain data',
        fn: async () => {
          const t = await provider.getTerrain(REGION.id, { N: 257 });
          store.setTerrain(t);
          const geo = await provider.getGeology(REGION.id, { N: t.N });
          store.geo = geo.units;
          store.geoTable = geo.table;
          store.spectral = await provider.getSpectral(REGION.id, { N: t.N });
        }
      },
      {
        name: 'Loading orbital imagery',
        fn: async () => {
          const regions = await provider.listRegions();
          await engine.buildGlobe(regions);
        }
      },
      {
        name: 'Loading science data',
        fn: async () => {
          store.targets = (await provider.getScienceTargets(REGION.id)).map(DataNormalizer.pointToScene);
          habRef.current = DataNormalizer.pointToScene(await provider.getHabitat());
          store.hab = habRef.current;
        }
      },
      {
        name: 'Loading environmental data',
        fn: async () => {
          store.thermal = await provider.getThermal(REGION.id, { N: store.N, elevM: store.elevM });
          store.radiation = await provider.getRadiation(REGION.id, { N: store.N, elevM: store.elevM });
          envRef.current = await provider.getEnvironment(REGION.id);
          store.hazards = (await provider.getHazards(REGION.id)).map(DataNormalizer.hazard);
        }
      },
      {
        name: 'Loading mission model',
        fn: async () => {
          await engine.buildTerrainScene(store, habRef.current, envRef.current);
        }
      },
      {
        name: 'Loading route engine',
        fn: async () => {
          routeEngineRef.current = new RouteEngine(store);
        }
      }
    ];

    setBootRows(steps.map((s) => ({ name: s.name, status: 'pending' })));

    (async () => {
      for (let i = 0; i < steps.length; i++) {
        setBootRows((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, status: 'loading' } : r))
        );
        await sleep(60);
        await steps[i].fn();
        setBootRows((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, status: 'done' } : r))
        );
        setBootProgress(((i + 1) / steps.length) * 100);
      }
      setBootReady(true);
      await sleep(600);

      // Enter Landing Mode
      setMode('landing');
      engine.mode = 'landing';
      engine.viewShift = -window.innerWidth * 0.22;
      engine.applyViewShift();
      engine.camera.position.set(0, 0.35, 4.4);
      engine.camera.lookAt(0, 0, 0);

      gsap.from(engine.camera.position, {
        z: 7,
        duration: 3,
        ease: 'power3.out',
        onUpdate: () => engine.camera.lookAt(0, 0, 0)
      });

      addLog(`MARS-X initialised · provider: ${provider.name} (SIMULATION DATA)`, 'ok');
    })();

    // Sol Clock Interval
    const clockInt = setInterval(() => {
      if (!envRef.current) return;
      const now = new Date();
      const m =
        envRef.current.lmstStart +
        (((now.getMinutes() * 60 + now.getSeconds()) % 600) / 10) * 6;
      setClockInfo({
        sol: envRef.current.sol,
        lmst: fmtClock(engine.eva ? envRef.current.lmstStart + (engine.eva.min || 0) : m)
      });
    }, 1000);

    return () => {
      clearInterval(clockInt);
      engine.destroy();
    };
  }, []); // Run once on mount

  return (
    <MarsContext.Provider
      value={{
        canvasRef,
        engineRef,
        storeRef,
        providerRef,
        nasaRef,
        routeEngineRef,
        habRef,
        envRef,
        bootProgress,
        bootReady,
        bootRows,
        mode,
        panel,
        setPanel,
        layers,
        toggleLayer,
        included,
        toggleTargetIncluded,
        selTarget,
        selectTarget,
        closeTarget,
        roverModalTarget,
        setRoverModalTarget,
        routes,
        recRoute,
        stats,
        timelineNodes,
        timelineFill,
        timelineTag,
        cons,
        lastSim,
        setLastSim,
        hazardAlert,
        setHazardAlert,
        scanActive,
        scanText,
        surfaceActive,
        enterSurface,
        exitSurface,
        hudActive,
        toggleHUD,
        hudData,
        evaActive,
        startEVA,
        stopEVA,
        evaDebrief,
        setEvaDebrief,
        demoActive,
        demoStep,
        runDemo,
        stopDemo,
        aiOpen,
        setAiOpen,
        aiLog,
        askAI,
        probeData,
        setProbeData,
        tabletMode,
        toggleTablet,
        fxHigh,
        toggleFX,
        logs,
        labels,
        clockInfo,
        enterMissionControl,
        selectedRegionId,
        setSelectedRegionId,
        activeRegionId,
        selectRegion,
        descendToRegion,
        REGIONS_CONFIG,
        flyToGale,
        returnToOrbit,
        planEVA,
        triggerEvent,
        resetSim
      }}
    >
      {children}
    </MarsContext.Provider>
  );
};

export const useMars = () => {
  const ctx = useContext(MarsContext);
  if (!ctx) throw new Error('useMars must be used within MarsProvider');
  return ctx;
};
