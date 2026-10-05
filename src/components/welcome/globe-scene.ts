import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  NormalBlending,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { landPoints } from "@/lib/globe/land-mask";
import { routeAirports, type GlobeRoute, type LatLon } from "@/lib/globe/routes";

/**
 * The landing page's night globe, in plain three.js — loaded only on the
 * landing page, as its own chunk (see `NightGlobe.tsx`). Everything visual
 * comes from the app's own theme tokens, so light, dark and red-light each
 * get their own globe without a second code path.
 *
 * Built to be a good citizen: renders only while on screen and the tab is
 * visible, caps the pixel ratio at 2, draws a single still frame under
 * reduced motion, and releases every GPU resource on `dispose()`.
 */

export interface GlobeHandle {
  dispose: () => void;
  /** Re-read the theme tokens (call when light/dark/red-light changes). */
  refreshTheme: () => void;
}

export interface GlobeOptions {
  container: HTMLElement;
  routes: GlobeRoute[];
  reducedMotion: boolean;
  /** Called as the highlighted route changes, so the page can show its readout. */
  onActiveRoute?: (index: number) => void;
}

const RADIUS = 1;

function toVec3(p: LatLon, r = RADIUS): Vector3 {
  const phi = ((90 - p.lat) * Math.PI) / 180;
  const theta = ((p.lon + 180) * Math.PI) / 180;
  return new Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

/** Resolves a CSS variable to a concrete color through the browser itself, so any syntax the stylesheet uses ("rgb(232 165 75 / 0.4)", hex) comes back normalized. */
function cssColor(name: string): { color: Color; alpha: number } {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  const m = value.match(/rgba?\(([\d.]+),?\s*([\d.]+),?\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\)/);
  if (!m) return { color: new Color(0xe8a54b), alpha: 1 };
  return { color: new Color(Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255), alpha: m[4] ? Number(m[4]) : 1 };
}

function luminance(c: Color) {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** Arc between two airports along the great circle, lifted off the surface in proportion to its length so long-haul arcs read as long-haul. */
function arcCurve(a: LatLon, b: LatLon): CatmullRomCurve3 {
  const va = toVec3(a).normalize();
  const vb = toVec3(b).normalize();
  const angle = va.angleTo(vb);
  const lift = 0.06 + 0.32 * (angle / Math.PI);
  const pts: Vector3[] = [];
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Spherical interpolation, then raised by a sine bump so the arc leaves and lands on the surface.
    const sinA = Math.sin(angle);
    const v =
      sinA < 1e-6
        ? va.clone()
        : va
            .clone()
            .multiplyScalar(Math.sin((1 - t) * angle) / sinA)
            .add(vb.clone().multiplyScalar(Math.sin(t * angle) / sinA));
    pts.push(v.normalize().multiplyScalar(RADIUS + Math.sin(Math.PI * t) * lift + 0.004));
  }
  return new CatmullRomCurve3(pts);
}

const sphereVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const sphereFragment = /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uRim;
  uniform float uRimStrength;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    // Soft light from the upper left, and a rim of instrument light at the limb.
    float light = clamp(dot(vNormal, normalize(vec3(-0.5, 0.6, 0.6))) * 0.5 + 0.5, 0.0, 1.0);
    float rim = pow(1.0 - max(dot(vNormal, vView), 0.0), 3.0);
    vec3 col = uBase * (0.75 + 0.35 * light) + uRim * rim * uRimStrength;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// The halo is the back of a slightly larger sphere: its facing term runs
// from 0 at its own outer edge to HALO_EDGE where it meets the globe's limb,
// so light is brightest against the globe and fades to nothing outward.
const HALO_SCALE = 1.12;
const HALO_EDGE = Math.sqrt(1 - 1 / (HALO_SCALE * HALO_SCALE)).toFixed(4);

const haloFragment = /* glsl */ `
  uniform vec3 uRim;
  uniform float uStrength;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float facing = clamp(-dot(vNormal, vView), 0.0, 1.0);
    float i = pow(clamp(facing / ${HALO_EDGE}, 0.0, 1.0), 2.4);
    gl_FragColor = vec4(uRim, i * uStrength);
  }
`;

const dotVertex = /* glsl */ `
  attribute float aSize;
  uniform float uPixelRatio;
  uniform float uTime;
  attribute float aPulse;
  varying float vPulse;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vPulse = aPulse > 0.5 ? 0.65 + 0.35 * sin(uTime * 2.2 + position.x * 9.0) : 1.0;
    gl_PointSize = aSize * uPixelRatio * (3.2 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const dotFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vPulse;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float edge = smoothstep(0.5, 0.32, d);
    gl_FragColor = vec4(uColor, uAlpha * edge * vPulse);
  }
`;

const arcVertex = /* glsl */ `
  varying float vT;
  void main() {
    vT = uv.x;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const arcFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uDrawn;
  uniform float uTime;
  uniform float uOffset;
  uniform float uHighlight;
  uniform float uBaseAlpha;
  varying float vT;
  void main() {
    if (vT > uDrawn) discard;
    // A pulse of light travelling the route, plus a brighter head while it draws in.
    float head = fract(uTime * 0.18 + uOffset);
    float pulse = exp(-pow((vT - head) * 14.0, 2.0));
    float drawHead = exp(-pow((vT - uDrawn) * 22.0, 2.0)) * step(uDrawn, 0.999);
    float a = uBaseAlpha * (0.55 + 0.6 * uHighlight) + pulse * 0.9 + drawHead;
    gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
  }
`;

export function createGlobe({ container, routes, reducedMotion, onActiveRoute }: GlobeOptions): GlobeHandle {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "pan-y";
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.1, 50);
  // Far enough back that the halo and the long-haul arcs, which rise well
  // above the surface, stay inside the canvas instead of clipping at its edge.
  camera.position.set(0, 0, 4.75);

  const globe = new Group();
  scene.add(globe);

  // ---- Sphere and halo ----
  const sphereMat = new ShaderMaterial({
    vertexShader: sphereVertex,
    fragmentShader: sphereFragment,
    uniforms: { uBase: { value: new Color() }, uRim: { value: new Color() }, uRimStrength: { value: 0.8 } },
  });
  const sphere = new Mesh(new SphereGeometry(RADIUS, 72, 72), sphereMat);
  globe.add(sphere);

  const haloMat = new ShaderMaterial({
    vertexShader: sphereVertex,
    fragmentShader: haloFragment,
    uniforms: { uRim: { value: new Color() }, uStrength: { value: 0.5 } },
    side: BackSide,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const halo = new Mesh(new SphereGeometry(RADIUS * HALO_SCALE, 64, 64), haloMat);
  scene.add(halo);

  // ---- Graticule: every 20° of latitude and longitude ----
  const grid: number[] = [];
  const seg = 96;
  for (let lat = -60; lat <= 60; lat += 20) {
    for (let i = 0; i < seg; i++) {
      const a = toVec3({ lat, lon: (i / seg) * 360 - 180 }, RADIUS * 1.001);
      const b = toVec3({ lat, lon: ((i + 1) / seg) * 360 - 180 }, RADIUS * 1.001);
      grid.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  for (let lon = -180; lon < 180; lon += 20) {
    for (let i = 0; i < seg / 2; i++) {
      const a = toVec3({ lat: (i / (seg / 2)) * 180 - 90, lon }, RADIUS * 1.001);
      const b = toVec3({ lat: ((i + 1) / (seg / 2)) * 180 - 90, lon }, RADIUS * 1.001);
      grid.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  const gridGeo = new BufferGeometry();
  gridGeo.setAttribute("position", new Float32BufferAttribute(grid, 3));
  const gridMat = new LineBasicMaterial({ transparent: true, depthWrite: false });
  globe.add(new LineSegments(gridGeo, gridMat));

  // ---- Land dots and airport lights ----
  const land = landPoints();
  const airports = routeAirports(routes);
  const dotPos: number[] = [];
  const dotSize: number[] = [];
  const dotPulse: number[] = [];
  for (const p of land) {
    const v = toVec3(p, RADIUS * 1.003);
    dotPos.push(v.x, v.y, v.z);
    dotSize.push(2.1);
    dotPulse.push(0);
  }
  const dotsGeo = new BufferGeometry();
  dotsGeo.setAttribute("position", new Float32BufferAttribute(dotPos, 3));
  dotsGeo.setAttribute("aSize", new Float32BufferAttribute(dotSize, 1));
  dotsGeo.setAttribute("aPulse", new Float32BufferAttribute(dotPulse, 1));
  const dotUniforms = { uColor: { value: new Color() }, uAlpha: { value: 0.5 }, uPixelRatio: { value: pixelRatio }, uTime: { value: 0 } };
  const dotsMat = new ShaderMaterial({ vertexShader: dotVertex, fragmentShader: dotFragment, uniforms: dotUniforms, transparent: true, depthWrite: false });
  globe.add(new Points(dotsGeo, dotsMat));

  const cityPos: number[] = [];
  for (const a of airports) {
    const v = toVec3(a.at, RADIUS * 1.006);
    cityPos.push(v.x, v.y, v.z);
  }
  const cityGeo = new BufferGeometry();
  cityGeo.setAttribute("position", new Float32BufferAttribute(cityPos, 3));
  cityGeo.setAttribute("aSize", new Float32BufferAttribute(airports.map(() => 9), 1));
  cityGeo.setAttribute("aPulse", new Float32BufferAttribute(airports.map(() => 1), 1));
  const cityUniforms = { uColor: { value: new Color() }, uAlpha: { value: 1 }, uPixelRatio: { value: pixelRatio }, uTime: { value: 0 } };
  const cityMat = new ShaderMaterial({ vertexShader: dotVertex, fragmentShader: dotFragment, uniforms: cityUniforms, transparent: true, depthWrite: false });
  globe.add(new Points(cityGeo, cityMat));

  // ---- Route arcs ----
  const arcs = routes.map((r, i) => {
    const mat = new ShaderMaterial({
      vertexShader: arcVertex,
      fragmentShader: arcFragment,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new Color() },
        uDrawn: { value: reducedMotion ? 1 : 0 },
        uTime: { value: 0 },
        uOffset: { value: (i * 0.37) % 1 },
        uHighlight: { value: 0 },
        uBaseAlpha: { value: 0.5 },
      },
    });
    const mesh = new Mesh(new TubeGeometry(arcCurve(r.a, r.b), 64, 0.0042, 6, false), mat);
    globe.add(mesh);
    return { mesh, mat, delay: 0.35 + i * 0.12 };
  });

  // ---- Theme ----
  function refreshTheme() {
    const panel = cssColor("--color-panel").color;
    const light = luminance(panel) > 0.5;
    const accent = cssColor("--color-accent").color;
    const ink = cssColor("--color-ink").color;
    // A night globe on a dark page; a paper chart globe in daylight.
    sphereMat.uniforms.uBase.value.copy(light ? panel.clone().lerp(new Color(1, 1, 1), 0.25) : panel.clone().multiplyScalar(0.85));
    sphereMat.uniforms.uRim.value.copy(accent);
    sphereMat.uniforms.uRimStrength.value = light ? 0.25 : 0.9;
    haloMat.uniforms.uRim.value.copy(accent);
    haloMat.uniforms.uStrength.value = light ? 0.22 : 0.55;
    haloMat.blending = light ? NormalBlending : AdditiveBlending;
    haloMat.needsUpdate = true;
    gridMat.color.copy(ink);
    gridMat.opacity = light ? 0.09 : 0.07;
    dotUniforms.uColor.value.copy(ink);
    dotUniforms.uAlpha.value = light ? 0.42 : 0.5;
    cityUniforms.uColor.value.copy(accent);
    for (const a of arcs) {
      a.mat.uniforms.uColor.value.copy(accent);
      a.mat.uniforms.uBaseAlpha.value = light ? 0.55 : 0.45;
      a.mat.blending = light ? NormalBlending : AdditiveBlending;
      a.mat.needsUpdate = true;
    }
    requestFrame();
  }

  // ---- Orientation: open over Memphis, tilted to show the northern routes ----
  const home = toVec3({ lat: 35.04, lon: -89.98 }).normalize();
  const baseYaw = -Math.atan2(home.x, home.z) - 0.55;
  let yaw = baseYaw;
  let pitch = 0.42;
  let velocity = 0;
  const AUTO_SPIN = 0.045; // radians per second

  // ---- Interaction: drag to spin (with inertia), pointer parallax on desktop ----
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let parallaxX = 0;
  let parallaxY = 0;
  let targetParallaxX = 0;
  let targetParallaxY = 0;
  const finePointer = window.matchMedia("(pointer: fine)").matches;

  function onDown(e: PointerEvent) {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    velocity = 0;
    renderer.domElement.setPointerCapture(e.pointerId);
  }
  function onMove(e: PointerEvent) {
    if (dragging) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      yaw += dx * 0.006;
      velocity = dx * 0.006 * 60;
      pitch = Math.max(-0.2, Math.min(0.9, pitch + dy * 0.003));
      requestFrame();
    } else if (finePointer && !reducedMotion) {
      const rect = container.getBoundingClientRect();
      targetParallaxX = ((e.clientX - rect.left) / rect.width - 0.5) * 0.16;
      targetParallaxY = ((e.clientY - rect.top) / rect.height - 0.5) * 0.12;
    }
  }
  function onUp(e: PointerEvent) {
    dragging = false;
    if (renderer.domElement.hasPointerCapture(e.pointerId)) renderer.domElement.releasePointerCapture(e.pointerId);
    requestFrame();
  }
  renderer.domElement.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);

  // ---- Size ----
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestFrame();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  // ---- Loop: runs only while visible ----
  let raf = 0;
  let running = false;
  let onScreen = true;
  let last = performance.now();
  let elapsed = 0;
  let activeRoute = -1;

  function frame(now: number) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const animate = !reducedMotion;
    if (animate) elapsed += dt;

    if (!dragging && animate) {
      yaw += (AUTO_SPIN + velocity) * dt;
      velocity *= Math.pow(0.04, dt); // inertia fades out over about a second
    }
    parallaxX += (targetParallaxX - parallaxX) * 0.06;
    parallaxY += (targetParallaxY - parallaxY) * 0.06;
    globe.rotation.set(pitch + parallaxY, yaw + parallaxX, 0, "XYZ");

    dotUniforms.uTime.value = elapsed;
    cityUniforms.uTime.value = elapsed;
    const cycle = routes.length > 0 ? Math.floor(Math.max(0, elapsed - 2.6) / 3.2) % routes.length : -1;
    arcs.forEach((a, i) => {
      const u = a.mat.uniforms;
      u.uTime.value = elapsed;
      if (animate) u.uDrawn.value = Math.min(1, Math.max(0, (elapsed - a.delay) / 1.4));
      const target = i === cycle ? 1 : 0;
      u.uHighlight.value += (target - u.uHighlight.value) * (animate ? 0.08 : 1);
    });
    if (cycle !== activeRoute && elapsed > 2.6) {
      activeRoute = cycle;
      onActiveRoute?.(cycle);
    }

    renderer.render(scene, camera);
    const settling = Math.abs(velocity) > 0.001 || Math.abs(targetParallaxX - parallaxX) > 0.0005;
    if (running && (animate || dragging || settling)) raf = requestAnimationFrame(frame);
  }

  function requestFrame() {
    if (!raf && onScreen && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }
  function start() {
    running = true;
    requestFrame();
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  const visibility = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    if (onScreen) start();
    else stop();
  });
  visibility.observe(container);
  function onVisibility() {
    if (document.hidden) stop();
    else if (onScreen) start();
  }
  document.addEventListener("visibilitychange", onVisibility);

  resize();
  refreshTheme();
  if (reducedMotion) onActiveRoute?.(0);
  start();

  return {
    refreshTheme,
    dispose() {
      stop();
      visibility.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      scene.traverse((obj) => {
        const mesh = obj as Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as ShaderMaterial | ShaderMaterial[] | undefined;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
