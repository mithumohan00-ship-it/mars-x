import { clamp, lerp, smooth, fbm3, segDist } from './math.js';

export const MPU = 50; // metres per scene unit (horizontal) · region = 5 × 5 km
export const EXAG = 3; // vertical exaggeration so geology is readable
export const HALF = 50; // region spans -50..50 scene units

export const SIM = { M: { x: 38, z: -38 } };
export const CRATERS = [
  { x: -14.5, z: 5.5, r: 2.4, d: 0.9 },
  { x: -30, z: -10, r: 4, d: 1.3 },
  { x: 28, z: 12, r: 3, d: 0.9 },
  { x: -44, z: 2, r: 5.5, d: 1.5 },
  { x: -6, z: 44, r: 2.5, d: 0.7 },
  { x: 44, z: 30, r: 4, d: 1.1 },
  { x: -40, z: -38, r: 3.2, d: 1 },
  { x: -30, z: 30, r: 3.5, d: 1 }
];

export function craterProfile(d, r, depth) {
  const t = d / r;
  if (t > 2.4) return 0;
  const bowl = t < 1 ? -depth * (1 - t * t) : 0;
  return bowl + depth * 0.5 * Math.exp(-Math.pow((t - 1) / 0.28, 2));
}

export function gauss(x, z, cx, cz, s) {
  return Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * s * s));
}

// =====================================================================
// REGION DEFINITIONS & PROCEDURAL GEOLOGY
// =====================================================================

