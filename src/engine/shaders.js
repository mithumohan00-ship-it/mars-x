import * as THREE from 'three';

export const COLORSPACE = `\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n`;

export const OVERLAY_VS = `
attribute float aElev;
attribute float aSlope;
attribute float aHaz;
attribute float aMin;
attribute float aGeo;
attribute float aEdge;
attribute float aTemp;
attribute float aRad;

varying float vElev, vSlope, vHaz, vMin, vGeo, vEdge, vTemp, vRad;
varying vec3 vPos;

void main() {
  vElev = aElev;
  vSlope = aSlope;
  vHaz = aHaz;
  vMin = aMin;
  vGeo = aGeo;
  vEdge = aEdge;
  vTemp = aTemp;
  vRad = aRad;
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position + vec3(0., .035, 0.), 1.);
}
`;

export const OVERLAY_FS = `
uniform float uTime, uElev, uScan, uGeo, uMin, uTemp, uRad, uHaz, uElevRange, uRadBoost;
varying float vElev, vSlope, vHaz, vMin, vGeo, vEdge, vTemp, vRad;
varying vec3 vPos;

vec3 turbo(float t) {
  t = clamp(t, 0., 1.);
  return clamp(vec3(
    .13572 + t * (4.6153 + t * (-42.66 + t * (132.13 + t * (-152.95 + t * 59.29)))),
    .0914 + t * (2.1942 + t * (4.8430 + t * (-14.185 + t * (4.2773 + t * 2.8296)))),
    .1067 + t * (12.64 + t * (-60.58 + t * (110.36 + t * (-89.90 + t * 27.35))))
  ), 0., 1.);
}

vec3 thermal(float t) {
  t = clamp(t, 0., 1.);
  return mix(
    mix(vec3(.08, .02, .35), vec3(.1, .45, 1.), smoothstep(0., .35, t)),
    mix(vec3(1., .45, .1), vec3(1., .95, .5), smoothstep(.75, 1., t)),
    smoothstep(.35, .75, t)
  );
}

float hsh(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void add(inout vec4 acc, vec3 c, float a) {
  a = clamp(a, 0., 1.);
  acc.rgb = acc.rgb * (1. - a) + c * a;
  acc.a = acc.a + a * (1. - acc.a);
}

void main() {
  vec4 acc = vec4(0.);
  float sx = (vPos.x + 50.) / 100.;

  if (uElev > .001) {
    float vis = 1. - smoothstep(uScan - .015, uScan, sx);
    float em = vElev * uElevRange;

    // 25m minor contour lines with Nyquist frequency anti-aliasing
    float f = em / 25.;
    float fw1 = fwidth(f);
    float fade1 = 1.0 - smoothstep(0.12, 0.40, fw1);
    float d = abs(fract(f + .5) - .5);
    float ln = (1. - smoothstep(0., max(0.001, fw1 * 1.3), d)) * fade1;

    // 100m index contour lines with Nyquist frequency anti-aliasing
    float f2 = em / 100.;
    float fw2 = fwidth(f2);
    float fade2 = 1.0 - smoothstep(0.12, 0.40, fw2);
    float d2 = abs(fract(f2 + .5) - .5);
    float ln2 = (1. - smoothstep(0., max(0.001, fw2 * 2.0), d2)) * fade2;

    // Calibrated telemetry isoline color (cyan/amber, prevents solid white blowout)
    vec3 c = mix(turbo(vElev * .85 + .08), vec3(.25, .82, 1.), max(ln * .5, ln2));
    add(acc, c, (ln * .25 + ln2 * .40) * vis * uElev);
    float edge = exp(-pow((sx - uScan) * 90., 2.));
    add(acc, vec3(.2, .75, 1.) * 0.9, edge * uElev * step(uScan, 1.0));
  }

  if (uGeo > .001) {
    float u = floor(vGeo + .5);
    vec3 gc = u < .5 ? vec3(.79, .54, .35) :
              u < 1.5 ? vec3(.91, .73, .54) :
              u < 2.5 ? vec3(1., .36, .48) :
              u < 3.5 ? vec3(.36, 1., .75) :
              u < 4.5 ? vec3(1., .88, .4) : vec3(.54, .49, 1.);
    float dash = step(.5, fract((vPos.x + vPos.z) * .9 - uTime * .6));
    add(acc, gc, .16 * uGeo);
    add(acc, gc * 1.5, smoothstep(.45, .75, vEdge) * (.55 + .45 * dash) * uGeo);
  }

  if (uMin > .001) {
    float hs = smoothstep(.38, 1., vMin);
    float pulse = .7 + .3 * sin(uTime * 2.2 + vMin * 9.);
    float ring = smoothstep(.08, 0., abs(fract(vMin * 5. - uTime * .35) - .5) - .38) * step(.4, vMin);
    float u = floor(vGeo + .5);
    vec3 mc = (u > 2.5 && u < 3.5) ? vec3(.3, 1., .75) :
              (u > 1.5 && u < 2.5) ? vec3(1., .3, .6) :
              (u > 3.5 && u < 4.5) ? vec3(1., .9, .3) : vec3(.65, .5, 1.);
    add(acc, mc * 1.3, (hs * .6 * pulse + ring * .5 * hs) * uMin);
  }

  if (uTemp > .001) {
    float t = vTemp + .07 * sin(vPos.x * .13 + uTime * .55) * cos(vPos.z * .11 - uTime * .38) +
              .03 * sin((vPos.x - vPos.z) * .4 + uTime);
    float iso = 1. - smoothstep(0., fwidth(t * 12.) * 1.5, abs(fract(t * 12. + .5) - .5));
    add(acc, thermal(t), .42 * uTemp);
    add(acc, vec3(1.), iso * .18 * uTemp);
  }

  if (uRad > .001) {
    float r = clamp(vRad + uRadBoost, 0., 1.);
    float n = .5 + .5 * sin(vPos.x * .22 + uTime * .7) * sin(vPos.z * .19 - uTime * .5);
    vec2 cell = floor(vPos.xz * 2.5);
    float sp = step(.985, hsh(cell + floor(uTime * 1.5))) * smoothstep(.3, 1., r);
    vec3 rc = mix(vec3(.9, .1, .15), vec3(1., .85, .2), r);
    add(acc, rc, (.18 + .28 * r * n) * (.85 + .15 * sin(uTime * 1.4)) * uRad);
    add(acc, vec3(1., .95, .6) * 1.5, sp * .9 * uRad);
  }

  if (uHaz > .001) {
    float h = vHaz;
    float ring = smoothstep(.06, 0., abs(fract(h * 3. - uTime * .7) - .5) - .4) * step(.05, h);
    vec3 hc = mix(vec3(1., .72, .2), vec3(1., .12, .1), smoothstep(.3, .9, h));
    float hatch = step(.5, fract((vPos.x + vPos.z) * 1.6)) * smoothstep(.6, .75, vSlope);
    add(acc, hc, (h * .45 + ring * .55 * h) * uHaz * (.85 + .15 * sin(uTime * 3.)));
    add(acc, vec3(1., .2, .15), hatch * .5 * uHaz);
  }

  if (acc.a < .003) discard;
  gl_FragColor = vec4(acc.rgb, acc.a);
  ${COLORSPACE}
}
`;

export const ROUTE_FS = `
uniform float uProgress, uTime, uOpacity, uLen, uBad;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
  if (vUv.x > uProgress) discard;
  float head = smoothstep(uProgress - .012, uProgress, vUv.x) * step(uProgress, .999);
  float dash = .55 + .45 * step(.5, fract(vUv.x * uLen * .6 - uTime * 1.4));
  float glitch = uBad * step(.5, fract(vUv.x * uLen * 2. + uTime * 3.));
  vec3 c = mix(uColor, vec3(1., .15, .1), uBad) * (.75 * dash) + vec3(.8, 1., 1.) * head * 1.1;
  gl_FragColor = vec4(c, uOpacity * (.7 + .3 * dash) * (1. - glitch * .6));
  ${COLORSPACE}
}
`;

export function beamMat(c) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uC: { value: new THREE.Color(c) },
      uO: { value: 1 }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }
    `,
    fragmentShader: `
      uniform vec3 uC;
      uniform float uO;
      varying vec2 vUv;
      void main() {
        gl_FragColor = vec4(uC * 1.4, pow(1. - vUv.y, 1.6) * uO * .85);
        ${COLORSPACE}
      }
    `
  });
}

export function createGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
