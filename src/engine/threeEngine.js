import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import gsap from 'gsap';

import {
  clamp, lerp, smooth, rng, fbm3, tween, bearing, compass, fmtHM, pad2
} from './math.js';
import {
  MPU, EXAG, HALF, REGION, REGIONS_CONFIG, SIM, CRATERS, GEO_UNITS,
  geoUnitAt, simHeight, toElevM, DataNormalizer, hazardValue, LEVEL, LEVELC
} from './dataProvider.js';
import {
  COLORSPACE, OVERLAY_VS, OVERLAY_FS, ROUTE_FS, beamMat, createGlowTexture
} from './shaders.js';

export const AERIAL = {
  pos: new THREE.Vector3(-46, 34, 46),
  tgt: new THREE.Vector3(-1, 2, -2)
};

export class MarsXEngine {
  constructor(canvas, onLabelUpdate, onHudUpdate, onLog) {
    this.canvas = canvas;
    this.onLabelUpdate = onLabelUpdate || (() => {});
    this.onHudUpdate = onHudUpdate || (() => {});
    this.onLog = onLog || (() => {});

    this.GLOW = createGlowTexture();
    this.clock = new THREE.Clock();

    // Scene & Renderer
    this.reducedPref =
      (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ||
      (typeof navigator !== 'undefined' && (navigator.hardwareConcurrency || 8) <= 4);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.reducedPref ? 1 : 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.88;
    this.renderer.shadowMap.enabled = !this.reducedPref;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.01, 600);
    this.camera.position.set(0, 0.5, 3.6);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.enabled = false;

    this.globeScene = new THREE.Scene();
    this.terrainScene = new THREE.Scene();
    this.activeScene = this.globeScene;

    // Shared GLTF & Draco Model Loader
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('/draco/gltf/');
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(this.dracoLoader);

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.globeScene, this.camera);
    this.composer.addPass(this.renderPass);

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.75,
      0.55,
      0.72
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    // Internal State
    this.G = {};
    this.T = { markers: [], zones: [], wps: [], routeVis: {}, overlayU: null };
    this.terrainU = { uTime: { value: 0 } };
    this.labels = [];
    this.mode = 'boot';
    this.spin = true;
    this.fx = !this.reducedPref;
    this.viewShift = 0;
    this.surface = false;
    this.hud = false;
    this.busy = false;
    this.planning = false;
    this.eva = null;
    this.onEvaTick = null;
    this.onFinishEVA = null;
    this._evaAcc = 0;

    this.surf = {
      pos: new THREE.Vector2(),
      yaw: 0,
      pitch: -0.05,
      keys: {},
      drag: null
    };

    this.SHARED = {
      ring: new THREE.RingGeometry(0.55, 0.66, 48),
      ring2: new THREE.RingGeometry(0.95, 1.0, 64),
      beam: new THREE.CylinderGeometry(0.07, 0.07, 9, 10, 1, true).translate(0, 4.5, 0),
      oct: new THREE.OctahedronGeometry(0.45, 0),
      scan: new THREE.RingGeometry(1.25, 1.33, 64)
    };

    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._c = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._n = new THREE.Vector3();