export const REGIONS_CONFIG = {
  'gale-msharp-nw': {
    id: 'gale-msharp-nw',
    name: 'Gale Crater · Mount Sharp',
    sector: 'NW approach · 5 × 5 km',
    lat: -5.4,
    lon: 137.8,
    sizeM: 5000,
    baseElevM: -4450,
    elevScale: 16.67,
    ready: true,
    primary: true,
    env: {
      sol: 412,
      pressureHpa: 7.2,
      airTempC: -48,
      groundTempC: -22,
      windMs: 6.2,
      windDir: 'ENE',
      dustTau: 0.65,
      uvIndex: 'MODERATE',
      radiation: 0.68,
      sunrise: '05:42',
      sunset: '18:14',
      lmstStart: 360
    },
    geoUnits: [
      { name: 'Bradbury group · crater floor', c: [0.48, 0.32, 0.22], hl: '#c98a5a' },
      { name: 'Murray fm. · lacustrine mudstone', c: [0.58, 0.42, 0.30], hl: '#e8b98a' },
      { name: 'Ridge unit · hematite-bearing', c: [0.44, 0.22, 0.16], hl: '#ff5c7a' },
      { name: 'Clay-bearing unit', c: [0.46, 0.38, 0.34], hl: '#5cffc0' },
      { name: 'Sulfate-bearing unit', c: [0.60, 0.46, 0.32], hl: '#ffe066' },
      { name: 'Active dunes · basaltic sand', c: [0.20, 0.16, 0.15], hl: '#8a7dff' }
    ],
    heightFn: (x, z, detail = true) => {
      const dx = x - 38;
      const dz = z - (-38);
      const d = Math.hypot(dx, dz);
      const ang = Math.atan2(dz, dx);
      let h = 1.3 * fbm3(x * 0.045, 1.7, z * 0.045, 4);
      if (detail) h += 0.3 * fbm3(x * 0.22, 4.1, z * 0.22, 3);
      let m = 17 * Math.pow(Math.max(0, 1 - d / 100), 1.7);
      const tt = m / 1.3;
      const fl = Math.floor(tt);
      m = (fl + smooth(0.3, 0.7, tt - fl)) * 1.3;
      h += m;
      h += 2.3 * Math.pow(0.5 + 0.5 * Math.sin(ang * 6 + 0.8), 1.5) * Math.exp(-Math.pow((d - 51) / 2.4, 2));
      const cd = segDist(x, z, 22, -18, 4, -30);
      h -= 1.8 * (1 - smooth(1, 3, cd));
      h += 4.2 * (1 - smooth(4.2, 5.4, Math.hypot(x + 1, z + 10)));
      h += 2.4 * (1 - smooth(3, 6, Math.hypot(x - 26, z + 2)));
      const dd = Math.hypot(x + 2, z - 7);
      if (dd < 11) {
        const w = 1 - smooth(6, 11, dd);
        h += w * 0.6 * Math.pow(0.5 + 0.5 * Math.sin(x * 1.1 + z * 0.6 + Math.sin(z * 0.4) * 2), 2);
      }
      const craters = [
        { x: -14.5, z: 5.5, r: 2.4, d: 0.9 },
        { x: -30, z: -10, r: 4, d: 1.3 },
        { x: 28, z: 12, r: 3, d: 0.9 },
        { x: -44, z: 2, r: 5.5, d: 1.5 }
      ];
      for (const c of craters) h += craterProfile(Math.hypot(x - c.x, z - c.z), c.r, c.d);
      return h;
    },
    geoUnitFn: (x, z) => {
      if (Math.hypot(x + 2, z - 7) < 7.5) return 5;
      const d = Math.hypot(x - 38, z - (-38)) + (fbm3(x * 0.08, 9.3, z * 0.08, 3) - 0.5) * 4;
      return d < 38 ? 4 : d < 48 ? 3 : d < 55 ? 2 : d < 72 ? 1 : 0;
    },
    spectralFn: (x, z) => {
      const d = Math.hypot(x - 38, z - (-38));
      let m = 0.95 * gauss(x, z, 10.7, -3.7, 3.2) +
              0.60 * gauss(x, z, 7.2, -14.9, 2.8) +
              0.45 * gauss(x, z, -12.8, -2.7, 3.5) +
              0.50 * Math.exp(-Math.pow((d - 51) / 2.6, 2)) * fbm3(x * 0.15, 2, z * 0.15, 2) * 1.6;
      return clamp(m, 0, 1);
    },
    habitat: { id: 'HAB', code: 'HAB-1', name: 'HABITAT', e: -16 * MPU, n: 14 * MPU },
    scienceTargets: [
      {
        id: 'T1', code: 'TARGET 01', name: 'CLAY-BEARING OUTCROP', stars: 5, value: 33, priority: 'HIGH',
        objective: 'Investigate evidence of ancient water-rock interaction.',
        feature: 'Fractured clay-bearing mudstone, smectite-like spectral signature',
        relevance: 'High', kind: 'clay', e: 10.7 * MPU, n: -3.7 * MPU,
        instr: ['APXS-class spectrometer', 'Close-up imager', 'Core sample ×2']
      },
      {
        id: 'T2', code: 'TARGET 02', name: 'LAYERED SEDIMENTARY FORMATION', stars: 4, value: 25, priority: 'HIGH',
        objective: 'Study depositional history and lake cycle bedding.',
        feature: 'Finely laminated lacustrine strata, cross-bedding',
        relevance: 'High', kind: 'layer', e: -12.8 * MPU, n: -2.7 * MPU,
        instr: ['Stratigraphic panorama', 'Grain-size survey', 'Hand sample ×3']
      },
      {
        id: 'T3', code: 'TARGET 03', name: 'GEOLOGICAL CONTACT ZONE', stars: 5, value: 32, priority: 'VERY HIGH',
        objective: 'Analyze contrasting geological units and sulfate boundary.',
        feature: 'Clay–sulfate transition, sharp colour and texture change',
        relevance: 'Very high', kind: 'contact', e: 7.2 * MPU, n: -14.9 * MPU,
        instr: ['Contact traverse', 'Multispectral mosaic', 'Core sample ×2']
      }
    ],
    hazards: [
      { id: 'H1', name: 'DUNE FIELD', type: 'sand', x: -2, z: 7, r: 8, level: 3, desc: 'Soft basaltic sand · traction loss · high fatigue' },
      { id: 'H2', name: 'BUTTE SCARP', type: 'cliff', x: -1, z: -10, r: 6.5, level: 4, desc: 'Cliff faces > 45° · fall / rockfall risk' },
      { id: 'H3', name: 'BOULDER FIELD', type: 'rough', x: 9.5, z: -9, r: 3.5, level: 2, desc: 'Dense float rocks · trip and suit-abrasion risk' },
      { id: 'H4', name: 'CRATER RIM', type: 'crater', x: -14.5, z: 5.5, r: 3.4, level: 2, desc: 'Unconsolidated rim slopes · 18–24°' },
      { id: 'H5', name: 'CHANNEL WALLS', type: 'channel', x: 11, z: -24, r: 4.5, level: 3, desc: 'Incised channel · loose walls' },
      { id: 'H6', name: 'CRATER BOWL', type: 'crater', x: -30, z: -10, r: 4.5, level: 2, desc: 'Steep inner walls' },
      { id: 'H7', name: 'ROUGH TERRAIN', type: 'rough', x: 4, z: 18, r: 4, level: 1, desc: 'Ventifacts · uneven footing' },
      { id: 'H8', name: 'STEEP TERRACE', type: 'slope', x: 26, z: -2, r: 5, level: 3, desc: 'Terrace slopes up to 28°' }
    ]
  },

  'jezero': {
    id: 'jezero',
    name: 'Jezero Crater',
    sector: 'Western delta fan · 5 × 5 km',
    lat: 18.4,
    lon: 77.5,
    sizeM: 5000,
    baseElevM: -2500,
    elevScale: 14.2,
    ready: true,
    primary: false,
    env: {
      sol: 412,
      pressureHpa: 6.8,
      airTempC: -54,
      groundTempC: -28,
      windMs: 5.4,
      windDir: 'NE',
      dustTau: 0.58,
      uvIndex: 'MODERATE',
      radiation: 0.71,
      sunrise: '05:34',
      sunset: '18:22',
      lmstStart: 360
    },
    geoUnits: [
      { name: 'Crater floor basalt', c: [0.42, 0.30, 0.24], hl: '#b87d54' },
      { name: 'Delta bottomset mudstone', c: [0.52, 0.40, 0.30], hl: '#d9a373' },
      { name: 'Delta foreset sandstone', c: [0.56, 0.44, 0.32], hl: '#f5c382' },
      { name: 'Séítah olivine-carbonate cumulate', c: [0.35, 0.44, 0.36], hl: '#52b788' },
      { name: 'Delta topset boulder conglomerate', c: [0.48, 0.36, 0.28], hl: '#c47a53' },
      { name: 'Transverse aeolian ridges', c: [0.24, 0.18, 0.18], hl: '#8f7e9c' }
    ],
    heightFn: (x, z, detail = true) => {
      let h = 1.2 * fbm3(x * 0.04, 2.5, z * 0.04, 4);
      if (detail) h += 0.28 * fbm3(x * 0.2, 5.0, z * 0.2, 3);
      // Western crater rim wall
      const rimDist = Math.hypot(x + 46, z + 42);
      h += 16 * (1 - smooth(35, 75, rimDist));
      // River delta fan radiating from (-24, -12) toward center
      const dDelta = Math.hypot(x + 24, z + 12);
      const aDelta = Math.atan2(z + 12, x + 24);
      if (aDelta > -0.7 && aDelta < 1.1) {
        const fan = 8.5 * Math.pow(Math.max(0, 1 - dDelta / 65), 1.4);
        h += fan + 1.6 * (1 - smooth(18, 32, dDelta));
      }
      // Neretva Vallis canyon breach
      const breach = segDist(x, z, -48, -25, -20, -10);
      h -= 4.2 * (1 - smooth(1.5, 4.5, breach));
      // Séítah fractured depression
      const seitah = Math.hypot(x - 8, z + 18);
      h -= 2.2 * (1 - smooth(5, 14, seitah));
      // Impact crater
      h += craterProfile(Math.hypot(x - 22, z - 20), 4.2, 1.4);
      return h;
    },
    geoUnitFn: (x, z) => {
      if (Math.hypot(x - 8, z + 18) < 11) return 3; // Séítah
      const dDelta = Math.hypot(x + 24, z + 12);
      const aDelta = Math.atan2(z + 12, x + 24);
      if (aDelta > -0.7 && aDelta < 1.1 && dDelta < 55) {
        return dDelta < 18 ? 4 : dDelta < 36 ? 2 : 1;
      }
      return 0;
    },
    spectralFn: (x, z) => {
      let m = 0.92 * gauss(x, z, 6.5, -4.2, 4.0) +
              0.88 * gauss(x, z, -8.0, 18.0, 3.8) +
              0.65 * gauss(x, z, 20.0, 8.5, 3.2);
      return clamp(m, 0, 1);
    },
    habitat: { id: 'HAB', code: 'HAB-1', name: 'HABITAT', e: -14 * MPU, n: 16 * MPU },
    scienceTargets: [
      {
        id: 'T1', code: 'TARGET 01', name: 'WESTERN DELTA SCARP', stars: 5, value: 34, priority: 'VERY HIGH',
        objective: 'Sample fine-grained delta bottomset mudstones for potential biosignature preservation.',
        feature: 'Thinly laminated clay mudstone with smectite/carbonate signatures',
        relevance: 'Very high', kind: 'layer', e: 6.5 * MPU, n: -4.2 * MPU,
        instr: ['Raman spectrometer', 'Micro-imager', 'Hermetic sample core ×2']
      },
      {
        id: 'T2', code: 'TARGET 02', name: 'SÉÍTAH OLIVINE FORMATION', stars: 5, value: 31, priority: 'HIGH',
        objective: 'Determine age and crystallization environment of primordial igneous basement.',
        feature: 'Coarse-grained cumulate olivine-carbonate rock unit',
        relevance: 'High', kind: 'clay', e: -8.0 * MPU, n: 18.0 * MPU,
        instr: ['Deep-UV fluorescence', 'Contact probe', 'Abrasion patch scan']
      },
      {
        id: 'T3', code: 'TARGET 03', name: 'NERETVA INLET BREACH', stars: 4, value: 26, priority: 'HIGH',
        objective: 'Analyze ancient high-energy megafloods that breached the crater rim.',
        feature: 'Imbricated boulder conglomerate beds and incised channel bank',
        relevance: 'High', kind: 'contact', e: -22.0 * MPU, n: -8.0 * MPU,
        instr: ['Stratigraphic survey', 'Stereo photogrammetry', 'Grab sample ×3']
      }
    ],
    hazards: [
      { id: 'H1', name: 'DELTA SCARP', type: 'cliff', x: 2, z: -6, r: 6.5, level: 4, desc: 'Steep delta front drop-off > 35°' },
      { id: 'H2', name: 'SÉÍTAH BOULDERS', type: 'rough', x: -6, z: 16, r: 7.0, level: 3, desc: 'Perched fracture blocks · vehicle entrapment' },
      { id: 'H3', name: 'SAND RIPPLES', type: 'sand', x: 14, z: 12, r: 6.0, level: 2, desc: 'Loose aeolian ridges · high slip ratio' },
      { id: 'H4', name: 'CRATER WALL', type: 'slope', x: -38, z: -30, r: 8.5, level: 4, desc: 'Crater rim scarp > 40°' },
      { id: 'H5', name: 'INLET CHASM', type: 'channel', x: -28, z: -14, r: 4.5, level: 3, desc: 'Deep fluvial breach wall' },
      { id: 'H6', name: 'BELVA CRATER', type: 'crater', x: 22, z: -20, r: 5.5, level: 2, desc: 'Impact rim blockfield' },
      { id: 'H7', name: 'TALUS SLOPE', type: 'slope', x: 10, z: -22, r: 4.0, level: 2, desc: 'Unconsolidated delta scree' },
      { id: 'H8', name: 'UNEVEN REGOLITH', type: 'rough', x: -18, z: 4, r: 3.5, level: 1, desc: 'Ventifact deflation lag' }
    ]
  },

  'olympus': {
    id: 'olympus',
    name: 'Olympus Mons',
    sector: 'Basal scarp & lava tubes · 5 × 5 km',
    lat: 18.65,
    lon: -133.8,
    sizeM: 5000,
    baseElevM: 3400,
    elevScale: 22.0,
    ready: true,
    primary: false,
    env: {
      sol: 412,
      pressureHpa: 1.2,
      airTempC: -78,
      groundTempC: -45,
      windMs: 12.5,
      windDir: 'WSW',
      dustTau: 0.32,
      uvIndex: 'EXTREME',
      radiation: 1.42,
      sunrise: '05:40',
      sunset: '18:18',
      lmstStart: 360
    },
    geoUnits: [
      { name: 'Lower aureole debris', c: [0.38, 0.28, 0.24], hl: '#9e7b66' },
      { name: 'Sheet pahoehoe flood basalt', c: [0.32, 0.25, 0.23], hl: '#7d5c4b' },
      { name: 'Rubbly aa lava field', c: [0.25, 0.19, 0.18], hl: '#5c4335' },
      { name: 'Basal cliff columnar basalt', c: [0.46, 0.34, 0.28], hl: '#bd8f75' },
      { name: 'Collapsed lava tube floor', c: [0.18, 0.15, 0.15], hl: '#4a3b47' },
      { name: 'Volcanic tephra & cinder mantling', c: [0.52, 0.30, 0.20], hl: '#e07a48' }
    ],
    heightFn: (x, z, detail = true) => {
      let h = 1.5 * fbm3(x * 0.035, 1.2, z * 0.035, 4);
      if (detail) h += 0.35 * fbm3(x * 0.25, 3.2, z * 0.25, 3);
      // Colossal basal cliff scarp in North (rising +22 units)
      const scarp = 22 * (1 - smooth(-8, 16, z));
      h += scarp;
      // Collapsed sinuous lava tube channel trench
      const rille = segDist(x, z, -40, -18, 30, -5);
      h -= 3.8 * (1 - smooth(1.8, 4.0, rille));
      // Pahoehoe lava terraces
      h += 1.8 * Math.pow(0.5 + 0.5 * Math.sin(x * 0.4 + z * 0.2), 2);
      // Volcanic hornito cone
      h += 5.5 * Math.exp(-Math.pow(Math.hypot(x - 16, z + 24) / 4.5, 2));
      return h;
    },
    geoUnitFn: (x, z) => {
      const rille = segDist(x, z, -40, -18, 30, -5);
      if (rille < 3.2) return 4; // Tube floor
      if (z > 10) return 3; // Columnar cliff
      if (Math.hypot(x - 16, z + 24) < 7) return 5; // Cone
      return Math.sin(x * 0.2 + z * 0.3) > 0.2 ? 2 : 1;
    },
    spectralFn: (x, z) => {
      let m = 0.95 * gauss(x, z, -6.0, -12.0, 3.5) +
              0.80 * gauss(x, z, 16.0, -8.0, 4.2) +
              0.70 * gauss(x, z, 16.0, -24.0, 3.0);
      return clamp(m, 0, 1);
    },
    habitat: { id: 'HAB', code: 'HAB-1', name: 'HABITAT', e: -18 * MPU, n: -24 * MPU },
    scienceTargets: [
      {
        id: 'T1', code: 'TARGET 01', name: 'LAVA TUBE SKYLIGHT', stars: 5, value: 35, priority: 'VERY HIGH',
        objective: 'Inspect open skylight entry into subterranean volcanic conduit for habitat radiation shielding.',
        feature: 'Collapsed lava tube ceiling opening into intact underground basalt cavern',
        relevance: 'Very high', kind: 'contact', e: -6.0 * MPU, n: -7.5 * MPU,
        instr: ['LiDAR 3D interior scan', 'Radiation probe', 'Micro-penetrators']
      },
      {
        id: 'T2', code: 'TARGET 02', name: 'BASAL SCARP CLIFF WALL', stars: 5, value: 30, priority: 'HIGH',
        objective: 'Examine primary volcanic eruption stratigraphy exposed in the towering basal scarp.',
        feature: 'Massive stacked columnar cooling joints in tholeiitic basalt sequence',
        relevance: 'High', kind: 'layer', e: 16.0 * MPU, n: -8.0 * MPU,
        instr: ['Telephoto imager', 'LIBS rock laser', 'Sonic rock drill']
      },
      {
        id: 'T3', code: 'TARGET 03', name: 'FUMAROLIC CONE VENT', stars: 4, value: 25, priority: 'HIGH',
        objective: 'Search for volcanic sublimates, sulfur encrustations, and hydrothermal altered ash.',
        feature: 'Intact hornito vent with jarosite and native sulfur deposits',
        relevance: 'High', kind: 'clay', e: 16.0 * MPU, n: -24.0 * MPU,
        instr: ['Gas chromatograph', 'X-ray diffractometer', 'Sublimation capture']
      }
    ],
    hazards: [
      { id: 'H1', name: 'BASAL SCARP CLIFF', type: 'cliff', x: 0, z: 12, r: 8.5, level: 4, desc: 'Vertical basalt wall > 55° drop' },
      { id: 'H2', name: 'TUBE SKYLIGHT CHASM', type: 'cliff', x: -6, z: -12, r: 4.5, level: 4, desc: 'Unreinforced collapse pit opening' },
      { id: 'H3', name: 'SHARP AA LAVA', type: 'rough', x: 8, z: 4, r: 6.0, level: 3, desc: 'Glassy basalt spines · suit puncture risk' },
      { id: 'H4', name: 'LAVA CHASM WALLS', type: 'channel', x: -25, z: -16, r: 5.0, level: 3, desc: 'Steep rille depression sides' },
      { id: 'H5', name: 'VENT RIM SLOPE', type: 'slope', x: 16, z: -24, r: 4.5, level: 2, desc: 'Loose volcanic cinder scree' },
      { id: 'H6', name: 'HIGH RADIATION PLATEAU', type: 'slope', x: 25, z: 15, r: 6.0, level: 3, desc: 'Unshielded atmospheric thinness' },
      { id: 'H7', name: 'FRACTURE SCARP', type: 'rough', x: -28, z: 8, r: 4.0, level: 2, desc: 'Tectonic tension fissures' },
      { id: 'H8', name: 'ROUGH BASALT', type: 'rough', x: -4, z: -26, r: 3.5, level: 1, desc: 'Uneven vesicular pahoehoe' }
    ]
  },

  'valles': {
    id: 'valles',
    name: 'Valles Marineris',
    sector: 'Candor Chasma rift floor · 5 × 5 km',
    lat: -14.0,
    lon: -59.0,
    sizeM: 5000,
    baseElevM: -6800,
    elevScale: 20.0,
    ready: true,
    primary: false,
    env: {
      sol: 412,
      pressureHpa: 9.8,
      airTempC: -38,
      groundTempC: -14,
      windMs: 8.8,
      windDir: 'WNW',
      dustTau: 0.82,
      uvIndex: 'LOW',
      radiation: 0.52,
      sunrise: '05:58',
      sunset: '17:58',
      lmstStart: 360
    },
    geoUnits: [
      { name: 'Candor chasma floor', c: [0.44, 0.30, 0.24], hl: '#c0805a' },
      { name: 'Interior layered sulfate mound', c: [0.58, 0.48, 0.34], hl: '#f5d38a' },
      { name: 'Landslide megabreccia apron', c: [0.35, 0.26, 0.22], hl: '#8f6854' },
      { name: 'Canyon wall fault scarp basalt', c: [0.50, 0.36, 0.30], hl: '#c78d78' },
      { name: 'Hydrothermal opalline silica veins', c: [0.38, 0.50, 0.46], hl: '#68c2b5' },
      { name: 'Canyon floor dark sand dunes', c: [0.22, 0.16, 0.16], hl: '#736166' }
    ],
    heightFn: (x, z, detail = true) => {
      let h = 1.4 * fbm3(x * 0.04, 1.8, z * 0.04, 4);
      if (detail) h += 0.3 * fbm3(x * 0.22, 4.4, z * 0.22, 3);
      // North towering canyon wall (z > 24)
      h += 24 * smooth(14, 44, z);
      // South canyon wall (z < -26)
      h += 22 * smooth(-16, -44, z);
      // Central layered sulfate mound
      const dMound = Math.hypot(x - 4, z - 2);
      h += 13.5 * Math.pow(Math.max(0, 1 - dMound / 32), 1.5);
      // Landslide debris tongue from south wall
      const dSlide = Math.hypot(x + 18, z + 12);
      h += 6.5 * (1 - smooth(5, 18, dSlide));
      return h;
    },
    geoUnitFn: (x, z) => {
      if (Math.hypot(x - 4, z - 2) < 22) return 1; // Sulfate mound
      if (Math.hypot(x + 18, z + 12) < 14) return 2; // Landslide
      if (z > 22 || z < -24) return 3; // Wall scarp
      if (Math.hypot(x - 18, z + 6) < 8) return 4; // Silica veins
      return 0;
    },
    spectralFn: (x, z) => {
      let m = 0.94 * gauss(x, z, -2.0, 4.0, 3.8) +
              0.82 * gauss(x, z, -18.0, 6.0, 3.2) +
              0.75 * gauss(x, z, 14.0, -12.0, 4.0);
      return clamp(m, 0, 1);
    },
    habitat: { id: 'HAB', code: 'HAB-1', name: 'HABITAT', e: -22 * MPU, n: -8 * MPU },
    scienceTargets: [
      {
        id: 'T1', code: 'TARGET 01', name: 'CANDOR SULFATE MOUND', stars: 5, value: 34, priority: 'VERY HIGH',
        objective: 'Sample rhythmic hydrated sulfate sediments indicating long-standing acidic groundwater systems.',
        feature: 'Multi-kilometer stacked polyhydrated magnesium sulfate beds',
        relevance: 'Very high', kind: 'layer', e: -2.0 * MPU, n: 4.0 * MPU,
        instr: ['XRD mineral identifier', 'Thermal emission probe', 'Core barrel ×2']
      },
      {
        id: 'T2', code: 'TARGET 02', name: 'HYDROTHERMAL SILICA CHASM', stars: 5, value: 32, priority: 'HIGH',
        objective: 'Examine low-temperature silica sinter precipitated along canyon master rift fault.',
        feature: 'Opalline silica veins and bleached basalt host rock',
        relevance: 'High', kind: 'contact', e: -18.0 * MPU, n: 6.0 * MPU,
        instr: ['Reflectance spectrometer', 'Microscope camera', 'Rock chipping kit']
      },
      {
        id: 'T3', code: 'TARGET 03', name: 'MEGASLIDE APRON TOE', stars: 4, value: 24, priority: 'HIGH',
        objective: 'Investigate deep ancient crustal blocks excavated by gargantuan canyon wall collapse.',
        feature: 'Jumbled megabreccia boulders with pristine deep basalt signatures',
        relevance: 'High', kind: 'clay', e: 14.0 * MPU, n: -12.0 * MPU,
        instr: ['Structural compass', 'Gamma sensor', 'Surface hammer survey']
      }
    ],
    hazards: [
      { id: 'H1', name: 'NORTH WALL SCARP', type: 'cliff', x: 0, z: 28, r: 8.5, level: 4, desc: 'Towering canyon wall > 50°' },
      { id: 'H2', name: 'SOUTH TALUS SCARP', type: 'cliff', x: 0, z: -30, r: 8.0, level: 4, desc: 'Active rockfall zone' },
      { id: 'H3', name: 'SULFATE SCARP', type: 'slope', x: -2, z: 14, r: 5.5, level: 3, desc: 'Steep mound flank 28°' },
      { id: 'H4', name: 'LANDSLIDE RUBBLE', type: 'rough', x: 16, z: 8, r: 6.0, level: 2, desc: 'Massive blockfield float' },
      { id: 'H5', name: 'RIFT FISSURE', type: 'channel', x: -14, z: 12, r: 4.5, level: 3, desc: 'Fault crevice depression' },
      { id: 'H6', name: 'CHASM DUNE DRIFT', type: 'sand', x: 20, z: -10, r: 5.5, level: 2, desc: 'Fine aeolian dust bed' },
      { id: 'H7', name: 'UNSTABLE TALUS', type: 'slope', x: -22, z: -24, r: 4.5, level: 3, desc: 'Loose scree apron' },
      { id: 'H8', name: 'UNEQUAL FOOTING', type: 'rough', x: -6, z: -10, r: 3.5, level: 1, desc: 'Fractured chasma floor' }
    ]
  },

  'hellas': {
    id: 'hellas',
    name: 'Hellas Planitia',
    sector: 'South-central basin plain · 5 × 5 km',
    lat: -42.4,
    lon: 70.5,
    sizeM: 5000,
    baseElevM: -7150,
    elevScale: 12.0,
    ready: true,
    primary: false,
    env: {
      sol: 412,
      pressureHpa: 11.6,
      airTempC: -64,
      groundTempC: -32,
      windMs: 7.4,
      windDir: 'SSE',
      dustTau: 1.15,
      uvIndex: 'LOW',
      radiation: 0.46,
      sunrise: '05:15',
      sunset: '18:45',
      lmstStart: 360
    },
    geoUnits: [
      { name: 'Basin floor sedimentary regolith', c: [0.40, 0.30, 0.25], hl: '#b38268' },
      { name: 'Permafrost polygonal ice-wedge terrain', c: [0.48, 0.42, 0.40], hl: '#9bb0a5' },
      { name: 'Glacial outwash silt & clay', c: [0.52, 0.38, 0.32], hl: '#c99577' },
      { name: 'Hydrated smectite lacustrine deposit', c: [0.36, 0.48, 0.42], hl: '#5cb89a' },
      { name: 'Seasonal CO₂ & H₂O frost mantle', c: [0.65, 0.68, 0.74], hl: '#e0eaff' },
      { name: 'Basaltic dunes with frost crests', c: [0.22, 0.18, 0.22], hl: '#75687a' }
    ],
    heightFn: (x, z, detail = true) => {
      let h = 0.9 * fbm3(x * 0.03, 3.1, z * 0.03, 4);
      if (detail) h += 0.25 * fbm3(x * 0.18, 6.2, z * 0.18, 3);
      // Honeycomb patterned ground networks
      h += 1.4 * (Math.sin(x * 0.35) * Math.cos(z * 0.35) + 0.5 * Math.sin(x * 0.7 - z * 0.7));
      // Outwash channel (smooth, wide natural swale)
      const ch = segDist(x, z, -35, 30, 25, -25);
      h -= 1.4 * (1 - smooth(2.5, 7.0, ch));
      // Shallow cryogenic depression
      const dep = Math.hypot(x + 12, z + 8);
      h -= 2.0 * (1 - smooth(8, 22, dep));
      // Frost mounds (pingos)
      h += 3.2 * Math.exp(-Math.pow(Math.hypot(x - 14, z - 12) / 4.0, 2));
      return h;
    },
    geoUnitFn: (x, z) => {
      if (Math.hypot(x - 14, z - 12) < 6) return 4; // Frost mantle
      if (Math.hypot(x + 12, z + 8) < 16) return 3; // Smectite clay
      const ch = segDist(x, z, -35, 30, 25, -25);
      if (ch < 5.5) return 2; // Outwash silt
      return Math.sin(x * 0.35) * Math.cos(z * 0.35) > 0.1 ? 1 : 0;
    },
    spectralFn: (x, z) => {
      let m = 0.90 * gauss(x, z, -12.0, -8.0, 4.0) +
              0.85 * gauss(x, z, 14.0, 12.0, 3.5) +
              0.68 * gauss(x, z, 0.0, -18.0, 3.8);
      return clamp(m, 0, 1);
    },
    habitat: { id: 'HAB', code: 'HAB-1', name: 'HABITAT', e: 0, n: 16 * MPU },
    scienceTargets: [
      {
        id: 'T1', code: 'TARGET 01', name: 'PERMAFROST POLYGONAL RIDGE', stars: 5, value: 33, priority: 'VERY HIGH',
        objective: 'Core into subsurface ground-ice wedges to assess water extraction feasibility.',
        feature: 'Honeycomb thermal contraction crack with pure water ice core at 30 cm depth',
        relevance: 'Very high', kind: 'contact', e: -12.0 * MPU, n: -8.0 * MPU,
        instr: ['Ground-penetrating radar', 'Thermal conductivity probe', 'Cryo-core drill']
      },
      {
        id: 'T2', code: 'TARGET 02', name: 'OUTWASH SMECTITE BASIN', stars: 5, value: 31, priority: 'HIGH',
        objective: 'Analyze ancient glacial sediment outwash for organic biomarkers.',
        feature: 'Dense hydrated smectite clay silts deposited in deep Hellas paleolake',
        relevance: 'High', kind: 'clay', e: 14.0 * MPU, n: 12.0 * MPU,
        instr: ['UV fluorescence spectrometer', 'Laser ablation ICP-MS', 'Sample vault']
      },
      {
        id: 'T3', code: 'TARGET 03', name: 'CRYO-CONE FROST MOUND', stars: 4, value: 26, priority: 'HIGH',
        objective: 'Study active seasonal CO2/H2O sublimation and cryovolcanic frost heaves.',
        feature: 'Blistered frost pingo with pristine seasonal ice condensation banding',
        relevance: 'High', kind: 'layer', e: 0.0, n: -18.0 * MPU,
        instr: ['Atmospheric exchange sensor', 'Surface thermometer array', 'Ice slice scanner']
      }
    ],
    hazards: [
      { id: 'H1', name: 'CRYO-COLLAPSE TRENCH', type: 'channel', x: -8, z: -6, r: 6.0, level: 3, desc: 'Thermokarst sinkhole risk' },
      { id: 'H2', name: 'DENSE DUST POCKET', type: 'sand', x: 12, z: -16, r: 6.5, level: 3, desc: 'High aerosol suspension · zero visibility' },
      { id: 'H3', name: 'ICE-WEDGED CRACK', type: 'rough', x: -16, z: 12, r: 5.0, level: 2, desc: 'Deep ground fissures · trip hazard' },
      { id: 'H4', name: 'SLIPPERY FROST CREST', type: 'slope', x: 14, z: 12, r: 4.5, level: 2, desc: 'Sublimating ice slick' },
      { id: 'H5', name: 'CHANNEL DEBRIS', type: 'channel', x: 2, z: 2, r: 4.0, level: 2, desc: 'Glacial erratic boulders' },
      { id: 'H6', name: 'UNCONSOLIDATED SILT', type: 'sand', x: -22, z: -18, r: 5.5, level: 2, desc: 'Soft dust drift' },
      { id: 'H7', name: 'THERMOKARST RIDGE', type: 'slope', x: 22, z: 18, r: 4.0, level: 1, desc: 'Uneven cryostatic mound' },
      { id: 'H8', name: 'HUMMOCK FIELD', type: 'rough', x: -6, z: 22, r: 3.5, level: 1, desc: 'Frost heave polygons' }
    ]
  },

  'elysium': {
    id: 'elysium',
    name: 'Elysium Planitia',
    sector: 'Cerberus Fossae plain · 5 × 5 km',
    lat: 4.5,
    lon: 135.6,
    sizeM: 5000,
    baseElevM: -2800,
    elevScale: 13.5,
    ready: true,
    primary: false,
    env: {
      sol: 412,
      pressureHpa: 7.4,
      airTempC: -50,
      groundTempC: -24,
      windMs: 4.8,
      windDir: 'E',
      dustTau: 0.60,
      uvIndex: 'MODERATE',
      radiation: 0.69,
      sunrise: '05:48',
      sunset: '18:08',
      lmstStart: 360
    },
    geoUnits: [
      { name: 'Young Amazonian flood basalt', c: [0.36, 0.28, 0.24], hl: '#996f5b' },
      { name: 'Rafted platy-ridged lava crust', c: [0.30, 0.24, 0.22], hl: '#705244' },
      { name: 'Cerberus graben wall columnar basalt', c: [0.48, 0.36, 0.30], hl: '#bf846d' },
      { name: 'Rootless cone volcanic tephra', c: [0.54, 0.32, 0.22], hl: '#d96c43' },
      { name: 'Seismometer bedrock coupling site', c: [0.32, 0.40, 0.36], hl: '#4a9985' },
      { name: 'Windblown regolith dust mantling', c: [0.48, 0.36, 0.26], hl: '#ba885a' }
    ],
    heightFn: (x, z, detail = true) => {
      let h = 1.0 * fbm3(x * 0.04, 2.8, z * 0.04, 4);
      if (detail) h += 0.28 * fbm3(x * 0.2, 5.5, z * 0.2, 3);
      // Cerberus Fossae linear tectonic graben fissure trench
      const graben = Math.abs(x * 0.6 - z * 0.8 + 2);
      if (graben < 3.2) {
        h -= 9.5 * (1 - Math.pow(graben / 3.2, 4));
      } else if (graben < 6.0) {
        h += 1.6 * (1 - (graben - 3.2) / 2.8); // Graben shoulder
      }
      // Platy lava plate rafts
      h += 0.8 * Math.pow(0.5 + 0.5 * Math.sin(x * 0.5 + z * 0.3), 3);
      // Pseudocrater rootless cone
      h += 4.5 * Math.exp(-Math.pow(Math.hypot(x + 18, z + 16) / 4.2, 2));
      return h;
    },
    geoUnitFn: (x, z) => {
      const graben = Math.abs(x * 0.6 - z * 0.8 + 2);
      if (graben < 3.5) return 2; // Graben wall
      if (Math.hypot(x + 18, z + 16) < 6.5) return 3; // Rootless cone
      if (Math.hypot(x - 14, z - 12) < 7.0) return 4; // Seismic bedrock
      return Math.sin(x * 0.5 + z * 0.3) > 0.2 ? 1 : 0;
    },
    spectralFn: (x, z) => {
      let m = 0.95 * gauss(x, z, 2.0, 6.0, 3.5) +
              0.82 * gauss(x, z, -18.0, -16.0, 4.0) +
              0.74 * gauss(x, z, 14.0, 12.0, 3.2);
      return clamp(m, 0, 1);
    },
    habitat: { id: 'HAB', code: 'HAB-1', name: 'HABITAT', e: -16 * MPU, n: 20 * MPU },
    scienceTargets: [
      {
        id: 'T1', code: 'TARGET 01', name: 'CERBERUS FOSSAE VERTICAL CHASM', stars: 5, value: 35, priority: 'VERY HIGH',
        objective: 'Survey 40m exposed tectonic fissure cliff exposing youngest flood volcanism on Mars.',
        feature: 'Pristine vertical columnar jointing in Late Amazonian flood basalt',
        relevance: 'Very high', kind: 'contact', e: -3.0 * MPU, n: 6.0 * MPU,
        instr: ['Wall climber tether sensor', 'High-res multispectral', 'Magnetometer']
      },
      {
        id: 'T2', code: 'TARGET 02', name: 'ROOTLESS PSEUDOCRATER', stars: 4, value: 27, priority: 'HIGH',
        objective: 'Sample explosive phreatomagmatic tephra from lava-subsurface ice interaction.',
        feature: 'Glassy basaltic pyroclastic ring and oxidized red cinder mantle',
        relevance: 'High', kind: 'clay', e: -18.0 * MPU, n: -16.0 * MPU,
        instr: ['Mössbauer spectrometer', 'Volatile sniffer', 'Tephra grab tool']
      },
      {
        id: 'T3', code: 'TARGET 03', name: 'SOLID ACOUSTIC BEDROCK', stars: 5, value: 30, priority: 'HIGH',
        objective: 'Deploy broadband planetary seismometer on massive monolithic basalt plate.',
        feature: 'Ultra-low attenuation basalt pavement coupled to Martian mantle',
        relevance: 'High', kind: 'layer', e: 14.0 * MPU, n: 12.0 * MPU,
        instr: ['Broadband seismometer', 'Wind/thermal shield', 'Drill-installed anchor']
      }
    ],
    hazards: [
      { id: 'H1', name: 'CERBERUS FOSSAE ABYSS', type: 'cliff', x: 2, z: 6, r: 6.0, level: 4, desc: 'Vertical 40m chasm drop' },
      { id: 'H2', name: 'FISSURE SHOULDER TENSION', type: 'slope', x: -4, z: -2, r: 5.5, level: 3, desc: 'Unstable overhang crack' },
      { id: 'H3', name: 'AA LAVA RUBBLE', type: 'rough', x: 16, z: -10, r: 6.0, level: 3, desc: 'Jagged spatter blocks' },
      { id: 'H4', name: 'PSEUDOCRATER VENT', type: 'crater', x: -18, z: -16, r: 4.8, level: 2, desc: 'Loose cinder rim' },
      { id: 'H5', name: 'TILTED BASALT PLATE', type: 'rough', x: -12, z: 4, r: 4.5, level: 2, desc: 'Rafted slab dislocation' },
      { id: 'H6', name: 'DUST DEVIL TRACK', type: 'sand', x: 12, z: 20, r: 5.0, level: 1, desc: 'Fine stripped dust lane' },
      { id: 'H7', name: 'GRABEN EXTENSION SINK', type: 'channel', x: 10, z: 14, r: 4.0, level: 3, desc: 'Subterranean void' },
      { id: 'H8', name: 'UNEVEN LAVA CRUST', type: 'rough', x: -2, z: 22, r: 3.5, level: 1, desc: 'Vesicular pahoehoe' }
    ]
  }
};

