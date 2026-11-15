import { clamp, lerp, smooth, pad2, fmtHM, fmtClock, segDist } from './math.js';
import { MPU, HALF, hazardValue, RISK } from './dataProvider.js';

export class Heap {
  constructor() {
    this.k = [];
    this.p = [];
  }
  get size() {
    return this.k.length;
  }
  push(k, p) {
    const K = this.k;
    const P = this.p;
    let i = K.length;
    K.push(k);
    P.push(p);
    while (i > 0) {
      const q = (i - 1) >> 1;
      if (P[q] <= p) break;
      K[i] = K[q];
      P[i] = P[q];
      i = q;
    }
    K[i] = k;
    P[i] = p;
  }
  pop() {
    const K = this.k;
    const P = this.p;
    const top = K[0];
    const lk = K.pop();
    const lp = P.pop();
    if (K.length) {
      let i = 0;
      const n = K.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let mp = lp;
        if (l < n && P[l] < mp) {
          m = l;
          mp = P[l];
        }
        if (r < n && P[r] < mp) {
          m = r;
          mp = P[r];
        }
        if (m === i) break;
        K[i] = K[m];
        P[i] = P[m];
        i = m;
      }
      K[i] = lk;
      P[i] = lp;
    }
    return top;
  }
}

export function chaikin(p, it) {
  for (let k = 0; k < it; k++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i];
      const b = p[i + 1];
      q.push(
        { x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 },
        { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 }
      );
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

export function permute(a) {
  if (a.length <= 1) return [a.slice()];
  const out = [];
  a.forEach((x, i) => {
    for (const p of permute(a.filter((_, j) => j !== i))) {
      out.push([x, ...p]);
    }
  });
  return out;
}

export const STOP_MIN = 25; // dwell at each science target (sampling)

export const VARIANTS = [
  {
    id: 'A',
    name: 'DIRECT CORRIDOR',
    desc: 'Time-optimal · top-2 targets by value',
    w: { slope: 0.06, haz: 0.04 },
    pick: (ts) => [...ts].sort((a, b) => b.value - a.value).slice(0, 2)
  },
  {
    id: 'B',
    name: 'BALANCED SAFE',
    desc: 'Safety-weighted · all selected targets',
    w: { slope: 0.7, haz: 2.4 },
    pick: (ts) => ts
  },
  {
    id: 'C',
    name: 'MAX SAFETY',
    desc: 'Skips targets near HIGH/CRITICAL terrain',
    w: { slope: 1.8, haz: 6 },
    pick: (ts, zones) => {
      const filtered = ts.filter((t) => !zones.some((z) => z.level >= 3 && Math.hypot(t.x - z.x, t.z - z.z) < z.r + 5));
      if (filtered.length) return filtered;
      return [...ts].sort((a, b) => {
        const da = Math.min(...zones.filter((z) => z.level >= 3).map((z) => Math.hypot(a.x - z.x, a.z - z.z) - z.r), 999);
        const db = Math.min(...zones.filter((z) => z.level >= 3).map((z) => Math.hypot(b.x - z.x, b.z - z.z) - z.r), 999);
        return db - da;
      }).slice(0, 1);
    }
  }
];

export class RouteEngine {
  constructor(store) {
    this.s = store;
    this.N = 129;
    this.cell = 100 / (this.N - 1);
    const N = this.N;
    this.elev = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const p = this.pos(j * N + i);
        this.elev[j * N + i] = store.eM(p.x, p.z);
      }
    }
    this.ver = 0;
    this.cache = new Map();
  }

  pos(k) {
    return {
      x: -HALF + (k % this.N) * this.cell,
      z: -HALF + Math.floor(k / this.N) * this.cell
    };
  }

  idx(x, z) {
    const N = this.N;
    return (
      clamp(Math.round((z + HALF) / this.cell), 0, N - 1) * N +
      clamp(Math.round((x + HALF) / this.cell), 0, N - 1)
    );
  }

  context(c) {
    const N = this.N;
    const n = N * N;
    const haz = new Float32Array(n);
    const block = new Uint8Array(n);
    const zones = [...this.s.hazards, ...c.extraZones];

    for (let k = 0; k < n; k++) {
      const p = this.pos(k);
      let h = 0;
      for (const z of zones) {
        const d = Math.hypot(p.x - z.x, p.z - z.z);
        if (d < z.r) {
          h = Math.max(h, (z.level / 4) * (1 - smooth(z.r * 0.55, z.r, d)));
          if (z.level >= 4 && d < z.r * 0.7) block[k] = 1;
        }
      }
      if (c.comm) {
        const dc = Math.hypot(p.x - c.comm.x, p.z - c.comm.z);
        if (dc > c.comm.r) {
          h = Math.max(h, 0.55);
          if (dc > c.comm.r + 4) block[k] = 1;
        }
      }
      haz[k] = h;
    }

    // Ensure approaches to science targets and habitat are not fully encircled by hard blocks
    for (const tg of (this.s.targets || []).concat(this.s.hab ? [this.s.hab] : [])) {
      const k = this.idx(tg.x, tg.z);
      block[k] = 0;
      const cx = k % N;
      const cy = (k / N) | 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx >= 0 && ny >= 0 && nx < N && ny < N) {
            block[ny * N + nx] = 0;
          }
        }
      }
    }

    return {
      haz,
      block,
      zones,
      c,
      blockSlope: c.blockSlope,
      slopeMul: c.slopeMul,
      key: ++this.ver
    };
  }

  astar(ctx, a, b, w) {
    const N = this.N;
    const n = N * N;
    const g = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const start = this.idx(a.x, a.z);
    const goal = this.idx(b.x, b.z);
    const heap = new Heap();

    g[start] = 0;
    heap.push(start, 0);

    const cm = this.cell * MPU;
    const gx = goal % N;
    const gy = (goal / N) | 0;

    const nb = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, 1.41421], [1, -1, 1.41421], [-1, 1, 1.41421], [-1, -1, 1.41421]
    ];
    const ws = w.slope * ctx.slopeMul;
    const wh = w.haz;

    while (heap.size) {
      const k = heap.pop();
      if (k === goal) break;
      if (closed[k]) continue;
      closed[k] = 1;
      const x = k % N;
      const y = (k / N) | 0;

      for (const [dx, dy, dl] of nb) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const m = ny * N + nx;
        if (closed[m]) continue;
        if (ctx.block[m] && m !== goal) continue;

        const dist = dl * cm;
        const slope = Math.atan(Math.abs(this.elev[m] - this.elev[k]) / dist) * 57.2958;
        if (slope > ctx.blockSlope) continue;

        const hz = (ctx.haz[m] + ctx.haz[k]) * 0.5;
        const ng = g[k] + dist * (1 + ws * (slope / 10) ** 2 + wh * hz * 8);

        if (ng < g[m]) {
          g[m] = ng;
          came[m] = k;
          heap.push(m, ng + Math.hypot(nx - gx, ny - gy) * cm);
        }
      }
    }

    if (start !== goal && came[goal] < 0) return null;
    const cells = [];
    let k = goal;
    while (k !== -1) {
      cells.push(k);
      k = came[k];
    }
    cells.reverse();
    return { cells, cost: g[goal] };
  }

  leg(ctx, a, b, w) {
    const key = `${ctx.key}|${a.id}>${b.id}|${w.slope},${w.haz}`;
    if (!this.cache.has(key)) {
      this.cache.set(key, this.astar(ctx, a, b, w));
    }
    return this.cache.get(key);
  }

  bestOrder(ctx, hab, list, w) {
    let best = null;
    for (const order of permute(list)) {
      const stops = [hab, ...order, hab];
      let total = 0;
      const legs = [];
      let ok = true;
      for (let i = 0; i < stops.length - 1; i++) {
        const L = this.leg(ctx, stops[i], stops[i + 1], w);
        if (!L) {
          ok = false;
          break;
        }
        total += L.cost;
        legs.push(L);
      }
      if (ok && (!best || total < best.total)) {
        best = { order, legs, total };
      }
    }
    return best;
  }

  plan(variant, ctx, targets, hab) {
    let list = variant.pick(targets, ctx.zones);
    if (!list.length) list = [...targets].slice(0, 1);
    let best = this.bestOrder(ctx, hab, list, variant.w);
    const dropped = [];
    if (!best) {
      const reachable = list.filter((t) => this.leg(ctx, hab, t, variant.w) && this.leg(ctx, t, hab, variant.w));
      list = reachable.length ? reachable : [...targets].filter((t) => this.leg(ctx, hab, t, variant.w));
      best = list.length ? this.bestOrder(ctx, hab, list, variant.w) : null;
      while (!best && list.length > 1) {
        const worst = [...list].sort((a, b) => a.value - b.value)[0];
        dropped.push(worst);
        list = list.filter((t) => t !== worst);
        best = this.bestOrder(ctx, hab, list, variant.w);
      }
    }
    if (!best) return null;
    return this.assemble(variant, best, ctx, hab, dropped);
  }

  assemble(variant, best, ctx, hab, dropped) {
    const s = this.s;
    const stops = [hab, ...best.order, hab];
    const line = [];
    const stopIdx = [0];

    best.legs.forEach((L, li) => {
      let lp = L.cells.map((k) => this.pos(k));
      lp[0] = { x: stops[li].x, z: stops[li].z };
      lp[lp.length - 1] = { x: stops[li + 1].x, z: stops[li + 1].z };
      lp = chaikin(lp, 2);
      if (li > 0) lp.shift();
      line.push(...lp);
      stopIdx.push(line.length - 1);
    });

    const track = [{ x: line[0].x, z: line[0].z, d: 0, t: 0 }];
    let distM = 0;
    let walk = 0;
    let maxSlope = 0;
    let hazSum = 0;
    let maxHaz = 0;
    let hot = 0;
    let gain = 0;
    let si = 1;
    const zoneMin = ctx.zones.map(() => Infinity);
    const zoneAt = ctx.zones.map(() => null);

    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      const hd = Math.hypot(b.x - a.x, b.z - a.z) * MPU;
      const dh = s.eM(b.x, b.z) - s.eM(a.x, a.z);
      const d = Math.hypot(hd, dh);
      const sl = Math.atan2(Math.abs(dh), Math.max(hd, 1)) * 57.2958;
      const v = 6 * Math.exp(-3.5 * Math.abs(dh / Math.max(hd, 1) + 0.05)) * 0.55;
      const tm = (d / 1000 / v) * 60;

      distM += d;
      walk += tm;
      if (dh > 0) gain += dh;
      maxSlope = Math.max(maxSlope, sl);

      let hz = hazardValue(b.x, b.z, ctx.zones);
      if (ctx.c.comm) {
        const dc = Math.hypot(b.x - ctx.c.comm.x, b.z - ctx.c.comm.z);
        if (dc > ctx.c.comm.r) hz = Math.max(hz, 0.55);
      }
      hazSum += hz;
      maxHaz = Math.max(maxHaz, hz);
      if (s.mineral(b.x, b.z) > 0.55) hot++;

      ctx.zones.forEach((z, zi) => {
        const dz = Math.hypot(b.x - z.x, b.z - z.z);
        if (dz < zoneMin[zi]) {
          zoneMin[zi] = dz;
          zoneAt[zi] = { x: b.x, z: b.z, d: distM };
        }
      });

      const prev = track[track.length - 1];
      track.push({ x: b.x, z: b.z, d: distM, t: prev.t + tm });

      if (si < stopIdx.length - 1 && i === stopIdx[si]) {
        track.push({
          x: b.x,
          z: b.z,
          d: distM,
          t: prev.t + tm + STOP_MIN,
          dwell: true,
          stop: stops[si]
        });
        si++;
      }
    }

    const meanHaz = hazSum / Math.max(1, line.length - 1);
    let prox = 0;
    ctx.zones.forEach((z, zi) => {
      prox += (z.level / 4) * clamp(1 - (zoneMin[zi] - z.r) / 3, 0, 1);
    });

    const riskScore = clamp(
      4 +
      58 * maxHaz +
      60 * meanHaz +
      5 * prox +
      Math.max(0, maxSlope - 8) * 1.2 +
      (walk / 60) * 1.5 +
      Math.max(0, distM - 7000) / 120,
      0,
      100
    );

    let avoided = 0;
    const entered = [];
    ctx.zones.forEach((z, zi) => {
      const onLine = stops
        .slice(0, -1)
        .some((p, i) => segDist(z.x, z.z, p.x, p.z, stops[i + 1].x, stops[i + 1].z) < z.r * 0.9);
      if (zoneMin[zi] < z.r * 0.8) entered.push(z);
      else if (onLine || zoneMin[zi] < z.r + 2.5) avoided++;
    });

    const visited = best.order;
    const science = Math.round(
      clamp(
        visited.reduce((a, t) => a + t.value, 0) + Math.min(8, hot * 0.08),
        0,
        100
      )
    );
    const safety = Math.round(100 - riskScore);
    const eff = Math.round(clamp(100 - (distM / 1000 - 3) * 12, 0, 100));
    const evaMin = walk + visited.length * STOP_MIN;

    const r = {
      id: variant.id,
      name: variant.name,
      desc: variant.desc,
      variant,
      line,
      track,
      stops,
      stopIdx,
      order: visited.map((t) => t.id),
      dropped: dropped.map((t) => t.id),
      distM,
      walkMin: walk,
      evaMin,
      maxSlope,
      gain,
      maxHaz,
      meanHaz,
      riskScore,
      risk: RISK(riskScore),
      safety,
      science,
      eff,
      avoided,
      entered,
      zoneMin,
      zoneAt,
      hot
    };
    r.waypoints = this.waypoints(r, ctx);
    return r;
  }

  waypoints(r, ctx) {
    const W = [];
    const tAt = (d) => {
      for (let i = 1; i < r.track.length; i++) {
        if (r.track[i].d >= d && !r.track[i].dwell) {
          const a = r.track[i - 1];
          const b = r.track[i];
          const f = (d - a.d) / Math.max(1e-6, b.d - a.d);
          return lerp(a.t, b.t, clamp(f, 0, 1));
        }
      }
      return r.track[r.track.length - 1].t;
    };

    W.push({ type: 'hab', name: 'DEPART HABITAT', short: 'HABITAT', x: r.line[0].x, z: r.line[0].z, d: 0, t: 0 });

    const tStops = r.track.filter((p) => p.dwell);
    tStops.forEach((p) =>
      W.push({
        type: 'target',
        name: p.stop.code,
        short: p.stop.code,
        target: p.stop,
        x: p.x,
        z: p.z,
        d: p.d,
        t: p.t - STOP_MIN,
        depart: p.t
      })
    );

    ctx.zones
      .map((z, zi) => ({ z, zi, m: r.zoneMin[zi] }))
      .filter((o) => o.m < o.z.r + 1.6 && o.m > o.z.r * 0.45)
      .sort((a, b) => (a.m - a.z.r) - (b.m - b.z.r))
      .slice(0, 3)
      .forEach(({ z, zi }) => {
        const m = r.zoneMin[zi];
        const at = r.zoneAt[zi];
        if (at) {
          W.push({
            type: 'hazard',
            name: 'HAZARD · ' + z.name,
            short: 'HAZARD',
            zone: z,
            x: at.x,
            z: at.z,
            d: at.d,
            t: tAt(at.d),
            clear: Math.max(0, (m - z.r * 0.55) * MPU)
          });
        }
      });

    const step = 900;
    for (let d = step; d < r.distM - 400; d += step) {
      if (W.some((w) => Math.abs(w.d - d) < 300)) continue;
      let best = null;
      for (const p of r.track) {
        if (p.d >= d) {
          best = p;
          break;
        }
      }
      if (best) W.push({ type: 'wp', x: best.x, z: best.z, d: best.d, t: tAt(best.d) });
    }

    const lastT = tStops.length ? tStops[tStops.length - 1] : null;
    W.sort((a, b) => a.d - b.d);

    if (lastT) {
      const ret = W.find((w) => w.type === 'wp' && w.d > lastT.d);
      if (ret) {
        ret.type = 'return';
        ret.name = 'RETURN POINT';
      }
    }
    const end = r.track[r.track.length - 1];
    W.push({ type: 'hab', name: 'HABITAT', short: 'HABITAT', x: end.x, z: end.z, d: r.distM, t: end.t, end: true });

    let n = 1;
    W.forEach((w) => {
      if (w.type === 'wp') {
        w.name = 'WAYPOINT ' + pad2(n++);
      }
    });
    return W;
  }
}
