import { GEO_UNITS, LEVEL, MPU } from './dataProvider.js';
import { STOP_MIN } from './routeEngine.js';
import { dirWord, bearing, fmtHM, fmtClock } from './math.js';

export const CHIPS = [
  'Is Target 03 safe?',
  'Why is Target 01 scientifically important?',
  'Which route has the lowest risk?',
  'What happens if Target 02 becomes unavailable?',
  'How long will this EVA take?',
  'What terrain should we expect?'
];

export function explain(routes, rec, store) {
  if (!rec) return 'No candidate meets the astronaut-safety threshold. EVA should not proceed.';
  const L = [
    `Route ${rec.id} provides the best balance between astronaut safety (${rec.safety}%), EVA distance (${(rec.distM / 1000).toFixed(1)} km) and scientific return (${rec.science}/100).`
  ];
  for (const r of routes) {
    if (r === rec) continue;
    if (r.riskScore >= 48) {
      const z = r.entered[0];
      L.push(
        `Route ${r.id} rejected — ${r.risk.t} risk${z ? ` (enters ${z.name})` : ''}. Safety outranks its ${r.science}/100 science value.`
      );
    } else if (r.science < rec.science) {
      const miss = store.targets
        .filter((t) => rec.order.includes(t.id) && !r.order.includes(t.id))
        .map((t) => t.code);
      L.push(
        `Route ${r.id} is ${r.safety > rec.safety ? `safer (+${r.safety - rec.safety}%) but` : ''} returns less science (${r.science}/100${miss.length ? `, omits ${miss.join(', ')}` : ''}).`
      );
    } else {
      L.push(`Route ${r.id} scores lower overall (${Math.round(r.score)} vs ${Math.round(rec.score)}).`);
    }
  }
  return L.join('\n');
}