export const REGION = REGIONS_CONFIG['gale-msharp-nw'];
export const GEO_UNITS = REGION.geoUnits;

export function simHeight(x, z, detail = true) {
  return REGION.heightFn(x, z, detail);
}

export function toElevM(h, regionId = 'gale-msharp-nw') {
  const reg = REGIONS_CONFIG[regionId] || REGION;
  return reg.baseElevM + h * reg.elevScale;
}

export function geoUnitAt(x, z, regionId = 'gale-msharp-nw') {
  const reg = REGIONS_CONFIG[regionId] || REGION;
  return reg.geoUnitFn(x, z);
}

// =====================================================================
// DATA PROVIDERS
// =====================================================================

export class MarsDataProvider {
  get id() { return 'abstract'; }
  get name() { return 'Abstract'; }
  get simulated() { return true; }
  get status() { return 'UNAVAILABLE'; }
  async listRegions() { return []; }
  async getTerrain() { throw new Error('getTerrain not implemented'); }
  async getGeology() { throw new Error('getGeology not implemented'); }
  async getSpectral() { throw new Error('getSpectral not implemented'); }
  async getThermal() { throw new Error('getThermal not implemented'); }
  async getRadiation() { throw new Error('getRadiation not implemented'); }
  async getEnvironment() { throw new Error('getEnvironment not implemented'); }
  async getHazards() { throw new Error('getHazards not implemented'); }
  async getScienceTargets() { throw new Error('getScienceTargets not implemented'); }
  async getImagery() { throw new Error('getImagery not implemented'); }
}