    this.ray = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.setupListeners();
  }

  setupListeners() {
    this._onResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.composer.setSize(window.innerWidth, window.innerHeight);
      this.applyViewShift();
    };
    window.addEventListener('resize', this._onResize);

    this._onKeyDown = (e) => {
      const k = e.key.toLowerCase();
      this.surf.keys[k] = true;
      if (e.shiftKey) this.surf.keys.shift = true;
      if (k === 'escape') {
        if (this.surface) this.exitSurface();
        else if (this.hud) this.toggleHUD(false);
      }
    };
    this._onKeyUp = (e) => {
      this.surf.keys[e.key.toLowerCase()] = false;
      if (!e.shiftKey) this.surf.keys.shift = false;
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);

    this._onPointerDown = (e) => {
      this.downAt = { x: e.clientX, y: e.clientY };
      if (this.surface) {
        this.surf.drag = {
          x: e.clientX,
          y: e.clientY,
          yaw: this.surf.yaw,
          pitch: this.surf.pitch
        };
      }
    };
    this.canvas.addEventListener('pointerdown', this._onPointerDown);

    this._onPointerMove = (e) => {
      if (this.surface && this.surf.drag) {
        this.surf.yaw = this.surf.drag.yaw - (e.clientX - this.surf.drag.x) * 0.004;
        this.surf.pitch = clamp(this.surf.drag.pitch - (e.clientY - this.surf.drag.y) * 0.003, -1, 0.8);
      }
      if (this.mode === 'globe' && this.G.planet) {
        this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
        this.ray.setFromCamera(this.mouse, this.camera);
        const h = this.ray.intersectObject(this.G.planet, false)[0];
        if (h) {
          const p = this.G.planet.worldToLocal(h.point.clone());
          const ll = this.vecToLatLon(p);
          this.cursorLL = `LAT ${Math.abs(ll.lat).toFixed(2)}°${ll.lat < 0 ? 'S' : 'N'}  LON ${Math.abs(ll.lon).toFixed(2)}°${ll.lon < 0 ? 'W' : 'E'}`;
        } else {
          this.cursorLL = '';
        }
        this.canvas.style.cursor = this.ray.intersectObjects(this.G.hits || [], false).length ? 'pointer' : '';
      }
    };
    window.addEventListener('pointermove', this._onPointerMove);

    this._onPointerUp = (e) => {
      this.surf.drag = null;
      if (e.target !== this.canvas) return;
      if (!this.downAt || Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 5 || this.busy) {
        return;
      }
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this.ray.setFromCamera(this.mouse, this.camera);

      if (this.mode === 'globe') {
        const h = this.ray.intersectObjects(this.G.hits || [], false)[0];
        if (h && h.object.userData.site) {
          this.onSiteClick(h.object.userData.site);
          return;
        }
      }

      if (this.mode === 'terrain' && !this.surface) {
        const objs = [
          ...(this.layers?.targets ? this.T.markers.map((m) => m.hit) : []),
          ...this.T.wps.map((w) => w.hit)
        ];
        const h = this.ray.intersectObjects(objs, false)[0];
        if (h) {
          if (h.object.userData.target && this.onSelectTarget) {
            this.onSelectTarget(h.object.userData.target.id);
          } else if (h.object.userData.wp) {
            this.flyToPoint(h.object.userData.wp.x, h.object.userData.wp.z, 16);
          }
          return;
        }

        const th = this.ray.intersectObject(this.T.mesh, false)[0];
        if (th && this.onProbe) {
          this.onProbe(th.point, e);
        }
      }
    };
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
  }

  applyViewShift() {
    if (Math.abs(this.viewShift) < 0.5) {
      this.camera.clearViewOffset();
    } else {
      this.camera.setViewOffset(
        window.innerWidth,
        window.innerHeight,
        this.viewShift,
        0,
        window.innerWidth,
        window.innerHeight
      );
    }
  }

  setScene(s) {
    this.activeScene = s;
    this.renderPass.scene = s;
    document.body.classList.toggle('orbit', s === this.globeScene);
    if (s === this.globeScene) {
      this.camera.near = 0.01;
      this.camera.far = 600;
      this.bloom.strength = 0.65;
      this.bloom.threshold = 0.82;
    } else {
      this.camera.near = 0.05;
      this.camera.far = 2600;
      this.bloom.strength = 0.22;
      this.bloom.threshold = 1.25;
    }
    this.camera.updateProjectionMatrix();
  }

  configGlobeControls() {
    this.controls.minDistance = 1.25;
    this.controls.maxDistance = 9;
    this.controls.enablePan = true;
    this.controls.panSpeed = 0.4;
    this.controls.rotateSpeed = 0.45;
    this.controls.zoomSpeed = 0.7;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.minPolarAngle = 0;
    this.controls.target.set(0, 0, 0);
  }

  configTerrainControls() {
    this.controls.minDistance = 5;
    this.controls.maxDistance = 240;
    this.controls.enablePan = true;
    this.controls.panSpeed = 0.8;
    this.controls.rotateSpeed = 0.5;
    this.controls.zoomSpeed = 1;
    this.controls.maxPolarAngle = 1.46;
    this.controls.minPolarAngle = 0.05;
    this.controls.screenSpacePanning = false;
  }

  latLonToVec3(lat, lon, r = 1) {
    const phi = ((lon + 180) / 360) * Math.PI * 2;
    const th = ((90 - lat) * Math.PI) / 180;
    return new THREE.Vector3(
      -Math.cos(phi) * Math.sin(th) * r,
      Math.cos(th) * r,
      Math.sin(phi) * Math.sin(th) * r
    );
  }

  vecToLatLon(p) {
    const r = p.length();
    const lat = 90 - (Math.acos(clamp(p.y / r, -1, 1)) * 180) / Math.PI;
    let phi = Math.atan2(p.z, -p.x);
    if (phi < 0) phi += Math.PI * 2;
    return { lat, lon: (phi / (Math.PI * 2)) * 360 - 180 };
  }

  makeMarsTextures(W, H) {
    const feats = [
      { lat: 10, lon: 70, rx: 20, ry: 13, k: -0.34, h: 0 },
      { lat: -42, lon: 70, rx: 20, ry: 12, k: 0.22, h: -0.9 },
      { lat: 18, lon: -134, rx: 6, ry: 6, k: 0.1, h: 1.4 },
      { lat: -1, lon: -112, rx: 16, ry: 22, k: 0.06, h: 0.7 },
      { lat: -5, lon: -15, rx: 28, ry: 10, k: -0.24, h: 0 },
      { lat: -25, lon: 150, rx: 38, ry: 14, k: -0.2, h: 0.1 },
      { lat: 20, lon: -60, rx: 20, ry: 12, k: 0.08, h: -0.2 },
      { lat: 50, lon: 0, rx: 180, ry: 22, k: 0.04, h: -0.5 },
      { lat: -50, lon: -100, rx: 30, ry: 12, k: -0.12, h: 0.2 },
      { lat: 25, lon: 130, rx: 22, ry: 12, k: 0.1, h: -0.3 }
    ];
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(W, H);

    const bv = document.createElement('canvas');
    bv.width = W;
    bv.height = H;
    const bctx = bv.getContext('2d');
    const bimg = bctx.createImageData(W, H);

    const dark = [0.30, 0.15, 0.09];
    const mid = [0.70, 0.38, 0.21];
    const bright = [0.88, 0.62, 0.43];

    for (let y = 0; y < H; y++) {
      const lat = 90 - ((y + 0.5) / H) * 180;
      const cl = Math.cos((lat * Math.PI) / 180);
      const sl = Math.sin((lat * Math.PI) / 180);
      for (let x = 0; x < W; x++) {
        const lon = ((x + 0.5) / W) * 360 - 180;
        const phi = ((lon + 180) / 360) * Math.PI * 2;
        const px = -Math.cos(phi) * cl;
        const pz = Math.sin(phi) * cl;
        const py = sl;
        const n = fbm3(px * 2.2 + 5, py * 2.2, pz * 2.2, 5);
        const n2 = fbm3(px * 9, py * 9 + 3, pz * 9, 3);
        let alb = 0.5 + (n - 0.5) * 1.1 + (n2 - 0.5) * 0.35;
        let hh = (n - 0.5) * 0.8 + (n2 - 0.5) * 0.4;

        for (const f of feats) {
          const dl = ((lon - f.lon + 540) % 360) - 180;
          const g = Math.exp(-((dl / f.rx) ** 2 + ((lat - f.lat) / f.ry) ** 2));
          alb += f.k * g * 1.4;
          hh += f.h * g;
        }

        if (lon > -95 && lon < -35) {
          const vm =
            Math.exp(-Math.pow((lat + 8 + Math.sin(lon * 0.12) * 2) / 1.4, 2)) *
            smooth(-95, -85, lon) *
            (1 - smooth(-45, -35, lon));
          alb -= vm * 0.35;
          hh -= vm * 1.2;
        }
        if (lat > 35) alb = lerp(alb, 0.5 + (n2 - 0.5) * 0.3, 0.35);

        alb = clamp(alb, 0, 1);
        let c =
          alb < 0.5
            ? [
                lerp(dark[0], mid[0], alb * 2),
                lerp(dark[1], mid[1], alb * 2),
                lerp(dark[2], mid[2], alb * 2)
              ]
            : [
                lerp(mid[0], bright[0], (alb - 0.5) * 2),
                lerp(mid[1], bright[1], (alb - 0.5) * 2),
                lerp(mid[2], bright[2], (alb - 0.5) * 2)
              ];

        const cap =
          lat > 0
            ? smooth(78, 84, lat + (n2 - 0.5) * 6)
            : smooth(80, 86, -lat + (n2 - 0.5) * 6);
        c = c.map((v, i) => lerp(v, [0.95, 0.93, 0.9][i], cap));

        const o = (y * W + x) * 4;
        img.data[o] = c[0] * 255;
        img.data[o + 1] = c[1] * 255;
        img.data[o + 2] = c[2] * 255;
        img.data[o + 3] = 255;

        const hv = clamp(128 + hh * 70, 0, 255);
        bimg.data[o] = bimg.data[o + 1] = bimg.data[o + 2] = hv;
        bimg.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    bctx.putImageData(bimg, 0, 0);

    const R = rng(7);
    const crater = (lat, lon, rd, darkVal = 0.35) => {
      const x = ((lon + 180) / 360) * W;
      const y = ((90 - lat) / 180) * H;
      const rx = rd / Math.max(0.25, Math.cos((lat * Math.PI) / 180));
      const ry = rd;
      for (const [g, cc] of [
        [ctx, `rgba(40,18,8,${darkVal})`],
        [bctx, 'rgba(0,0,0,.5)']
      ]) {
        g.save();
        g.beginPath();
        g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        g.fillStyle = cc;
        g.fill();
        g.lineWidth = Math.max(1, rd * 0.25);
        g.strokeStyle = g === ctx ? 'rgba(240,190,150,.25)' : 'rgba(255,255,255,.6)';
        g.stroke();
        g.restore();
      }
    };

    for (let i = 0; i < 520; i++) {
      const lat = (R() * 2 - 1) * 75;
      const lon = R() * 360 - 180;
      if (lat > 40 && R() < 0.7) continue;
      crater(lat, lon, 0.6 + Math.pow(R(), 3) * 7 * (W / 2048), 0.12 + R() * 0.2);
    }
    crater(-5.4, 137.8, 7 * (W / 2048) * 2.2, 0.28);
    crater(-42.4, 70.5, 50 * (W / 2048), 0.06);
    crater(18.4, 77.5, 2.5 * (W / 2048) * 2, 0.3);

    const ox = ((137.8 + 180) / 360) * W;
    const oy = ((90 + 5.4) / 180) * H;
    ctx.beginPath();
    ctx.arc(ox + 1, oy + 1, 3 * (W / 2048) * 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(210,150,100,.7)';
    ctx.fill();

    const map = new THREE.CanvasTexture(cv);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    const bump = new THREE.CanvasTexture(bv);
    return { map, bump };
  }

  makeDustTexture(W, H) {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const lat = 90 - ((y + 0.5) / H) * 180;
      const cl = Math.cos((lat * Math.PI) / 180);
      const sl = Math.sin((lat * Math.PI) / 180);
      for (let x = 0; x < W; x++) {
        const phi = ((x + 0.5) / W) * Math.PI * 2;
        const px = -Math.cos(phi) * cl;
        const pz = Math.sin(phi) * cl;
        const n = fbm3(px * 3 + 11, sl * 6, pz * 3, 4);
        const a = clamp((n - 0.52) * 3.2, 0, 1) * (1 - Math.abs(sl) * 0.6);
        const o = (y * W + x) * 4;
        img.data[o] = 235;
        img.data[o + 1] = 200;
        img.data[o + 2] = 165;
        img.data[o + 3] = a * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  async buildGlobe(regions) {
    const big = !this.reducedPref;
    const { map, bump } = this.makeMarsTextures(big ? 1536 : 1024, big ? 768 : 512);

    this.G.group = new THREE.Group();
    this.globeScene.add(this.G.group);

    this.G.planet = new THREE.Mesh(
      new THREE.SphereGeometry(1, 128, 96),
      new THREE.MeshStandardMaterial({
        map,
        bumpMap: bump,
        bumpScale: 2.2,
        roughness: 0.96,
        metalness: 0
      })
    );
    this.G.group.add(this.G.planet);

    this.G.dust = new THREE.Mesh(
      new THREE.SphereGeometry(1.012, 96, 64),
      new THREE.MeshStandardMaterial({
        map: this.makeDustTexture(512, 256),
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        roughness: 1
      })
    );
    this.G.group.add(this.G.dust);

    // Atmosphere Glow
    const atmV = `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `;
    this.G.atm = new THREE.Mesh(
      new THREE.SphereGeometry(1.09, 64, 48),
      new THREE.ShaderMaterial({
        vertexShader: atmV,
        fragmentShader: `
          varying vec3 vN;
          varying vec3 vV;
          uniform vec3 uC;
          void main() {
            float a = abs(dot(vN, vV));
            float k = pow(clamp(a / 0.42, 0., 1.), 3.0) * 0.85;
            gl_FragColor = vec4(uC * k, k);
            ${COLORSPACE}
          }
        `,
        uniforms: { uC: { value: new THREE.Color(1, 0.55, 0.32) } },
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    this.globeScene.add(this.G.atm);

    this.G.group.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(1.004, 64, 48),
        new THREE.ShaderMaterial({
          vertexShader: atmV,
          fragmentShader: `
            varying vec3 vN;
            varying vec3 vV;
            void main() {
              float f = pow(1.0 - max(dot(vN, vV), 0.), 4.0);
              gl_FragColor = vec4(vec3(1., .5, .28) * f * .55 + vec3(.3, .7, 1.) * pow(f, 8.) * .35, f);
              ${COLORSPACE}
            }
          `,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      )
    );

    // Lat/Lon grid
    const gp = [];
    for (let lat = -75; lat <= 75; lat += 15) {
      for (let lon = -180; lon < 180; lon += 3) {
        gp.push(this.latLonToVec3(lat, lon, 1.006), this.latLonToVec3(lat, lon + 3, 1.006));
      }
    }
    for (let lon = -180; lon < 180; lon += 15) {
      for (let lat = -84; lat < 84; lat += 3) {
        gp.push(this.latLonToVec3(lat, lon, 1.006), this.latLonToVec3(lat + 3, lon, 1.006));
      }
    }
    this.G.grid = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(gp),
      new THREE.LineBasicMaterial({
        color: 0x5fe1ff,
        transparent: true,
        opacity: 0.09,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    this.G.group.add(this.G.grid);

    // Lights
    const sun = new THREE.DirectionalLight(0xfff1e0, 2.2);
    sun.position.set(5, 1.6, 3.2);
    this.globeScene.add(sun);
    this.G.sun = sun;
    this.globeScene.add(new THREE.AmbientLight(0x223344, 0.16));

    // Stars
    const sp = new Float32Array(5000 * 3);
    const sc = new Float32Array(5000 * 3);
    const R = rng(3);
    for (let i = 0; i < 5000; i++) {
      const v = new THREE.Vector3(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1)
        .normalize()
        .multiplyScalar(80 + R() * 60);
      sp.set([v.x, v.y, v.z], i * 3);
      const t = R();
      sc.set([0.75 + t * 0.25, 0.8 + t * 0.15, 1], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    this.globeScene.add(
      new THREE.Points(
        sg,
        new THREE.PointsMaterial({
          size: 0.22,
          vertexColors: true,
          map: this.GLOW,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      )
    );

    // Soft fill light for orbital assets
    const orbitFill = new THREE.DirectionalLight(0x7090b0, 0.7);
    orbitFill.position.set(-5, -2, -3);
    this.globeScene.add(orbitFill);

    // Orbits
    this.G.orbits = [];
    [
      [1.55, 0.45, 0.18, 'RELAY-1'],
      [2.05, -0.32, 0.11, 'RELAY-2']
    ].forEach(([r, tilt, spd, name]) => {
      const og = new THREE.Group();
      og.rotation.set(tilt, 0, tilt * 0.6);
      this.globeScene.add(og);

      const pts = new THREE.EllipseCurve(0, 0, r, r)
        .getPoints(200)
        .map((p) => new THREE.Vector3(p.x, 0, p.y));
      og.add(
        new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineDashedMaterial({
            color: 0x5fe1ff,
            transparent: true,
            opacity: 0.25,
            dashSize: 0.03,
            gapSize: 0.03
          })
        )
      );
      og.children[0].computeLineDistances();

      // Satellite parent group that traverses the orbit
      const sat = new THREE.Group();
      og.add(sat);

      // Faint beacon sprite so the satellite is visible at extreme distances
      const beacon = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.GLOW,
          color: 0x5fe1ff,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0.45
        })
      );
      beacon.scale.setScalar(0.04);
      sat.add(beacon);

      // Wrapper group for the 3D model
      const modelWrap = new THREE.Group();
      sat.add(modelWrap);

      const o = { g: og, sat, modelWrap, satModel: null, beacon, r, spd, a: Math.random() * 6 };
      this.G.orbits.push(o);

      this.addLabel(
        `<div class="bx"><b>${name}</b> <small>NASA TDRS · ORBITAL RELAY</small></div>`,
        'site minor',
        (v) => sat.getWorldPosition(v),
        this.globeScene,
        { dy: 6 }
      );
    });

    // Load NASA TDRS 3D Satellite Model
    this.gltfLoader.load(
      '/models/tdrs.glb',
      (gltf) => {
        const raw = gltf.scene;
        const box = new THREE.Box3().setFromObject(raw);
        const center = new THREE.Vector3();
        box.getCenter(center);

        raw.traverse((child) => {
          if (child.isMesh && child.material) {
            child.castShadow = true;
            child.receiveShadow = true;
            const m = child.material;
            m.side = THREE.DoubleSide;
            if (m.name === 'AntennaGold') {
              m.metalness = 0.88;
              m.roughness = 0.22;
              m.color = new THREE.Color(0xf5c332);
              m.emissive = new THREE.Color(0x382806);
            } else if (m.name === 'WingBlue' || m.name === 'InnerWingBlue') {
              m.metalness = 0.65;
              m.roughness = 0.28;
              m.color = new THREE.Color(0x2743a6);
              m.emissive = new THREE.Color(0x0c1642);
            } else if (m.name === 'InnerDish' || m.name === 'Default_Material') {
              m.metalness = 0.25;
              m.roughness = 0.5;
              m.color = new THREE.Color(0xe0e6ed);
            } else {
              m.metalness = Math.max(m.metalness || 0, 0.3);
              m.roughness = Math.min(m.roughness || 1, 0.65);
            }
            m.needsUpdate = true;
          }
        });

        this.G.orbits.forEach((o, idx) => {
          const clone = raw.clone(true);
          // Center model at origin
          clone.position.set(-center.x, -center.y, -center.z);

          const modelContainer = new THREE.Group();
          modelContainer.add(clone);
          // Scale to visible proportion around Mars (span ~0.14 scene units)
          modelContainer.scale.setScalar(0.14);

          if (idx === 1) {
            modelContainer.rotation.y = Math.PI * 0.35;
          }

          o.modelWrap.add(modelContainer);
          o.satModel = modelContainer;
        });
      },
      undefined,
      (err) => {
        console.warn('Failed to load TDRS 3D model, fallback beacon active:', err);
      }
    );

    // Sites
    this.G.sites = [];
    this.G.hits = [];
    for (const s of regions) {
      const pos = this.latLonToVec3(s.lat, s.lon, 1.006);
      const g = new THREE.Group();
      g.position.copy(pos);
      g.lookAt(pos.clone().multiplyScalar(2));
      this.G.group.add(g);

      const col = s.primary ? 0xffad3b : 0x5fe1ff;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.016, 0.021, 48),
        new THREE.MeshBasicMaterial({
          color: col,
          transparent: true,
          opacity: s.primary ? 1 : 0.6,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      );
      g.add(ring);

      const pulse = ring.clone();
      pulse.material = ring.material.clone();
      g.add(pulse);

      const dot = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.GLOW,
          color: col,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      );
      dot.scale.setScalar(s.primary ? 0.05 : 0.03);
      g.add(dot);

      if (s.primary) {
        const sp2 = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(),
            new THREE.Vector3(0, 0, 0.12)
          ]),
          new THREE.LineBasicMaterial({
            color: col,
            transparent: true,
            opacity: 0.8
          })
        );
        g.add(sp2);
      }

      const hit = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 8, 8),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
      );
      hit.userData.site = s;
      g.add(hit);
      this.G.hits.push(hit);

      const lab = this.addLabel(
        `<div class="bx"><b>${s.name.toUpperCase()}</b><br><small>${Math.abs(s.lat).toFixed(1)}°${s.lat < 0 ? 'S' : 'N'} ${Math.abs(s.lon).toFixed(1)}°${s.lon < 0 ? 'W' : 'E'} · ${s.ready ? 'MISSION REGION' : 'NO DATA PACKAGE'}</small></div>`,
        'site' + (s.primary ? '' : ' minor'),
        (v) => g.getWorldPosition(v),
        this.globeScene,
        { occlude: true, dy: 8, onClick: () => this.onSiteClick(s) }
      );

      this.G.sites.push({ s, g, ring, pulse, lab });
      if (s.primary) this.G.gale = g;
    }
  }

  async buildTerrainScene(store, HAB, ENV) {
    this.store = store;
    this.HAB = HAB;
    this.ENV = ENV;
    const N = store.N;
    const n = N * N;
    const S = this.terrainScene;
    S.background = new THREE.Color(0x2a170e);
    S.fog = new THREE.FogExp2(0x6b3f28, 0.0010);

    // Sky Dome
    if (!this.T.skyDome) {
      this.T.skyDome = new THREE.Mesh(
        new THREE.SphereGeometry(1400, 32, 16),
        new THREE.ShaderMaterial({
          side: THREE.BackSide,
          depthWrite: false,
          uniforms: { uS: { value: new THREE.Vector3(-0.6, 0.35, 0.5).normalize() } },
          vertexShader: `
            varying vec3 vD;
            void main() {
              vD = normalize(position);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
            }
          `,
          fragmentShader: `
            varying vec3 vD;
            uniform vec3 uS;
            void main() {
              float y = vD.y;
              vec3 hz = vec3(.42, .26, .17);
              vec3 zn = vec3(.12, .07, .05);
              vec3 c = mix(hz, zn, smoothstep(-.05, .55, y));
              float s = max(dot(vD, uS), 0.);
              c += vec3(.25, .38, .48) * pow(s, 24.) * .22 + vec3(.95, .88, .75) * pow(s, 400.) * 0.8;
              gl_FragColor = vec4(c, 1.);
              ${COLORSPACE}
            }
          `
        })
      );
      S.add(this.T.skyDome);
    }

    // Terrain geometry from store grid
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const aE = new Float32Array(n);
    const aS = new Float32Array(n);
    const aH = new Float32Array(n);
    const aM = new Float32Array(n);
    const aG = new Float32Array(n);
    const aEd = new Float32Array(n);
    const aT = new Float32Array(n);
    const aR = new Float32Array(n);

    let tmin = Infinity;
    let tmax = -Infinity;
    let rmin = Infinity;
    let rmax = -Infinity;

    for (let k = 0; k < n; k++) {
      tmin = Math.min(tmin, store.thermal[k]);
      tmax = Math.max(tmax, store.thermal[k]);
      rmin = Math.min(rmin, store.radiation[k]);
      rmax = Math.max(rmax, store.radiation[k]);
    }
    store.tRange = [tmin, tmax];
    store.rRange = [rmin, rmax];

    const cell = 100 / (N - 1);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const x = -HALF + i * cell;
        const z = -HALF + j * cell;
        const y = store.elevU[k];
        pos.set([x, y, z], k * 3);
        uv.set([i / (N - 1), j / (N - 1)], k * 2);

        const ex =
          (store.elevM[j * N + Math.min(N - 1, i + 1)] -
            store.elevM[j * N + Math.max(0, i - 1)]) /
          (2 * cell * MPU);
        const ez =
          (store.elevM[Math.min(N - 1, j + 1) * N + i] -
            store.elevM[Math.max(0, j - 1) * N + i]) /
          (2 * cell * MPU);
        const sl = Math.atan(Math.hypot(ex, ez)) * 57.3;

        const u = store.geo[k];
        const unitDef = (store.geoTable && store.geoTable[u]) || GEO_UNITS[u] || GEO_UNITS[0] || { c: [0.6, 0.4, 0.3] };
        const base = unitDef.c || [0.6, 0.4, 0.3];
        const nz = fbm3(x * 0.35, 2.2, z * 0.35, 3);
        const nz2 = fbm3(x * 1.7, 8, z * 1.7, 2);
        const sh = 1 - clamp(sl / 40, 0, 0.45);
        const v = (0.76 + nz * 0.20 + nz2 * 0.08) * sh;

        col.set([base[0] * v, base[1] * v, base[2] * v], k * 3);
        aE[k] = (store.elevM[k] - store.minM) / (store.maxM - store.minM);
        aS[k] = sl / 45;
        aM[k] = store.spectral[k];
        aG[k] = u;

        let md = 9;
        for (let dj = -2; dj <= 2; dj++) {
          for (let di = -2; di <= 2; di++) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
            if (store.geo[jj * N + ii] !== u) md = Math.min(md, di * di + dj * dj);
          }
        }
        aEd[k] = md > 8 ? 0 : 1 - Math.sqrt(md) / 3;
        aT[k] = (store.thermal[k] - tmin) / (tmax - tmin);
        aR[k] = (store.radiation[k] - rmin) / (rmax - rmin);
        aH[k] = hazardValue(x, z, store.hazards);
      }
    }

    const idx = new Uint32Array((N - 1) * (N - 1) * 6);
    let q = 0;
    for (let j = 0; j < N - 1; j++) {
      for (let i = 0; i < N - 1; i++) {
        const a = j * N + i;
        const b = a + 1;
        const c = a + N;
        const d = c + 1;
        idx.set([a, c, b, b, c, d], q);
        q += 6;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();

    this.T.geo = geo;
    this.T.matReal = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.97,
      metalness: 0
    });
    this.T.matHolo = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: this.terrainU,
      vertexShader: `
        varying vec3 vP;
        void main() {
          vP = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vP;
        float g(float v, float s) {
          float f = v / s;
          return 1. - smoothstep(0., fwidth(f) * 1.2, abs(fract(f + .5) - .5));
        }
        void main() {
          float l = max(max(g(vP.x, 2.), g(vP.z, 2.)), g(vP.y, .5)) * .8;
          float sw = exp(-pow(fract(vP.x * .01 - uTime * .08) - .5, 2.) * 400.);
          gl_FragColor = vec4(vec3(.1, .65, .9) * (.14 + l) + vec3(.4, 1., 1.) * sw * .3, 1.);
          ${COLORSPACE}
        }
      `
    });

    this.T.mesh = new THREE.Mesh(geo, this.T.matReal);
    this.T.mesh.receiveShadow = true;
    this.T.mesh.castShadow = true;
    S.add(this.T.mesh);

    // Overlay (data layers)
    const og = new THREE.BufferGeometry();
    og.setAttribute('position', geo.attributes.position);
    og.setIndex(geo.index);
    [
      ['aElev', aE], ['aSlope', aS], ['aHaz', aH], ['aMin', aM],
      ['aGeo', aG], ['aEdge', aEd], ['aTemp', aT], ['aRad', aR]
    ].forEach(([nm, a]) => og.setAttribute(nm, new THREE.BufferAttribute(a, 1)));

    this.T.overlayU = {
      uTime: this.terrainU.uTime,
      uElev: { value: 0 },
      uScan: { value: 0 },
      uGeo: { value: 0 },
      uMin: { value: 0 },
      uTemp: { value: 0 },
      uRad: { value: 0 },
      uHaz: { value: 0 },
      uElevRange: { value: store.maxM - store.minM },
      uRadBoost: { value: 0 }
    };

    this.T.overlay = new THREE.Mesh(
      og,
      new THREE.ShaderMaterial({
        vertexShader: OVERLAY_VS,
        fragmentShader: OVERLAY_FS,
        uniforms: this.T.overlayU,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2
      })
    );
    this.T.overlay.renderOrder = 2;
    S.add(this.T.overlay);
    this.T.overlayGeo = og;

    // Far context terrain seamless backdrop for active region
    const FN = 160;
    const FS = 900;
    const fg = new THREE.PlaneGeometry(FS, FS, FN, FN);
    fg.rotateX(-Math.PI / 2);
    const fp = fg.attributes.position;
    const fc = new Float32Array(fp.count * 3);
    const reg = (store && store.regionId && REGIONS_CONFIG[store.regionId]) || REGION;
    const baseC = (reg.geoUnits && reg.geoUnits[0]?.c) || [0.48, 0.32, 0.22];

    for (let i = 0; i < fp.count; i++) {
      const x = fp.getX(i);
      const z = fp.getZ(i);
      const maxCoord = Math.max(Math.abs(x), Math.abs(z));
      const hRaw = reg.heightFn(x, z, false);
      const elevM = toElevM(hRaw, reg.id);
      let farY = ((elevM - store.minM) / MPU) * EXAG;

      // Gentle distant regional backdrop framing
      const distFromCenter = Math.hypot(x, z);
      farY += 12 * smooth(180, 420, distFromCenter) + 4 * fbm3(x * 0.015, 2.5, z * 0.015, 3) * smooth(120, 380, distFromCenter);

      // Seamless boundary stitching: exactly match store.hU at the 50m inner border
      let y;
      if (maxCoord <= 48) {
        y = store.hU(x, z) - 0.25; // tucked just under main high-res terrain mesh
      } else if (maxCoord <= 56) {
        const blend = (maxCoord - 48) / 8;
        const clampedX = clamp(x, -49.5, 49.5);
        const clampedZ = clamp(z, -49.5, 49.5);
        const edgeY = store.hU(clampedX, clampedZ);
        y = lerp(edgeY, farY, blend);
      } else {
        y = farY;
      }
      fp.setY(i, y);

      const v = 0.70 + fbm3(x * 0.04, 1.2, z * 0.04, 3) * 0.25;
      fc.set([baseC[0] * v, baseC[1] * v, baseC[2] * v], i * 3);
    }
    fg.setAttribute('color', new THREE.BufferAttribute(fc, 3));
    fg.computeVertexNormals();
    this.T.far = new THREE.Mesh(
      fg,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0, metalness: 0 })
    );
    this.T.far.receiveShadow = true;
    S.add(this.T.far);

    // Calibrated Martian Lighting (1.52 AU solar irradiance)
    const sun = new THREE.DirectionalLight(0xffe2cc, 1.25);
    sun.position.set(-75, 38, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -75, right: 75, top: 75, bottom: -75, near: 1, far: 300
    });
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.05;
    S.add(sun);
    this.T.sun = sun;
    const hemi = new THREE.HemisphereLight(0xb86e46, 0x1f140e, 0.28);
    S.add(hemi);
    this.T.hemi = hemi;

    // Rocks (instanced & firmly grounded with slope-aligned normal embedding)
    const R = rng(11);
    const RC = this.reducedPref ? 900 : 2600;
    const rockG = new THREE.DodecahedronGeometry(0.075, 0);
    const rockM = new THREE.MeshStandardMaterial({
      color: 0x482c1e, roughness: 0.95, flatShading: true
    });
    this.T.rocks = new THREE.InstancedMesh(rockG, rockM, RC);
    const m4 = new THREE.Matrix4();
    const qq = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const nVec = new THREE.Vector3();
    const yawQ = new THREE.Quaternion();
    let placed = 0;
    while (placed < RC) {
      // Place only within safe exploration zone (never outside high-res terrain)
      const x = (R() * 2 - 1) * 44;
      const z = (R() * 2 - 1) * 44;
      const dens =
        0.12 +
        1.6 * THREE.MathUtils.clamp(Math.exp(-((x - 9.5) ** 2 + (z - -9) ** 2) / 18), 0, 1) +
        1.2 * THREE.MathUtils.clamp(Math.exp(-((x - -1) ** 2 + (z - -10) ** 2) / 72), 0, 1) +
        0.8 * THREE.MathUtils.clamp(Math.exp(-((x - 4) ** 2 + (z - 18) ** 2) / 24), 0, 1) +
        0.5 * (store.slope(x, z) > 14 ? 1 : 0);
      if (R() > dens) continue;
      if (Math.hypot(x + 2, z - 7) < 7) continue;
      if (Math.hypot(x - HAB.x + 3.2, z - HAB.z - 2.4) < 4.5) continue;

      const s = 0.4 + Math.pow(R(), 3) * 2.2;
      const aspectY = 0.45 + R() * 0.35;
      sc.set(s, s * aspectY, s);

      // Surface normal alignment so rock base follows the exact local slope
      const norm = store.normal ? store.normal(x, z) : { x: 0, y: 1, z: 0 };
      nVec.set(norm.x, norm.y, norm.z);
      qq.setFromUnitVectors(up, nVec);
      yawQ.setFromAxisAngle(nVec, R() * Math.PI * 2);
      qq.multiply(yawQ);

      // Embed rock ~45% into ground so it is firmly seated in the regolith, never hovering
      const groundY = store.hU(x, z);
      const rockRadius = 0.075 * sc.y;
      const posY = groundY + rockRadius * 0.40;

      m4.compose(new THREE.Vector3(x, posY, z), qq, sc);
      this.T.rocks.setMatrixAt(placed++, m4);
    }
    this.T.rocks.castShadow = true;
    this.T.rocks.receiveShadow = true;
    S.add(this.T.rocks);

    this.buildHabitat();
    this.buildTargets();
    this.buildHazardZones();
    this.buildDust();
    this.buildFootprints();
    this.buildAstronaut();

    this.routeGroup = new THREE.Group();
    this.terrainScene.add(this.routeGroup);
  }

  loadHabitatModel(cb) {
    if (this._habitatTemplate) {
      cb(this._habitatTemplate.clone(true));
      return;
    }
    if (!this._habitatLoadingCallbacks) {
      this._habitatLoadingCallbacks = [cb];
      this.gltfLoader.load(
        '/models/habitat.glb',
        (gltf) => {
          const raw = gltf.scene;
          const box = new THREE.Box3().setFromObject(raw);
          const size = new THREE.Vector3();
          box.getSize(size);
          const center = new THREE.Vector3();
          box.getCenter(center);

          raw.traverse((child) => {
            if (child.isMesh && child.material) {
              child.castShadow = true;
              child.receiveShadow = true;
              child.material.side = THREE.DoubleSide;
              child.material.needsUpdate = true;
            }
          });

          // Center horizontally and put base flat on ground
          raw.position.set(-center.x, -box.min.y, -center.z);

          const wrap = new THREE.Group();
          wrap.add(raw);

          // Proportional scale to fit within the 2.7m radius pad
          const maxHoriz = Math.max(size.x, size.z);
          const scale = maxHoriz > 0 ? 4.6 / maxHoriz : 1.0;
          wrap.scale.setScalar(scale);

          this._habitatTemplate = wrap;
          const cbs = this._habitatLoadingCallbacks || [];
          this._habitatLoadingCallbacks = null;
          cbs.forEach((fn) => fn(wrap.clone(true)));
        },
        undefined,
        (err) => {
          console.warn('Failed to load Habitat 3D model:', err);
        }
      );
    } else {
      this._habitatLoadingCallbacks.push(cb);
    }
  }

  loadAstronautModel(cb) {
    if (this._astronautTemplate) {
      cb(this._astronautTemplate.clone(true));
      return;
    }
    if (!this._astronautLoadingCallbacks) {
      this._astronautLoadingCallbacks = [cb];
      this.gltfLoader.load(
        '/models/astronaut.glb',
        (gltf) => {
          const raw = gltf.scene;
          const box = new THREE.Box3().setFromObject(raw);
          const size = new THREE.Vector3();
          box.getSize(size);
          const center = new THREE.Vector3();
          box.getCenter(center);

          raw.traverse((child) => {
            if (child.isMesh && child.material) {
              child.castShadow = true;
              child.receiveShadow = true;
              const m = child.material;
              m.side = THREE.DoubleSide;
              if (m.name && m.name.toLowerCase().includes('aceshelme')) {
                m.metalness = 0.92;
                m.roughness = 0.15;
                m.color = new THREE.Color(0xf5ba31);
                m.emissive = new THREE.Color(0x332200);
              } else if (m.name && m.name.toLowerCase().includes('blinn')) {
                m.metalness = 0.6;
                m.roughness = 0.3;
              } else {
                m.roughness = Math.min(m.roughness || 1, 0.7);
              }
              m.needsUpdate = true;
            }
          });

          // Center horizontally and put boots on ground
          raw.position.set(-center.x, -box.min.y, -center.z);

          const wrap = new THREE.Group();
          wrap.add(raw);

          // Target height: 2.0 scene units tall
          const scale = size.y > 0 ? 2.0 / size.y : 1.0;
          wrap.scale.setScalar(scale);

          this._astronautTemplate = wrap;
          const cbs = this._astronautLoadingCallbacks || [];
          this._astronautLoadingCallbacks = null;
          cbs.forEach((fn) => fn(wrap.clone(true)));
        },
        undefined,
        (err) => {
          console.warn('Failed to load Astronaut 3D model:', err);
        }
      );
    } else {
      this._astronautLoadingCallbacks.push(cb);
    }
  }

  buildHabitat() {
    const g = new THREE.Group();
    const hx = this.HAB.x - 3.2;
    const hz = this.HAB.z + 2.4;
    const y = this.store.hU(hx, hz);
    g.position.set(hx, y, hz);

    // Egress / landing pad perimeter ring
    const pad = new THREE.Mesh(
      new THREE.RingGeometry(2.7, 2.85, 64),
      new THREE.MeshBasicMaterial({
        color: 0x5fe1ff,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.12;
    g.add(pad);

    // Habitat comms mast & beacon
    const mw = new THREE.MeshStandardMaterial({ color: 0xe9e4dc, roughness: 0.5, metalness: 0.2 });
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.2, 6), mw);
    mast.position.set(2.0, 1.6, 1.8);
    g.add(mast);

    const beacon = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.GLOW,
        color: 0x7ff0ff,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    beacon.position.set(2.0, 3.3, 1.8);
    beacon.scale.setScalar(1.4);
    g.add(beacon);
    this.T.beacon = beacon;

    // 3D NASA Habitat Demonstration Unit
    const habContainer = new THREE.Group();
    g.add(habContainer);

    this.loadHabitatModel((model) => {
      habContainer.add(model);
    });

    this.terrainScene.add(g);
    this.T.hab = g;

    this.addLabel(
      `<div class="bx"><b>HAB-1 · HABITAT</b><br><small>NASA HDU · EVA EGRESS</small></div>`,
      '',
      (v) => v.set(hx, y + 4.2, hz),
      this.terrainScene
    );
  }

  markerGroup(color, big = false) {
    const g = new THREE.Group();
    const add = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const r1 = new THREE.Mesh(this.SHARED.ring, add);
    r1.rotation.x = -Math.PI / 2;
    const r2 = new THREE.Mesh(this.SHARED.ring2, add.clone());
    r2.material.opacity = 0.55;

    const beam = new THREE.Mesh(this.SHARED.beam, beamMat(color));
    const core = new THREE.Mesh(
      this.SHARED.oct,
      new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending
      })
    );
    const coreIn = new THREE.Mesh(
      this.SHARED.oct,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    coreIn.scale.setScalar(0.6);

    const top = new THREE.Group();
    top.position.y = big ? 2.4 : 1.6;
    top.add(core, coreIn, r2);

    const scan = new THREE.Mesh(this.SHARED.scan, add.clone());
    scan.rotation.x = -Math.PI / 2;
    scan.material.opacity = 0;

    g.add(r1, beam, top, scan);
    g.userData = { r1, r2, beam, core, top, scan };
    if (big) g.scale.setScalar(1.25);
    return g;
  }

  buildTargets() {
    this.T.markers = [];
    for (const t of this.store.targets) {
      const g = this.markerGroup(0xffad3b, true);
      const y = this.store.hU(t.x, t.z);
      g.position.set(t.x, y, t.z);
      g.visible = false;
      this.terrainScene.add(g);

      const hit = new THREE.Mesh(
        new THREE.SphereGeometry(2.2, 8, 8),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
      );
      hit.position.y = 2.4;
      hit.userData.target = t;
      g.add(hit);

      const lab = this.addLabel(
        `<div class="bx"><b>${t.code}</b> <span class="stars">${'★'.repeat(t.stars)}${'☆'.repeat(5 - t.stars)}</span><br>${t.name}</div>`,
        't',
        (v) => v.set(t.x, y + 5.2, t.z),
        this.terrainScene,
        { onClick: () => this.onSelectTarget && this.onSelectTarget(t.id) }
      );
      lab.visible = false;
      this.T.markers.push({ t, g, hit, lab, y });
    }
  }

  buildHazardZones() {
    this.T.zoneGroup = new THREE.Group();
    this.terrainScene.add(this.T.zoneGroup);
    this.T.zones = [];
    for (const z of this.store.hazards) {
      this.addZoneVis(z);
    }
  }

  addZoneVis(z) {
    const col = LEVELC[z.level];
    const y = this.store.hU(z.x, z.z);
    const g = new THREE.Group();
    g.position.set(z.x, y - 1, z.z);

    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(z.r, z.r, 4.5, 64, 1, true).translate(0, 2.25, 0),
      beamMat(col)
    );
    cyl.material.uniforms.uO.value = 0.35;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(z.r * 0.96, z.r, 96),
      new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 1.4;

    const pr = ring.clone();
    pr.material = ring.material.clone();
    g.add(cyl, ring, pr);
    g.userData = { cyl, ring, pr, z };
    g.visible = !!this.layers?.hazards;
    this.T.zoneGroup.add(g);

    const lab = this.addLabel(
      `<div class="bx"><b>⚠ ${z.name}</b><br><small>${LEVEL[z.level]}</small></div>`,
      'hz',
      (v) => v.set(z.x, y + 4.5, z.z),
      this.terrainScene
    );
    lab.visible = !!this.layers?.hazards;
    this.T.zones.push({ g, z, lab });
    return g;
  }

  buildDust() {
    const C = this.reducedPref ? 700 : 2200;
    const p = new Float32Array(C * 3);
    const R = rng(5);
    for (let i = 0; i < C; i++) {
      p.set([(R() * 2 - 1) * 60, R() * 14 + 1, (R() * 2 - 1) * 60], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.T.dust = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        size: 0.35,
        map: this.GLOW,
        color: 0xffcf9c,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    this.terrainScene.add(this.T.dust);
    this.T.dustBase = p.slice();
  }

  buildFootprints() {
    this.T.fp = new THREE.Group();
    this.T.fp.visible = false;
    this.terrainScene.add(this.T.fp);
    const R = rng(21);
    this.T.fpL = [];

    for (const t of this.store.targets) {
      for (let k = 0; k < 3; k++) {
        const a = R() * 6.28;
        const d = 3 + R() * 3;
        const x = t.x + Math.cos(a) * d;
        const z = t.z + Math.sin(a) * d;
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.9, 1.8, 4, 1, true),
          new THREE.MeshBasicMaterial({
            color: 0xb48cff,
            wireframe: true,
            transparent: true,
            opacity: 0.8
          })
        );
        cone.position.set(x, this.store.hU(x, z) + 1.2, z);
        cone.lookAt(t.x, this.store.hU(t.x, t.z) + 1, t.z);
        cone.rotateX(Math.PI / 2);
        this.T.fp.add(cone);
      }
      const lab = this.addLabel(
        `<div class="bx" style="border-color:#b48cff"><b style="color:#d4bfff">IMG · ${t.code}</b><br><small>3 FRAMES · SIM RENDER</small></div>`,
        '',
        (v) => v.set(t.x + 4, this.store.hU(t.x, t.z) + 2.5, t.z + 4),
        this.terrainScene,
        { onClick: () => this.onShowRover && this.onShowRover(t) }
      );
      lab.visible = false;
      this.T.fpL.push(lab);
    }
  }

  buildAstronaut() {
    const g = new THREE.Group();

    // Telemetry aura and ground ring
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.GLOW,
        color: 0x7ff0ff,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.35
      })
    );
    glow.scale.setScalar(2.6);
    glow.position.y = 1.0;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 0.98, 48),
      new THREE.MeshBasicMaterial({
        color: 0x5fe1ff,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;

    // 3D NASA ACES Astronaut Model
    const astroContainer = new THREE.Group();
    g.add(glow, ring, astroContainer);

    this.loadAstronautModel((model) => {
      astroContainer.add(model);
    });

    g.scale.setScalar(1.2);
    g.visible = false;
    this.terrainScene.add(g);
    this.T.astro = g;
    this.T.astroRing = ring;

    this.T.astroLab = this.addLabel(
      `<div class="bx"><b>EV-1</b> <small id="evLab">NASA ACES · ASTRONAUT</small></div>`,
      '',
      (v) => v.copy(g.position).add(new THREE.Vector3(0, 3.2, 0)),
      this.terrainScene
    );
    this.T.astroLab.visible = false;
  }

  addLabel(html, cls, getPos, scene, opts = {}) {
    const L = {
      id: Math.random().toString(36).substring(2, 9),
      html,
      cls,
      getPos,
      scene,
      visible: true,
      occlude: opts.occlude,
      dy: opts.dy || 0,
      onClick: opts.onClick,
      pos: { x: 0, y: 0, visible: false }
    };
    this.labels.push(L);
    return L;
  }

  removeLabel(L) {
    const i = this.labels.indexOf(L);
    if (i >= 0) this.labels.splice(i, 1);
  }

  updateLabels() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const active = [];

    for (const L of this.labels) {
      if (!L.visible || L.scene !== this.activeScene) {
        L.pos.visible = false;
        continue;
      }
      L.getPos(this._v);
      if (L.occlude) {
        this._n.copy(this._v).normalize();
        this._c.copy(this.camera.position).sub(this._v).normalize();
        if (this._n.dot(this._c) < 0.08) {
          L.pos.visible = false;
          continue;
        }
      }
      this._v.project(this.camera);
      if (this._v.z > 1 || this._v.z < -1 || Math.abs(this._v.x) > 1.2 || Math.abs(this._v.y) > 1.2) {
        L.pos.visible = false;
        continue;
      }
      L.pos.x = (this._v.x * 0.5 + 0.5) * w;
      L.pos.y = (-this._v.y * 0.5 + 0.5) * h - L.dy;
      L.pos.visible = true;
      active.push(L);
    }
    this.onLabelUpdate(active);
  }

  camTo(pos, tgt, dur = 2, ease = 'power3.inOut') {
    if (this.surface) return Promise.resolve();
    const p0 = this.camera.position.clone();
    const t0 = this.controls.target.clone();
    this.controls.enabled = false;
    return tween(dur, (t) => {
      this.camera.position.lerpVectors(p0, pos, t);
      this.controls.target.lerpVectors(t0, tgt, t);
      this.camera.lookAt(this.controls.target);
    }, ease).then(() => {
      if (this.mode === 'terrain' && !this.eva?.follow) this.controls.enabled = true;
      this.controls.update();
    });
  }

  flyToPoint(x, z, dist = 22) {
    const tgt = new THREE.Vector3(x, this.store.hU(x, z) + 1, z);
    const dir = this.camera.position.clone().sub(this.controls.target).setY(0).normalize();
    const pos = tgt.clone().add(dir.multiplyScalar(dist)).add(new THREE.Vector3(0, dist * 0.6, 0));
    return this.camTo(pos, tgt, 1.8);
  }

  overview(dur = 2.2) {
    return this.camTo(new THREE.Vector3(-16, 62, 40), new THREE.Vector3(-1, 1, -3), dur);
  }

  focusSite(siteId, dur = 1.8) {
    const siteObj = (this.G.sites || []).find((x) => x.s.id === siteId);
    if (!siteObj) return Promise.resolve();
    const m = new THREE.Vector3();
    siteObj.g.getWorldPosition(m);
    const dir = m.clone().normalize();
    this.spin = false;
    return this.camTo(dir.multiplyScalar(3.2), new THREE.Vector3(0, 0, 0), dur, 'power2.out');
  }

  clearTerrainScene() {
    this.labels = (this.labels || []).filter((L) => L.scene !== this.terrainScene);
    this.clearRouteVis();
    this.clearWaypoints();
    if (this.T.mesh) {
      this.terrainScene.remove(this.T.mesh);
      this.T.mesh.geometry?.dispose();
      this.T.matReal?.dispose();
      this.T.matHolo?.dispose();
      this.T.mesh = null;
    }
    if (this.T.rocks) {
      this.terrainScene.remove(this.T.rocks);
      this.T.rocks.geometry?.dispose();
      this.T.rocks.material?.dispose();
      this.T.rocks = null;
    }
    if (this.T.far) {
      this.terrainScene.remove(this.T.far);
      this.T.far.geometry?.dispose();
      this.T.far.material?.dispose();
      this.T.far = null;
    }
    if (this.T.markers) {
      this.T.markers.forEach((m) => this.terrainScene.remove(m.g));
      this.T.markers = [];
    }
    if (this.T.zoneGroup) {
      this.terrainScene.remove(this.T.zoneGroup);
      this.T.zoneGroup = null;
      this.T.zones = [];
    }
    if (this.T.hab) {
      this.terrainScene.remove(this.T.hab);
      this.T.hab = null;
    }
    if (this.T.dust) {
      this.terrainScene.remove(this.T.dust);
      this.T.dust.geometry?.dispose();
      this.T.dust.material?.dispose();
      this.T.dust = null;
    }
    if (this.T.fp) {
      this.terrainScene.remove(this.T.fp);
      this.T.fp = null;
      this.T.fpL = [];
    }
    if (this.T.astro) {
      this.terrainScene.remove(this.T.astro);
      this.T.astro = null;
      this.T.astroRing = null;
      this.T.astroLab = null;
    }
    if (this.T.comm) {
      this.terrainScene.remove(this.T.comm);
      this.T.comm = null;
    }
    if (this.T.sun) {
      this.terrainScene.remove(this.T.sun);
      this.T.sun.dispose?.();
      this.T.sun = null;
    }
    if (this.T.hemi) {
      this.terrainScene.remove(this.T.hemi);
      this.T.hemi.dispose?.();
      this.T.hemi = null;
    }
  }

  async rebuildTerrainScene(store, HAB, ENV) {
    this.clearTerrainScene();
    await this.buildTerrainScene(store, HAB, ENV);
  }

  scanBurst(M, delay = 0) {
    const s = M.g.userData.scan;
    gsap.fromTo(s.scale, { x: 0.3, y: 0.3, z: 0.3 }, { x: 3.2, y: 3.2, z: 3.2, duration: 1.6, delay, ease: 'power2.out' });
    gsap.fromTo(s.material, { opacity: 0.95 }, { opacity: 0, duration: 1.6, delay, ease: 'power2.in' });
  }

  setLayer(id, on, cons = { events: [] }) {
    if (!this.layers) this.layers = {};
    this.layers[id] = on;
    if (this.mode === 'globe' || this.mode === 'landing') return;
    const U = this.T.overlayU;
    if (!U) return;
    const fade = (u, v, d = 1.1) => gsap.to(U[u], { value: v, duration: d, ease: 'power2.out' });

    switch (id) {
      case 'terrain':
        this.T.mesh.material = on ? this.T.matReal : this.T.matHolo;
        this.T.rocks.visible = on;
        this.T.far.visible = on;
        this.terrainScene.fog.density = on ? (this.surface ? 0.0005 : 0.0010) : 0.0006;
        break;
      case 'elevation':
        if (on) {
          U.uElev.value = 1;
          U.uScan.value = 0;
          gsap.to(U.uScan, { value: 1.06, duration: 2.6, ease: 'power1.inOut' });
        } else fade('uElev', 0, 0.6);
        break;
      case 'geology':
        fade('uGeo', on ? 1 : 0);
        break;
      case 'mineral':
        if (on) {
          U.uMin.value = 0;
          gsap.to(U.uMin, { value: 1, duration: 1.6, ease: 'elastic.out(1,.5)' });
        } else fade('uMin', 0, 0.6);
        break;
      case 'temperature':
        fade('uTemp', on ? 1 : 0, 1.6);
        break;
      case 'radiation':
        fade('uRad', on ? 1 : 0, 1.4);
        break;
      case 'atmosphere':
        gsap.to(this.T.dust.material, {
          opacity: on ? (cons.events.includes('weather') ? 0.9 : 0.45) : 0,
          duration: 1.4
        });
        break;
      case 'imagery':
        this.T.fp.visible = on;
        this.T.fpL.forEach((l) => (l.visible = on));
        if (on) {
          this.T.fp.children.forEach((c, i) =>
            gsap.from(c.scale, { x: 0, y: 0, z: 0, duration: 0.6, delay: i * 0.04, ease: 'back.out(2)' })
          );
        }
        break;
      case 'hazards':
        fade('uHaz', on ? 1 : 0);
        this.T.zones.forEach((Z, i) => {
          Z.lab.visible = on;
          if (on) {
            Z.g.visible = true;
            Z.g.scale.set(1, 0.01, 1);
            gsap.to(Z.g.scale, { y: 1, duration: 0.9, delay: i * 0.07, ease: 'power3.out' });
          } else {
            gsap.to(Z.g.scale, {
              y: 0.01,
              duration: 0.4,
              onComplete: () => {
                Z.g.visible = false;
              }
            });
          }
        });
        break;
      case 'targets':
        this.T.markers.forEach((M, i) => {
          M.lab.visible = on;
          if (on) {
            M.g.visible = true;
            M.g.position.y = M.y - 5;
            M.g.userData.top.scale.setScalar(0.01);
            gsap.to(M.g.position, { y: M.y, duration: 1.4, delay: i * 0.25, ease: 'power3.out' });
            gsap.to(M.g.userData.top.scale, {
              x: 1, y: 1, z: 1, duration: 1, delay: 0.4 + i * 0.25, ease: 'back.out(2)'
            });
            this.scanBurst(M, 0.8 + i * 0.25);
          } else {
            gsap.to(M.g.position, {
              y: M.y - 5,
              duration: 0.6,
              onComplete: () => {
                M.g.visible = false;
              }
            });
          }
        });
        break;
    }
  }

  updateHazardAttr(cons) {
    const a = this.T.overlayGeo.attributes.aHaz;
    const N = this.store.N;
    const cell = 100 / (N - 1);
    const zones = [...this.store.hazards, ...cons.extraZones];

    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const x = -HALF + i * cell;
        const z = -HALF + j * cell;
        let h = hazardValue(x, z, zones);
        if (cons.comm) {
          const dc = Math.hypot(x - cons.comm.x, z - cons.comm.z);
          if (dc > cons.comm.r) h = Math.max(h, 0.4 * smooth(cons.comm.r, cons.comm.r + 6, dc));
        }
        a.array[k] = h;
      }
    }
    a.needsUpdate = true;
  }

  makeRouteVis(r, color, { radius = 0.17, opacity = 1 } = {}) {
    const pts = r.line.map((p) => new THREE.Vector3(p.x, this.store.hU(p.x, p.z) + 0.32, p.z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    curve.arcLengthDivisions = 3000;

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 0 },
        uTime: this.terrainU.uTime,
        uOpacity: { value: opacity },
        uColor: { value: new THREE.Color(color) },
        uLen: { value: r.distM / 100 },
        uBad: { value: 0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
        }
      `,
      fragmentShader: ROUTE_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(curve, Math.min(2400, pts.length * 2), radius, 6, false),
      mat
    );
    mesh.renderOrder = 5;
    this.routeGroup.add(mesh);

    const thin = new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(
          r.line.map((p) => new THREE.Vector3(p.x, this.store.hU(p.x, p.z) + 0.06, p.z)),
          false,
          'centripetal'
        ),
        Math.min(2400, pts.length * 2),
        0.022,
        4,
        false
      ),
      mat
    );
    thin.renderOrder = 5;
    thin.visible = this.surface;
    mesh.visible = !this.surface;
    this.routeGroup.add(thin);

    const PC = this.reducedPref ? 30 : 80;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PC * 3), 3));
    const parts = new THREE.Points(
      pg,
      new THREE.PointsMaterial({
        size: 1.1,
        map: this.GLOW,
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    parts.renderOrder = 6;
    this.routeGroup.add(parts);

    return { mesh, thin, mat, curve, parts, r, PC };
  }

  disposeVis(v) {
    if (!v) return;
    [v.mesh, v.thin, v.parts].forEach((o) => {
      this.routeGroup.remove(o);
      o.geometry.dispose();
      o.material.dispose();
    });
  }

  clearRouteVis() {
    Object.values(this.T.routeVis).forEach((v) => this.disposeVis(v));
    this.T.routeVis = {};
    this.clearWaypoints();
  }

  clearWaypoints() {
    this.T.wps.forEach((w) => {
      this.terrainScene.remove(w.g);
      this.removeLabel(w.lab);
    });
    this.T.wps = [];
  }

  buildWaypoints(r) {
    this.clearWaypoints();
    const WPCOL = { hab: 0xffffff, wp: 0x5fe1ff, target: 0xffad3b, hazard: 0xff4a4a, return: 0x4dffa6 };

    r.waypoints.forEach((w, i) => {
      if (w.type === 'hab' && !w.end && i > 0) return;
      if (w.type === 'target') return;
      const y = this.store.hU(w.x, w.z);
      const g = this.markerGroup(WPCOL[w.type]);
      g.position.set(w.x, y, w.z);
      g.scale.setScalar(0.01);
      this.terrainScene.add(g);

      const hit = new THREE.Mesh(
        new THREE.SphereGeometry(1.4, 8, 8),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
      );
      hit.position.y = 1.6;
      hit.userData.wp = w;
      g.add(hit);

      const cls = { hazard: 'hz', return: 'ret', target: 't' }[w.type] || '';
      const nm = w.type === 'hab' ? (w.end ? 'RETURN · HAB-1' : 'EGRESS · HAB-1') : w.name;

      const lab = this.addLabel(
        `<div class="bx"><b>${nm}</b><br><small>${(w.d / 1000).toFixed(2)} km · ${w.type === 'hazard' ? 'CLEARANCE ' + Math.round(w.clear) + ' m · ' : ''}T+${fmtHM(w.t)}</small></div>`,
        'click ' + cls,
        (v) => v.set(w.x, y + 3.4, w.z),
        this.terrainScene,
        { onClick: () => this.flyToPoint(w.x, w.z, 16) }
      );
      lab.visible = false;
      this.T.wps.push({ g, lab, w, hit });
      gsap.to(g.scale, {
        x: 1, y: 1, z: 1, duration: 0.7, delay: 0.15 + i * 0.12, ease: 'back.out(2)',
        onStart: () => { lab.visible = true; }
      });
    });
  }

  animateRoute(v, dur = 3.2) {
    v.mat.uniforms.uProgress.value = 0;
    return new Promise((res) => {
      gsap.to(v.mat.uniforms.uProgress, {
        value: 1, duration: dur, ease: 'power1.inOut', onComplete: res
      });
    });
  }

  surfaceRoutes(on) {
    Object.values(this.T.routeVis).forEach((v) => {
      v.mesh.visible = !on;
      v.thin.visible = on;
      v.parts.material.size = on ? 0.25 : 1.1;
    });
    if (this.T.astro) {
      this.T.astro.children.forEach((c) => (c.visible = !on));
    }
  }

  async enterSurface(rec) {
    if (this.mode !== 'terrain' || this.surface) return;
    let x = this.HAB.x + 2;
    let z = this.HAB.z - 2;
    let yaw = 0;
    if (this.eva && this.eva.pos) {
      x = this.eva.pos.x;
      z = this.eva.pos.z;
    }
    const look = rec && rec.line && rec.line.length > 0
      ? rec.line[Math.min(rec.line.length - 1, 15)]
      : { x: 0, z: 0 };
    yaw = Math.atan2(-(look.x - x), -(look.z - z));
    const eyeHeight = 1.75; // Standing human astronaut eye height
    const eye = new THREE.Vector3(x, this.store.hU(x, z) + eyeHeight, z);
    this.surf.pitch = -0.16; // Natural ~-9° downward tilt towards Martian surface and trail

    const fwd = new THREE.Vector3(
      -Math.sin(yaw) * Math.cos(this.surf.pitch),
      Math.sin(this.surf.pitch),
      -Math.cos(yaw) * Math.cos(this.surf.pitch)
    );
    const tgt = eye.clone().add(fwd.multiplyScalar(15));

    // Smooth cinematic camera descent from aerial orbit down to astronaut eye level
    const startPos = this.camera.position.clone();
    const startTgt = this.controls.target.clone();
    await tween(2.0, (t) => {
      this.camera.position.lerpVectors(startPos, eye, t);
      const curTgt = new THREE.Vector3().lerpVectors(startTgt, tgt, t);
      this.camera.lookAt(curTgt);
    }, 'power2.inOut');
    this.camera.position.copy(eye);
    this.camera.lookAt(tgt);

    this.surface = true;
    this.surfaceRoutes(true);
    this.controls.enabled = false;
    this.surf.pos.set(x, z);
    this.surf.yaw = yaw;
    this.camera.fov = 58;
    this.camera.updateProjectionMatrix();

    // Clearer atmospheric visibility on Martian surface
    if (this.terrainScene.fog) {
      this.terrainScene.fog.density = 0.0005;
    }

    // Initialize real-time counters
    this.surf.walkDistM = 0;
    this.surf.walkTimeSec = 0;
    const totalDist = this.activeRoute ? this.activeRoute.distM : 2400;
    const sDist = document.getElementById('sDist');
    if (sDist) {
      sDist.textContent = `0.00 / ${(totalDist / 1000).toFixed(1)} km`;
    }
    const sEva = document.getElementById('sEva');
    if (sEva) {
      sEva.textContent = `T+0m 00s`;
    }

    if (!this.hud) this.toggleHUD(true);
    if (this.eva) this.eva.follow = true;
    this.onLog('Surface mode · astronaut eye-level perspective');
  }

  exitSurface() {
    if (!this.surface) return;
    this.surface = false;
    this.surfaceRoutes(false);
    this.camera.fov = 42;
    this.camera.updateProjectionMatrix();

    if (this.terrainScene.fog) {
      this.terrainScene.fog.density = 0.0010;
    }

    const p = this.camera.position.clone();
    this.controls.target.copy(p).add(
      new THREE.Vector3(-Math.sin(this.surf.yaw), 0, -Math.cos(this.surf.yaw)).multiplyScalar(8)
    );
    this.camTo(
      p.clone().add(new THREE.Vector3(Math.sin(this.surf.yaw) * 30, 26, Math.cos(this.surf.yaw) * 30)),
      this.controls.target.clone(),
      1.6
    );
    if (this.eva) this.eva.follow = false;
    this.onLog('Exited surface mode');
  }

  toggleHUD(on = !this.hud) {
    this.hud = on;
    document.body.classList.toggle('hudon', on);
    if (on) {
      this.onLog('Astronaut HUD active');
    }
  }

  startEVA(rec, { dur = 48, follow = true, replay = false } = {}) {
    if (!rec || this.mode !== 'terrain') return null;
    this.stopEVA();
    if (!this.T.astro) this.buildAstronaut();
    this.eva = {
      r: rec,
      t: 0,
      dur,
      total: rec.track[rec.track.length - 1].t,
      follow: follow !== undefined ? follow : true,
      replay,
      done: false,
      hits: new Set(),
      obs: 0,
      recording: true
    };
    if (this.T.astro) this.T.astro.visible = true;
    if (this.T.astroLab) this.T.astroLab.visible = true;

    // Reset and initialize live recorded breadcrumb trail
    if (this.T.evaTrail) {
      this.terrainScene.remove(this.T.evaTrail);
      this.T.evaTrail.geometry.dispose();
      this.T.evaTrail.material.dispose();
      this.T.evaTrail = null;
    }
    const maxTrailPts = 1000;
    const trailPositions = new Float32Array(maxTrailPts * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    trailGeo.setDrawRange(0, 0);
    this.T.evaTrail = new THREE.Line(
      trailGeo,
      new THREE.LineBasicMaterial({
        color: 0x00ffcc,
        linewidth: 2.5,
        transparent: true,
        opacity: 0.9
      })
    );
    this.terrainScene.add(this.T.evaTrail);
    this._trailCount = 0;

    if (this.eva.follow && !this.surface) {
      this.controls.enabled = false;
      const p0 = this.trackAt(rec, 0);
      const pNext = this.trackAt(rec, 3);
      const y0 = this.store.hU(p0.x, p0.z);
      const back = new THREE.Vector3(p0.x - pNext.x, 0, p0.z - pNext.z);
      if (back.lengthSq() < 1e-4) back.set(-1, 0, 1);
      back.normalize();
      const eye = new THREE.Vector3(p0.x, y0 + 1.5, p0.z).addScaledVector(back, 22).add(new THREE.Vector3(0, 14, 0));
      gsap.to(this.camera.position, { x: eye.x, y: eye.y, z: eye.z, duration: 1.6, ease: 'power2.out' });
      gsap.to(this.controls.target, { x: p0.x, y: y0 + 1.5, z: p0.z, duration: 1.6, ease: 'power2.out' });
    }

    this.onLog(replay ? 'EVA replay started' : 'EVA Telemetry Recording started · EV-1 egress from HAB-1', 'ok');

    // Reset timeline progress and visual markers
    const tlFill = document.getElementById('tlFill');
    if (tlFill) tlFill.style.width = '0%';
    const tlNow = document.getElementById('tlNow');
    if (tlNow) {
      tlNow.style.left = '0%';
      tlNow.style.opacity = '1';
    }
    document.querySelectorAll('#tl .node').forEach((n) => n.classList.remove('done'));

    return new Promise((res) => {
      this.eva.resolve = res;
    });
  }

  stopEVA() {
    if (!this.eva) return;
    const e = this.eva;
    this.eva = null;
    if (this.T.astro) this.T.astro.visible = false;
    if (this.T.astroLab) this.T.astroLab.visible = false;
    const tlNow = document.getElementById('tlNow');
    if (tlNow) tlNow.style.opacity = '0';
    if (this.mode === 'terrain' && !this.surface) this.controls.enabled = true;
    e.resolve && e.resolve();
  }

  trackAt(r, t) {
    const tr = r.track;
    let lo = 0;
    let hi = tr.length - 1;
    if (t <= 0) return { i: 0, x: tr[0].x, z: tr[0].z, d: 0 };
    if (t >= tr[hi].t) return { i: hi, x: tr[hi].x, z: tr[hi].z, d: tr[hi].d };
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (tr[m].t < t) lo = m;
      else hi = m;
    }
    const a = tr[lo];
    const b = tr[hi];
    const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
    return {
      i: lo,
      x: lerp(a.x, b.x, f),
      z: lerp(a.z, b.z, f),
      d: lerp(a.d, b.d, f),
      dwell: b.dwell && a.x === b.x
    };
  }

  radarSweep(c) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 96),
      new THREE.MeshBasicMaterial({
        color: 0xffad3b,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(c.x, this.store.hU(c.x, c.z) + 3, c.z);
    this.terrainScene.add(m);

    gsap.to(m.scale, { x: 70, y: 70, duration: 2.2, ease: 'power2.out' });
    gsap.to(m.material, {
      opacity: 0,
      duration: 2.2,
      ease: 'power2.in',
      onComplete: () => {
        this.terrainScene.remove(m);
        m.geometry.dispose();
      }
    });
  }

  drawComm(cons) {
    if (this.T.comm) this.terrainScene.remove(this.T.comm);
    const c = cons.comm;
    const pts = [];
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.03) {
      const x = c.x + Math.cos(a) * c.r;
      const z = c.z + Math.sin(a) * c.r;
      pts.push(
        new THREE.Vector3(
          x,
          (Math.abs(x) < 50 && Math.abs(z) < 50 ? this.store.hU(x, z) : 0) + 0.8,
          z
        )
      );
    }
    this.T.comm = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({
        color: 0xb48cff,
        dashSize: 1,
        gapSize: 0.8,
        transparent: true,
        opacity: 0.9
      })
    );
    this.T.comm.computeLineDistances();
    this.terrainScene.add(this.T.comm);
  }

  loop() {
    this._rafId = requestAnimationFrame(() => this.loop());
    const dt = Math.min(0.1, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    this.terrainU.uTime.value = t;

    if (this.activeScene === this.globeScene && this.G.group) {
      this.G.sun.position
        .copy(this.camera.position)
        .normalize()
        .applyAxisAngle(THREE.Object3D.DEFAULT_UP, 1.05)
        .multiplyScalar(5)
        .add(this._c.set(0, 1.4, 0));
      if (this.spin) this.G.group.rotation.y += dt * 0.035;
      if (this.G.dust) this.G.dust.rotation.y += dt * 0.006;
      (this.G.orbits || []).forEach((o) => {
        o.a += dt * o.spd;
        o.sat.position.set(Math.cos(o.a) * o.r, 0, Math.sin(o.a) * o.r);
        if (o.satModel) {
          o.satModel.rotation.y += dt * 0.35;
          o.satModel.rotation.x = Math.sin(t * 0.4 + o.r) * 0.12;
        }
      });
      (this.G.sites || []).forEach((S, i) => {
        const k = (t * 0.6 + i * 0.3) % 1;
        S.pulse.scale.setScalar(1 + k * 2.5);
        S.pulse.material.opacity = (1 - k) * (S.s.primary ? 0.9 : 0.4);
      });
    }

    if (this.activeScene === this.terrainScene && this.T.mesh) {
      this.T.markers.forEach((M, i) => {
        const u = M.g.userData;
        u.top.rotation.y += dt * 0.8;
        u.r2.rotation.x = Math.PI / 2 + Math.sin(t + i) * 0.3;
        u.r2.rotation.z += dt * 0.6;
        u.core.position.y = Math.sin(t * 1.6 + i) * 0.25;
        u.r1.scale.setScalar(1 + 0.08 * Math.sin(t * 3 + i));
      });
      this.T.wps.forEach((W, i) => {
        const u = W.g.userData;
        u.top.rotation.y += dt;
        u.r2.rotation.z -= dt * 0.9;
        u.r2.rotation.x = Math.PI / 2 + 0.3;
        u.core.position.y = Math.sin(t * 2 + i) * 0.15;
      });
      this.T.zones.forEach((Z, i) => {
        if (!Z.g.visible) return;
        const k = (t * 0.45 + i * 0.17) % 1;
        Z.g.userData.pr.scale.setScalar(0.4 + k * 0.6);
        Z.g.userData.pr.material.opacity = (1 - k) * 0.9;
        Z.g.userData.cyl.material.uniforms.uO.value = 0.22 + 0.12 * Math.sin(t * 2.5 + i);
      });
      if (this.T.beacon) this.T.beacon.material.opacity = 0.6 + 0.4 * Math.sin(t * 4);

      Object.values(this.T.routeVis).forEach((v) => {
        if (!v.parts.visible) return;
        const pa = v.parts.geometry.attributes.position;
        const pr = v.mat.uniforms.uProgress.value;
        for (let i = 0; i < v.PC; i++) {
          const u = ((t * 0.025 + i / v.PC) % 1) * pr;
          const p = v.curve.getPointAt(u, this._a);
          pa.setXYZ(i, p.x, p.y + 0.08, p.z);
        }
        pa.needsUpdate = true;
      });

      if (this.T.dust && this.T.dust.material.opacity > 0) {
        const pa = this.T.dust.geometry.attributes.position;
        const w = (this.weatherActive ? 7 : 2) * dt;
        for (let i = 0; i < pa.count; i++) {
          let x = pa.getX(i) - w;
          let z = pa.getZ(i) + w * 0.4;
          if (x < -60) x += 120;
          if (z > 60) z -= 120;
          pa.setX(i, x);
          pa.setZ(i, z);
          pa.setY(i, this.T.dustBase[i * 3 + 1] + Math.sin(t + i) * 0.3);
        }
        pa.needsUpdate = true;
      }

      if (this.T.astroRing) {
        this.T.astroRing.scale.setScalar(1 + 0.25 * Math.sin(t * 5));
      }

      this.tickEVA(dt);
      this.tickSurface(dt);
      this.tickHUD(dt);
    }

    if (this.controls.enabled) this.controls.update();
    this.updateLabels();

    if (this.fx) {
      this.composer.render();
    } else {
      this.renderer.render(this.activeScene, this.camera);
    }
  }

  tickEVA(dt) {
    const e = this.eva;
    if (!e) return;
    e.t = Math.min(1, e.t + dt / e.dur);
    const tm = e.t * e.total;
    const p = this.trackAt(e.r, tm);
    const y = this.store.hU(p.x, p.z);
    this.T.astro.position.set(p.x, y, p.z);

    const ahead = this.trackAt(e.r, Math.min(e.total, tm + 6));
    const hd = bearing(ahead.x - p.x, ahead.z - p.z);
    if (Math.hypot(ahead.x - p.x, ahead.z - p.z) > 0.01) {
      this.T.astro.rotation.y = Math.atan2(ahead.x - p.x, ahead.z - p.z);
    }

    e.pos = p;
    e.min = tm;
    e.heading = hd;

    // Live recorded breadcrumb trail
    if (this.T.evaTrail && this._trailCount < 1000) {
      const pa = this.T.evaTrail.geometry.attributes.position;
      pa.setXYZ(this._trailCount, p.x, y + 0.15, p.z);
      pa.needsUpdate = true;
      this._trailCount++;
      this.T.evaTrail.geometry.setDrawRange(0, this._trailCount);
    }

    // Direct DOM timeline updates (60 FPS smooth)
    const tlFill = document.getElementById('tlFill');
    if (tlFill) tlFill.style.width = (e.t * 100) + '%';
    const tlNow = document.getElementById('tlNow');
    if (tlNow) {
      tlNow.style.left = (e.t * 100) + '%';
      tlNow.style.opacity = '1';
    }
    const nodes = document.querySelectorAll('#tl .node');
    nodes.forEach((n) => {
      if (+n.dataset.t <= tm + 0.01) n.classList.add('done');
    });

    for (const w of e.r.waypoints) {
      const key = w.name + w.d;
      if (!e.hits.has(key) && p.d >= w.d - 1) {
        e.hits.add(key);
        if (w.type === 'target') {
          e.obs += w.target.instr.length + 1;
          this.onLog(`EV-1 at ${w.name} · sampling (${25} min)`, 'ok');
          const M = this.T.markers.find((m) => m.t.id === w.target.id);
          M && this.scanBurst(M);
        } else if (w.type === 'hazard') {
          this.onLog(`Passing ${w.zone.name} · clearance ${Math.round(w.clear)} m`, 'warn');
        } else if (w.type !== 'hab') {
          this.onLog(`EV-1 reached ${w.name}`);
        }
      }
    }

    // Direct DOM stats updates (60 FPS fluid)
    const sDist = document.getElementById('sDist');
    if (sDist) {
      sDist.textContent = `${(p.d / 1000).toFixed(2)} / ${(e.r.distM / 1000).toFixed(1)} km`;
    }
    const sEva = document.getElementById('sEva');
    if (sEva) {
      const rem = Math.max(0, e.r.evaMin - tm);
      sEva.textContent = `T+${Math.round(tm)}m · REM ${fmtHM(rem)}`;
    }
    const visitedTargets = e.r.waypoints.filter(
      (w) => w.type === 'target' && (e.hits.has(w.name + w.d) || p.d >= w.d - 1)
    );
    const totalTargets = e.r.order?.length || (this.store?.targets?.length || 3);
    const sTg = document.getElementById('sTg');
    if (sTg) {
      sTg.textContent = `${visitedTargets.length} / ${totalTargets}`;
    }
    const sHz = document.getElementById('sHz');
    if (sHz) {
      sHz.textContent = String(Math.round(e.r.avoided || 0));
    }

    // Live hazard proximity check
    let nearestDist = 999;
    const allHazards = (this.store.hazards || []).concat(this.cons?.extraZones || []);
    for (const hz of allHazards) {
      const dist = Math.hypot(p.x - hz.x, p.z - hz.z) - hz.r;
      if (dist < nearestDist) nearestDist = dist;
    }
    let liveRisk = e.r.risk?.t || 'NOMINAL';
    let liveRiskCol = e.r.risk?.col || '#5fe1ff';
    let safetyPct = e.r.safety || 85;

    if (nearestDist < 0) {
      liveRisk = 'CRITICAL';
      liveRiskCol = '#ff4a4a';
      safetyPct = 25;
    } else if (nearestDist < 1.5) {
      liveRisk = 'CAUTION';
      liveRiskCol = '#ffad3b';
      safetyPct = 55;
    }

    const sRisk = document.getElementById('sRisk');
    if (sRisk) {
      sRisk.textContent = liveRisk;
      sRisk.style.color = liveRiskCol;
    }
    const sRiskB = document.getElementById('sRiskB');
    if (sRiskB) {
      sRiskB.style.width = `${Math.min(100, Math.max(0, safetyPct))}%`;
      sRiskB.style.backgroundColor = liveRiskCol;
      sRiskB.style.boxShadow = `0 0 6px ${liveRiskCol}`;
    }

    // Cumulative science score
    const sciPerTg = e.r.science / Math.max(1, totalTargets);
    const curScience = e.t >= 0.999
      ? Math.round(e.r.science)
      : Math.min(Math.round(e.r.science), Math.round(visitedTargets.length * sciPerTg + (p.d / Math.max(1, e.r.distM)) * (e.r.science * 0.15)));

    const sSci = document.getElementById('sSci');
    if (sSci) {
      sSci.textContent = `${curScience} / 100`;
    }
    const sSciB = document.getElementById('sSciB');
    if (sSciB) {
      sSciB.style.width = `${Math.min(100, Math.max(0, curScience))}%`;
    }

    // Throttled notification to React state (~8 Hz = every 125ms) so React stays in sync
    this._evaAcc = (this._evaAcc || 0) + dt;
    if (this._evaAcc >= 0.125 || e.t >= 1) {
      this._evaAcc = 0;
      if (this.onEvaTick) {
        this.onEvaTick({
          t: e.t,
          tm,
          p,
          distTraversed: p.d,
          totalDist: e.r.distM,
          evaMin: e.r.evaMin,
          visitedCount: visitedTargets.length,
          totalTargets,
          avoided: e.r.avoided,
          risk: liveRisk,
          riskObj: { t: liveRisk, col: liveRiskCol },
          safetyPct,
          science: curScience,
          r: e.r
        });
      }
    }

    if (e.follow && !this.surface) {
      this._a.set(p.x, y + 1.5, p.z);
      const back = new THREE.Vector3(p.x - ahead.x, 0, p.z - ahead.z);
      if (back.lengthSq() < 1e-4) back.set(-1, 0, 1);
      back.normalize();
      this._b.copy(this._a).addScaledVector(back, 24).add(new THREE.Vector3(0, 15, 0));
      this.camera.position.lerp(this._b, 0.04);
      this.controls.target.lerp(this._a, 0.08);
      this.camera.lookAt(this.controls.target);
    }

    if (this.surface) {
      this.surf.pos.set(p.x, p.z);
      this.surf.yaw = this.lerpAngle(
        this.surf.yaw,
        Math.atan2(-(ahead.x - p.x), -(ahead.z - p.z)),
        0.05
      );
    }

    if (e.t >= 1 && !e.done) {
      e.done = true;
      if (this.onFinishEVA) this.onFinishEVA(e);
    }
  }

  lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  tickSurface(dt) {
    if (!this.surface) return;
    let isMoving = false;
    if (!this.eva) {
      const k = this.surf.keys;
      const sp = (k.shift ? 7 : 2.2) * dt;
      const f = new THREE.Vector2(-Math.sin(this.surf.yaw), -Math.cos(this.surf.yaw));
      const rt = new THREE.Vector2(-f.y, f.x);
      isMoving = k.w || k.arrowup || k.s || k.arrowdown || k.a || k.d;
      if (k.w || k.arrowup) this.surf.pos.addScaledVector(f, sp);
      if (k.s || k.arrowdown) this.surf.pos.addScaledVector(f, -sp);
      if (k.a) this.surf.pos.addScaledVector(rt, sp);
      if (k.d) this.surf.pos.addScaledVector(rt, -sp);
      if (k.arrowleft) this.surf.yaw += dt * 1.2;
      if (k.arrowright) this.surf.yaw -= dt * 1.2;
      this.surf.pos.x = clamp(this.surf.pos.x, -49, 49);
      this.surf.pos.y = clamp(this.surf.pos.y, -49, 49);

      if (isMoving) {
        this.surf.walkDistM = (this.surf.walkDistM || 0) + sp * MPU;
      }
      this.surf.walkTimeSec = (this.surf.walkTimeSec || 0) + dt;

      const totalDist = this.activeRoute ? this.activeRoute.distM : 2400;
      const sDist = document.getElementById('sDist');
      if (sDist) {
        sDist.textContent = `${(this.surf.walkDistM / 1000).toFixed(2)} / ${(totalDist / 1000).toFixed(1)} km`;
      }
      const sEva = document.getElementById('sEva');
      if (sEva) {
        const m = Math.floor(this.surf.walkTimeSec / 60);
        const s = Math.floor(this.surf.walkTimeSec % 60);
        sEva.textContent = `T+${m}m ${pad2(s)}s`;
      }
    }
    const bob = isMoving ? Math.sin(performance.now() * 0.009) * 0.035 : 0;
    const y =
      this.store.hU(this.surf.pos.x, this.surf.pos.y) +
      1.75 +
      bob +
      (this.eva ? Math.sin(performance.now() * 0.008) * 0.02 : 0);
    this.camera.position.set(this.surf.pos.x, y, this.surf.pos.y);
    const d = new THREE.Vector3(
      -Math.sin(this.surf.yaw) * Math.cos(this.surf.pitch),
      Math.sin(this.surf.pitch),
      -Math.cos(this.surf.yaw) * Math.cos(this.surf.pitch)
    );
    this.camera.lookAt(this._b.copy(this.camera.position).add(d));
  }

  tickHUD(dt = 0.016) {
    if (!this.hud) return;
    this._hudAcc = (this._hudAcc || 0) + (dt || 0.016);

    let hd = 0;
    let px = this.HAB ? this.HAB.x : 0;
    let pz = this.HAB ? this.HAB.z : 0;

    if (this.surface) {
      const f = new THREE.Vector3();
      this.camera.getWorldDirection(f);
      hd = bearing(f.x, f.z);
      px = this.camera.position.x;
      pz = this.camera.position.z;
    } else if (this.eva && this.eva.pos) {
      hd = this.eva.heading || 0;
      px = this.eva.pos.x;
      pz = this.eva.pos.z;
    } else if (this.activeRoute && this.activeRoute.line && this.activeRoute.line.length > 0) {
      const idx = Math.min(20, this.activeRoute.line.length - 1);
      const pt = this.activeRoute.line[idx];
      const hx = this.HAB ? this.HAB.x : 0;
      const hz = this.HAB ? this.HAB.z : 0;
      if (pt) {
        hd = bearing(pt.x - hx, pt.z - hz);
      }
    }

    // Direct DOM fast updates for compass tape and heading (60 FPS smooth with 0 React overhead)
    const tape = document.getElementById('tape');
    if (tape && tape.parentElement) {
      const w = tape.parentElement.clientWidth || 620;
      tape.style.transform = `translateX(${w / 2 - (hd + 360) * 4}px)`;
    }
    const hHdg = document.getElementById('hHdg');
    if (hHdg) {
      hHdg.textContent = `${compass(hd)} ${String(Math.round(hd) % 360).padStart(3, '0')}°`;
    }

    // Throttle React state update to ~10 Hz so it doesn't cause frame drops
    if (this._hudAcc < 0.1) return;
    this._hudAcc = 0;

    this.onHudUpdate({
      heading: hd,
      compassHeading: `${compass(hd)} ${String(Math.round(hd) % 360).padStart(3, '0')}°`,
      px,
      pz
    });
  }

  destroy() {
    cancelAnimationFrame(this._rafId);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
    this.renderer.dispose();
  }
}