export function answer(q, { store, engine, state, ENV, HAB, VARIANTS }) {
  const s = q.toLowerCase();
  const m = s.match(/target\s*0?(\d)/);
  const tg = m ? store.targets.find((t) => t.id === 'T' + m[1]) : null;

  let routes = state.routes;
  let rec = state.rec;
  let preview = false;

  if (!routes && engine) {
    const ctx = engine.context(state.cons);
    const avail = store.targets.filter((t) => state.included.has(t.id) && !state.cons.removed.has(t.id));
    routes = VARIANTS.map((v) => engine.plan(v, ctx, avail, HAB)).filter(Boolean);
    const ok = routes.filter((r) => r.riskScore < 48);
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
    rec = best;
    preview = true;
  }

  const pre = preview ? '(route not yet committed · computed preview)\n' : '';

  const approach = (t) => {
    if (!rec) return null;
    const w = rec.waypoints.find((wp) => wp.target && wp.target.id === t.id);
    if (!w) return null;
    const tr = rec.track.filter((p) => p.d < w.d && p.d > w.d - 500);
    const p = tr[0] || rec.track[0];
    return dirWord(bearing(p.x - t.x, p.z - t.z)).replace('ern', '').toUpperCase();
  };

  if (tg && /(unavailable|lose|lost|without|skip|drop|remove|cancel)/.test(s)) {
    if (!engine) return 'Engine not yet loaded.';
    const ctx = engine.context({ ...state.cons, removed: new Set([...state.cons.removed, tg.id]) });
    const avail = store.targets.filter(
      (t) => state.included.has(t.id) && t.id !== tg.id && !state.cons.removed.has(t.id)
    );
    const rs = VARIANTS.map((v) => engine.plan(v, ctx, avail, HAB)).filter(Boolean);
    const ok = rs.filter((r) => r.riskScore < 48);
    let nr = null;
    let bs = -1;
    for (const r of ok) {
      const sc = 0.45 * r.science + 0.35 * r.safety + 0.2 * r.eff;
      if (sc > bs) {
        bs = sc;
        nr = r;
      }
    }
    if (!nr) return `${tg.code} removal leaves no safe candidate.\nRecommendation: hold EVA.`;
    return `${pre}What-if: ${tg.code} unavailable.\nNew optimal: ROUTE ${nr.id} (${nr.name}).\nDistance: ${(nr.distM / 1000).toFixed(1)} km (${rec ? ((nr.distM - rec.distM) / 1000 >= 0 ? '+' : '') + ((nr.distM - rec.distM) / 1000).toFixed(1) + ' km' : ''}).\nEVA time: ${fmtHM(nr.evaMin)}.\nScience value: ${nr.science}/100${rec ? ` (${nr.science - rec.science} pts)` : ''}.\nRisk: ${nr.risk.t}.\nRecommendation: mission continues with reduced scope. Run SIMULATION › TARGET UNAVAILABLE to apply.`;
  }

  if (tg && /(safe|risk|danger|hazard|approach)/.test(s)) {
    const sl = store.slope(tg.x, tg.z);
    let nearestH = null;
    for (const zn of [...store.hazards, ...state.cons.extraZones]) {
      const d = Math.hypot(tg.x - zn.x, tg.z - zn.z) - zn.r;
      if (!nearestH || d < nearestH.d) nearestH = { z: zn, d };
    }
    const diff = sl > 14 || (nearestH && nearestH.d < 4) ? 'MODERATE' : 'LOW';
    const ap = approach(tg);
    let legM = 0;
    if (rec) {
      const w = rec.waypoints.find((wp) => wp.target && wp.target.id === tg.id);
      if (w) {
        const i = rec.waypoints.indexOf(w);
        let pv = null;
        for (let k = i - 1; k >= 0; k--) {
          if (['target', 'hab'].includes(rec.waypoints[k].type)) {
            pv = rec.waypoints[k];
            break;
          }
        }
        legM = w.t - (pv ? (pv.depart ?? pv.t) : 0);
      }
    }
    return `${pre}${tg.code} has ${diff.toLowerCase()} terrain difficulty.\nLocal slope: ${sl.toFixed(1)}°. Nearest hazard: ${nearestH?.z.name} (${LEVEL[nearestH?.z.level]}) at ${Math.max(0, Math.round(nearestH.d * MPU))} m.\n${ap ? `Recommended approach:\n${ap} corridor.\n` : ''}${legM ? `Estimated walking time:\n${Math.round(legM)} minutes.\n` : ''}Scientific value:\n${tg.priority}.\nRecommendation:\n${rec && rec.order.includes(tg.id) ? `Proceed using Route ${rec.id}.` : rec ? `Not on Route ${rec.id} — excluded to protect crew safety.` : 'No safe route available.'}`;
  }

  if (tg && /(why|important|value|scien|objective|study)/.test(s)) {
    return `${tg.code} · ${tg.name}\nObjective: ${tg.objective}\nWhy it matters: ${tg.feature.toLowerCase()} — ${tg.kind === 'clay' ? 'clay minerals form when liquid water alters rock, so this outcrop records past water–rock interaction and habitability.' : tg.kind === 'layer' ? 'stacked lake sediments preserve a time-ordered record of how the ancient lake rose, fell and dried.' : 'a contact between units marks a change in environment; sampling both sides brackets when conditions shifted.'}\nSpectral index: ${store.mineral(tg.x, tg.z).toFixed(2)} · value ${'★'.repeat(tg.stars)}.\nPriority: ${tg.priority}.`;
  }

  if (/(lowest risk|least risk|safest|minimum risk)/.test(s)) {
    if (!routes || !routes.length) return 'No routes computed yet.';
    const r = [...routes].sort((a, b) => a.riskScore - b.riskScore)[0];
    return `${pre}Lowest risk: ROUTE ${r.id} (${r.name}).\nRisk: ${r.risk.t} · safety ${r.safety}%.\nDistance: ${(r.distM / 1000).toFixed(1)} km · science ${r.science}/100.\n${rec && r !== rec ? `Note: Route ${rec.id} remains OPTIMAL — ${r.id} sacrifices ${rec.science - r.science} science pts for +${r.safety - rec.safety}% safety.` : 'It is also the recommended route.'}`;
  }

  if (/(which route|best route|recommend|optimal|compare)/.test(s)) {
    if (!rec) return 'No route meets the safety threshold. Recommendation: do not proceed.';
    return `${pre}ROUTE ${rec.id} — OPTIMAL\n${routes.map((r) => `ROUTE ${r.id}: ${(r.distM / 1000).toFixed(1)} km · risk ${r.risk.t} · science ${r.science}`).join('\n')}\n\n${explain(routes, rec, store)}`;
  }

  if (/(how long|duration|eva time|take|timeline|schedule)/.test(s)) {
    if (!rec) return 'No safe EVA available.';
    return `${pre}Estimated EVA (Route ${rec.id}): ${fmtHM(rec.evaMin)}.\nWalking: ${fmtHM(rec.walkMin)} · sampling: ${rec.order.length} × ${STOP_MIN} min.\nDepart ${fmtClock(ENV.lmstStart)} LMST → return ${fmtClock(ENV.lmstStart + rec.evaMin)} LMST.\nO₂ at ingress (model): ~${Math.round(98 - rec.evaMin * 0.055)}%. Sunset ${ENV.sunset} — margin ${fmtHM(18 * 60 + 4 - ENV.lmstStart - rec.evaMin)}.`;
  }

  if (/(terrain|expect|surface|ground|slope)/.test(s)) {
    if (!rec) return 'Terrain data loaded; no safe route.';
    const units = new Map();
    rec.line.forEach((p, i) => {
      if (i % 6) return;
      const u = store.unit(p.x, p.z);
      units.set(u, (units.get(u) || 0) + 1);
    });
    const tot = [...units.values()].reduce((a, b) => a + b, 0);
    return `${pre}Terrain along Route ${rec.id}:\nElevation gain: ${Math.round(rec.gain)} m · max slope ${rec.maxSlope.toFixed(1)}°.\nSurface units:\n${[...units.entries()].sort((a, b) => b[1] - a[1]).map(([u, n]) => `  ${Math.round((n / tot) * 100)}% ${GEO_UNITS[u].name}`).join('\n')}\nExpect ridge crossing at a low pass, terraced mudstone near targets and scattered float rock.`;
  }

  if (/(hazard|danger|avoid)/.test(s)) {
    if (!rec) return 'All candidates exceed risk threshold.';
    const near = rec.waypoints.filter((w) => w.type === 'hazard');
    return `${pre}Route ${rec.id} avoids ${rec.avoided} hazard zone(s) on the direct lines.\n${near.length ? 'Closest approaches:\n' + near.map((w) => `  ${w.zone.name} · ${LEVEL[w.zone.level]} · clearance ${Math.round(w.clear)} m`).join('\n') : 'No close approaches.'}\nCritical zones are hard-blocked by the route engine.`;
  }

  if (/(oxygen|o2|consumable|suit)/.test(s)) {
    const m = rec ? rec.evaMin : 0;
    return `Consumables model (SIM): start 98% O₂, ~3.3%/h.\nPlanned EVA ${fmtHM(m)} → ~${Math.round(98 - m * 0.055)}% at ingress.\nReserve policy: return if O₂ < 35%.`;
  }

  if (/(weather|dust|wind|temperature|radiation|pressure|environment)/.test(s)) {
    return `Environment (SIMULATION DATA):\nPressure ${ENV.pressureHpa} hPa · air ${ENV.airTempC} °C · ground ${ENV.groundTempC} °C\nWind ${ENV.windMs} m/s ${ENV.windDir} · dust τ ${ENV.dustTau}\nSurface dose ≈ ${ENV.radiation} mSv/day (model)\n${ENV.dustTau > 1 ? 'Dust front active — prefer low ground, keep comms margin.' : 'Conditions nominal for EVA.'}`;
  }

  return `I can answer from the loaded mission data. Try:\n• Is Target 03 safe?\n• Why is Target 01 scientifically important?\n• Which route has the lowest risk?\n• What happens if Target 02 becomes unavailable?\n• How long will this EVA take?\n• What terrain should we expect?`;
}