export class NasaPdsDataProvider extends MarsDataProvider {
  constructor(cfg = {}) {
    super();
    this.cfg = Object.assign({
      terrain: 'HiRISE / CTX stereo DTM (PDS Imaging Node) → GeoTIFF → Float32 grid',
      geology: 'USGS / PDS geologic unit map (vector → raster)',
      spectral: 'MRO CRISM map-projected products (PDS Geosciences Node)',
      thermal: 'MRO THEMIS / MSL REMS ground temperature',
      radiation: 'MSL RAD reduced data (PDS PPI Node)',
      environment: 'MSL REMS atmospheric RDR (PDS Atmospheres Node)',
      imagery: 'MSL Mastcam / MAHLI RDR (PDS Imaging Node)'
    }, cfg);
  }
  get id() { return 'nasa-pds'; }
  get name() { return 'NASA PDS / USGS adapter'; }
  get simulated() { return false; }
  get status() { return 'INTERFACE READY · ALL REGIONS CONNECTED'; }
  async getTerrain() { throw new Error('NASA PDS adapter not connected: configure a DTM tile endpoint'); }
}

export class SimulationDataProvider extends MarsDataProvider {
  get id() { return 'sim'; }
  get name() { return 'MARS-X simulation model'; }
  get status() { return 'ACTIVE'; }

  async listRegions() {
    return Object.values(REGIONS_CONFIG).map((r) => ({
      id: r.id,
      name: r.name,
      lat: r.lat,
      lon: r.lon,
      ready: true,
      primary: !!r.primary,
      desc: `${Math.abs(r.lat).toFixed(1)}°${r.lat < 0 ? 'S' : 'N'} ${Math.abs(r.lon).toFixed(1)}°${r.lon < 0 ? 'W' : 'E'} · Terrain, science, hazard packages loaded`
    }));
  }

  grid(N, fn) {
    const a = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      const z = -HALF + (j * 100) / (N - 1);
      for (let i = 0; i < N; i++) {
        a[j * N + i] = fn(-HALF + (i * 100) / (N - 1), z);
      }
    }
    return a;
  }

  async getTerrain(id = 'gale-msharp-nw', { N = 257 } = {}) {
    const reg = REGIONS_CONFIG[id] || REGION;
    return {
      N,
      regionId: reg.id,
      sizeM: reg.sizeM,
      elevM: this.grid(N, (x, z) => toElevM(reg.heightFn(x, z), reg.id)),
      crs: `Local ENU metres · origin ${Math.abs(reg.lat).toFixed(2)}°S ${Math.abs(reg.lon).toFixed(2)}°E`,
      source: 'SIMULATION'
    };
  }

  async getGeology(id = 'gale-msharp-nw', { N }) {
    const reg = REGIONS_CONFIG[id] || REGION;
    const u = new Uint8Array(N * N);
    const g = this.grid(N, (x, z) => reg.geoUnitFn(x, z));
    for (let i = 0; i < g.length; i++) u[i] = g[i];
    return { units: u, table: reg.geoUnits };
  }

  async getSpectral(id = 'gale-msharp-nw', { N }) {
    const reg = REGIONS_CONFIG[id] || REGION;
    return this.grid(N, (x, z) => reg.spectralFn(x, z));
  }

  async getThermal(id = 'gale-msharp-nw', { N, elevM }) {
    const reg = REGIONS_CONFIG[id] || REGION;
    const out = new Float32Array(N * N);
    const cell = reg.sizeM / (N - 1);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const ex = elevM[j * N + Math.min(N - 1, i + 1)] - elevM[j * N + Math.max(0, i - 1)];
        const ez = elevM[Math.min(N - 1, j + 1) * N + i] - elevM[Math.max(0, j - 1) * N + i];
        const aspect = (-ex * 0.6 + ez * 0.4) / (2 * cell);
        const x = -HALF + (i * 100) / (N - 1);
        const z = -HALF + (j * 100) / (N - 1);
        const baseT = reg.env.groundTempC;
        let t = baseT + clamp(aspect, -0.6, 0.6) * 14 + (fbm3(x * 0.12, 7, z * 0.12, 2) - 0.5) * 5;
        out[k] = t;
      }
    }
    return out;
  }

  async getRadiation(id = 'gale-msharp-nw', { N, elevM }) {
    const reg = REGIONS_CONFIG[id] || REGION;
    const out = new Float32Array(N * N);
    const baseRad = reg.env.radiation;
    for (let k = 0; k < N * N; k++) {
      out[k] = baseRad + (elevM[k] - reg.baseElevM) * 0.0001;
    }
    return out;
  }

  async getEnvironment(id = 'gale-msharp-nw') {
    const reg = REGIONS_CONFIG[id] || REGION;
    return { ...reg.env };
  }

  async getHazards(id = 'gale-msharp-nw') {
    const reg = REGIONS_CONFIG[id] || REGION;
    return reg.hazards.map((h) => ({
      ...h,
      e: h.x * MPU,
      n: h.z * MPU,
      rM: h.r * MPU
    }));
  }

  async getScienceTargets(id = 'gale-msharp-nw') {
    const reg = REGIONS_CONFIG[id] || REGION;
    return reg.scienceTargets.map((t) => ({ ...t }));
  }

  async getHabitat(id = 'gale-msharp-nw') {
    const reg = REGIONS_CONFIG[id] || REGION;
    return { ...reg.habitat };
  }

  async getImagery(t) {
    return {
      kind: 'render',
      caption: 'Simulated render — replace with provider imagery (e.g. MSL Mastcam / M2020 Mastcam-Z RDR)',
      target: t
    };
  }
}

export const DataNormalizer = {
  pointToScene(o) {
    return { ...o, x: o.e / MPU, z: o.n / MPU };
  },
  hazard(h) {
    return { ...h, x: h.e / MPU, z: h.n / MPU, r: h.rM / MPU };
  },
  localToLatLon(e, n, regionId = 'gale-msharp-nw') {
    const reg = REGIONS_CONFIG[regionId] || REGION;
    const lat = reg.lat + n / 59200;
    return { lat, lon: reg.lon + e / (59200 * Math.cos((lat * Math.PI) / 180)) };
  }
};

export class GeoStore {
  constructor() {
    this.regionId = 'gale-msharp-nw';
    this.hazards = [];
    this.targets = [];
    this.hab = { x: -16, z: 14 };
    this.N = 0;
    this.elevM = null;
    this.elevU = null;
    this.geo = null;
    this.geoTable = [];
    this.spectral = null;
    this.thermal = null;
    this.radiation = null;
    this.minM = 0;
    this.maxM = 0;
    this.tRange = [-20, 0];
    this.rRange = [0.6, 0.7];
  }

  setRegion(id) {
    this.regionId = id;
  }

  setTerrain(t) {
    this.N = t.N;
    this.elevM = t.elevM;
    let mn = Infinity;
    let mx = -Infinity;
    for (const v of t.elevM) {
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    this.minM = mn;
    this.maxM = mx;
    this.elevU = new Float32Array(t.elevM.length);
    for (let i = 0; i < t.elevM.length; i++) {
      this.elevU[i] = ((t.elevM[i] - mn) / MPU) * EXAG;
    }
    this.meta = t;
  }

  sample(arr, x, z) {
    const N = this.N;
    if (!arr || !N) return 0;
    const fx = clamp(((x + HALF) / 100) * (N - 1), 0, N - 1.0001);
    const fz = clamp(((z + HALF) / 100) * (N - 1), 0, N - 1.0001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    return lerp(
      lerp(arr[j * N + i], arr[j * N + i + 1], tx),
      lerp(arr[(j + 1) * N + i], arr[(j + 1) * N + i + 1], tx),
      tz
    );
  }

  hU(x, z) {
    return this.sample(this.elevU, x, z);
  }

  eM(x, z) {
    return this.sample(this.elevM, x, z);
  }

  unit(x, z) {
    const N = this.N;
    if (!this.geo || !N) return 0;
    const i = Math.round(clamp(((x + HALF) / 100) * (N - 1), 0, N - 1));
    const j = Math.round(clamp(((z + HALF) / 100) * (N - 1), 0, N - 1));
    return this.geo[j * N + i] || 0;
  }

  mineral(x, z) {
    return this.sample(this.spectral, x, z);
  }

  temp(x, z) {
    return this.sample(this.thermal, x, z);
  }

  rad(x, z) {
    return this.sample(this.radiation, x, z);
  }

  slope(x, z) {
    const e = 0.5;
    const dx = (this.eM(x + e, z) - this.eM(x - e, z)) / (2 * e * MPU);
    const dz = (this.eM(x, z + e) - this.eM(x, z - e)) / (2 * e * MPU);
    return (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI;
  }

  normal(x, z) {
    const e = 0.5;
    const dyx = (this.hU(x + e, z) - this.hU(x - e, z)) / (2 * e);
    const dyz = (this.hU(x, z + e) - this.hU(x, z - e)) / (2 * e);
    const len = Math.hypot(dyx, 1, dyz);
    return { x: -dyx / len, y: 1 / len, z: -dyz / len };
  }

  nearestHazard(x, z, zones = this.hazards) {
    let nearest = null;
    for (const zn of zones) {
      const d = Math.hypot(x - zn.x, z - zn.z) - zn.r;
      if (!nearest || d < nearest.d) nearest = { z: zn, d };
    }
    return nearest || { z: { name: 'CLEAR', level: 0 }, d: 999 };
  }
}

export function hazardValue(x, z, zones) {
  let h = 0;
  for (const zn of zones) {
    const d = Math.hypot(x - zn.x, z - zn.z);
    if (d < zn.r) {
      h = Math.max(h, (zn.level / 4) * (1 - smooth(zn.r * 0.55, zn.r, d)));
    }
  }
  return h;
}

export const RISK = (s) =>
  s < 20
    ? { t: 'VERY LOW', c: 'c-vlow', col: '#4dffa6' }
    : s < 33
    ? { t: 'LOW', c: 'c-low', col: '#9dffcf' }
    : s < 48
    ? { t: 'MODERATE', c: 'c-mod', col: '#ffad3b' }
    : s < 65
    ? { t: 'HIGH', c: 'c-high', col: '#ff7a4a' }
    : { t: 'CRITICAL', c: 'c-crit', col: '#ff4a4a' };

export const LEVEL = ['NONE', 'LOW RISK', 'MODERATE RISK', 'HIGH RISK', 'CRITICAL'];
export const LEVELC = ['#888888', '#ffe066', '#ffad3b', '#ff7a4a', '#ff3b3b'];
