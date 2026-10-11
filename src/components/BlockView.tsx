import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GRADE_COLOUR } from '../grades';
import { pointInPolygon, polygonArea } from '../geometry';
import type { Face, FacePhoto, Hold, Problem, Pt } from '../types';

interface Props {
  /** Bump this to make the camera swing to the current face (e.g. after using the face switcher). */
  focusFaceKey?: number;
  faces: Face[];
  photos: FacePhoto[];
  holds: Hold[];
  problems: Problem[];
  selectedProblem: Problem | null;
  currentFaceId: string;
  onTapFace: (faceId: string) => void;
  onTapHold: (hold: Hold) => void;
}

const TEX_W = 1024;
const TAP_PX = 8;
const GRID = 12; // subdivisions per face so the perspective mapping is close to exact

/** Map the unit square (u right, v down) onto a photo quad [TL, TR, BR, BL]. Heckbert's closed form. */
function squareToQuad([p0, p1, p2, p3]: [Pt, Pt, Pt, Pt]) {
  const [x0, y0] = p0, [x1, y1] = p1, [x2, y2] = p2, [x3, y3] = p3;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  let a: number, b: number, c: number, d: number, e: number, f: number, g = 0, h = 0;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    a = x1 - x0; b = x2 - x1; c = x0; d = y1 - y0; e = y2 - y1; f = y0;
  } else {
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den;
    h = (dx1 * sy - sx * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
  }
  return (u: number, v: number): Pt => {
    const w = g * u + h * v + 1;
    return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
  };
}

/** The photo quad for a face: explicit quad, else the crop rectangle, else the whole photo. */
function faceQuad(f: Face): [Pt, Pt, Pt, Pt] {
  const g = f.geometry;
  if (g?.quad) return g.quad;
  const [x, y, w, h] = g?.crop ?? [0, 0, 1, 1];
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

/**
 * "2.5D" Jawa: each face is a flat quad on an estimated footprint, textured with its anchor photo
 * and the same hold outlines as the photo view. Exists to compare "see the block" navigation
 * against face-by-face paging on a phone. Not a scan; geometry is a guess until measured.
 */
export default function BlockView({ faces, photos, holds, problems, selectedProblem, currentFaceId, onTapFace, onTapHold, focusFaceKey }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const scene = useRef<{
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    meshes: Map<string, THREE.Mesh>;
    outlines: Map<string, THREE.LineSegments>;
    canvases: Map<string, { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; img: HTMLImageElement | null }>;
    requestRender: () => void;
    lookAtFace: (faceId: string, animate: boolean) => void;
  } | null>(null);
  const [loaded, setLoaded] = useState(0);

  // Latest props for the pointer handlers without re-binding them.
  const latest = useRef({ holds, problems, selectedProblem, onTapFace, onTapHold, faces, currentFaceId });
  latest.current = { holds, problems, selectedProblem, onTapFace, onTapHold, faces, currentFaceId };

  // --- build scene once ---
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const geomFaces = faces.filter((f) => f.geometry);
    if (geomFaces.length === 0) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    const sc = new THREE.Scene();
    sc.background = new THREE.Color(0x0a0a0a);

    // centre of the footprint
    const pts = geomFaces.map((f) => f.geometry!.from);
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const H = Math.max(...geomFaces.map((f) => f.geometry!.height));

    const camera = new THREE.PerspectiveCamera(50, el.clientWidth / el.clientHeight, 0.1, 200);
    camera.position.set(cx, H * 0.6, cz + 12);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(cx, H * 0.45, cz);
    const faceInfo = new Map<string, { centre: THREE.Vector3; normal: THREE.Vector3; width: number }>();
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.minDistance = 3;
    controls.maxDistance = 30;
    controls.maxPolarAngle = Math.PI / 2 - 0.05; // stay above the mats
    controls.enablePan = false;

    // mats
    const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 48), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, -0.01, cz);
    sc.add(floor);
    const grid = new THREE.GridHelper(28, 28, 0x262626, 0x202020);
    grid.position.set(cx, 0, cz);
    sc.add(grid);

    const meshes = new Map<string, THREE.Mesh>();
    const outlines = new Map<string, THREE.LineSegments>();
    const canvases = new Map<string, { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; img: HTMLImageElement | null }>();

    for (const f of geomFaces) {
      const g = f.geometry!;
      const photo = photos.find((p) => p.faceId === f.id && p.role === 'anchor');
      const aspect = photo ? photo.height / photo.width : 1.33;

      // outward normal: perpendicular to the base edge, pointing away from the centroid
      const ex = g.to[0] - g.from[0];
      const ez = g.to[1] - g.from[1];
      let nx = ez;
      let nz = -ex;
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl;
      nz /= nl;
      const mx = (g.from[0] + g.to[0]) / 2 - cx;
      const mz = (g.from[1] + g.to[1]) / 2 - cz;
      if (nx * mx + nz * mz < 0) {
        nx = -nx;
        nz = -nz;
      }
      const lean = Math.tan((g.lean * Math.PI) / 180) * g.height;
      const bl = new THREE.Vector3(g.from[0], 0, g.from[1]);
      const br = new THREE.Vector3(g.to[0], 0, g.to[1]);
      const tl = new THREE.Vector3(g.from[0] + nx * lean, g.height, g.from[1] + nz * lean);
      const tr = new THREE.Vector3(g.to[0] + nx * lean, g.height, g.to[1] + nz * lean);

      // Subdivided quad. Positions are bilinear between the corners; UVs go through the homography
      // so the photo's perspective is undone and only the wall region lands on the face.
      const toPhoto = squareToQuad(faceQuad(f));
      const pos: number[] = [];
      const uv: number[] = [];
      for (let j = 0; j <= GRID; j++) {
        const v = j / GRID; // 0 top .. 1 bottom
        for (let i = 0; i <= GRID; i++) {
          const u = i / GRID; // 0 from .. 1 to
          const top = new THREE.Vector3().lerpVectors(tl, tr, u);
          const bot = new THREE.Vector3().lerpVectors(bl, br, u);
          const p = new THREE.Vector3().lerpVectors(top, bot, v);
          pos.push(p.x, p.y, p.z);
          const [px, py] = toPhoto(u, v);
          uv.push(px, 1 - py); // texture space: t up
        }
      }
      const idx: number[] = [];
      for (let j = 0; j < GRID; j++) {
        for (let i = 0; i < GRID; i++) {
          const a0 = j * (GRID + 1) + i;
          const b0 = a0 + 1;
          const c0 = a0 + GRID + 1;
          const d0 = c0 + 1;
          idx.push(a0, c0, b0, b0, c0, d0);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      // Flip winding if the normal points inward so the texture faces out.
      const n = new THREE.Vector3().fromArray(geo.getAttribute('normal').array as unknown as number[], 0);
      if (n.x * nx + n.z * nz < 0) {
        const flipped: number[] = [];
        for (let k = 0; k < idx.length; k += 3) flipped.push(idx[k], idx[k + 2], idx[k + 1]);
        geo.setIndex(flipped);
      }

      const canvas = document.createElement('canvas');
      canvas.width = TEX_W;
      canvas.height = Math.round(TEX_W * aspect);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.faceId = f.id;
      sc.add(mesh);
      meshes.set(f.id, mesh);

      const border = new THREE.BufferGeometry().setFromPoints([tl, tr, tr, br, br, bl, bl, tl]);
      const edges = new THREE.LineSegments(border, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }));
      sc.add(edges);
      outlines.set(f.id, edges);

      const centre = new THREE.Vector3().addVectors(bl, tr).multiplyScalar(0.5);
      faceInfo.set(f.id, { centre, normal: new THREE.Vector3(nx, 0, nz), width: bl.distanceTo(br) });

      // "F4" label floating just above the top edge
      const lc = document.createElement('canvas');
      lc.width = 128;
      lc.height = 64;
      const lctx = lc.getContext('2d')!;
      lctx.fillStyle = 'rgba(0,0,0,0.6)';
      lctx.beginPath();
      lctx.roundRect(8, 8, 112, 48, 12);
      lctx.fill();
      lctx.fillStyle = '#fff';
      lctx.font = 'bold 34px sans-serif';
      lctx.textAlign = 'center';
      lctx.textBaseline = 'middle';
      lctx.fillText(`F${f.number}`, 64, 33);
      const ltex = new THREE.CanvasTexture(lc);
      ltex.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: ltex, transparent: true }));
      label.scale.set(0.7, 0.35, 1);
      label.position.copy(new THREE.Vector3().addVectors(tl, tr).multiplyScalar(0.5)).add(new THREE.Vector3(nx * 0.3, 0.35, nz * 0.3));
      label.renderOrder = 10;
      sc.add(label);

      const entry = { canvas, tex, img: null as HTMLImageElement | null };
      canvases.set(f.id, entry);
      if (photo) {
        const img = new Image();
        img.onload = () => {
          entry.img = img;
          setLoaded((n) => n + 1);
        };
        img.src = photo.src;
      }
    }

    // Render on demand rather than every frame: saves the phone's battery while you stand and look.
    // A timer backs up rAF so a throttled (background) tab still draws.
    let pending = false;
    let raf = 0;
    let timer = 0;
    const render = () => {
      pending = false;
      const camMoving = stepCamAnim();
      const stillMoving = controls.update();
      renderer.render(sc, camera);
      if (stillMoving || camMoving) requestRender();
    };
    const requestRender = () => {
      if (pending) return;
      pending = true;
      raf = requestAnimationFrame(() => {
        clearTimeout(timer);
        render();
      });
      timer = window.setTimeout(() => {
        cancelAnimationFrame(raf);
        render();
      }, 250);
    };
    controls.addEventListener('change', requestRender);

    // Put the camera in front of a face, at a distance where the face fills most of the view.
    let camAnim: { t0: number; from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3 } | null = null;
    // Orbit always circles the block centre, from outside it, so you cannot end up inside the prism.
    const blockCentre = new THREE.Vector3(cx, H * 0.45, cz);
    let blockRadius = 1;
    for (const info of faceInfo.values()) blockRadius = Math.max(blockRadius, Math.hypot(info.centre.x - cx, info.centre.z - cz) + info.width / 2);
    controls.minDistance = blockRadius * 1.4;
    controls.maxDistance = blockRadius * 6;
    const lookAtFace = (faceId: string, animate: boolean) => {
      const info = faceInfo.get(faceId);
      if (!info) return;
      const dir = new THREE.Vector3(info.centre.x - cx, 0, info.centre.z - cz).normalize().lerp(info.normal, 0.5).setY(0).normalize();
      const dist = blockRadius * 2.4;
      const to = blockCentre.clone().add(dir.multiplyScalar(dist)).setY(H * 0.95);
      const tTo = blockCentre.clone();
      if (!animate) {
        camera.position.copy(to);
        controls.target.copy(tTo);
        controls.update();
        requestRender();
        return;
      }
      camAnim = { t0: performance.now(), from: camera.position.clone(), to, tFrom: controls.target.clone(), tTo };
      requestRender();
    };
    const stepCamAnim = () => {
      if (!camAnim) return false;
      const t = Math.min(1, (performance.now() - camAnim.t0) / 450);
      const e = 1 - Math.pow(1 - t, 3);
      camera.position.lerpVectors(camAnim.from, camAnim.to, e);
      controls.target.lerpVectors(camAnim.tFrom, camAnim.tTo, e);
      if (t >= 1) camAnim = null;
      return true;
    };
    lookAtFace(latest.current.currentFaceId, false);

    const ro = new ResizeObserver(() => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      requestRender();
    });
    ro.observe(el);

    // tap → raycast
    const ray = new THREE.Raycaster();
    let down: { x: number; y: number; t: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.isPrimary) down = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    };
    const onUp = (e: PointerEvent) => {
      if (!down || !e.isPrimary) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = e.timeStamp - down.t < 400;
      down = null;
      if (moved > TAP_PX || !quick) return;
      const r = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects([...meshes.values()], false)[0];
      if (!hit || !hit.uv) return;
      const faceId = hit.object.userData.faceId as string;
      const { holds, onTapFace, onTapHold } = latest.current;
      const p: Pt = [hit.uv.x, 1 - hit.uv.y];
      let best: Hold | null = null;
      let bestA = Infinity;
      for (const h of holds) {
        if (h.faceId !== faceId || !pointInPolygon(p, h.outline)) continue;
        const a = polygonArea(h.outline);
        if (a < bestA) {
          bestA = a;
          best = h;
        }
      }
      if (best) onTapHold(best);
      else onTapFace(faceId);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    scene.current = { renderer, camera, controls, meshes, outlines, canvases, requestRender, lookAtFace };
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      for (const m of meshes.values()) {
        m.geometry.dispose();
        (m.material as THREE.MeshBasicMaterial).map?.dispose();
        (m.material as THREE.Material).dispose();
      }
      renderer.dispose();
      el.removeChild(renderer.domElement);
      scene.current = null;
    };
    // The scene is rebuilt only when the wall's faces or photos change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faces, photos]);

  // --- redraw textures when holds / selection / loaded photos change ---
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    const sel = selectedProblem;
    const selIds = new Set(sel?.holdIds ?? []);
    for (const f of faces) {
      const entry = s.canvases.get(f.id);
      if (!entry) continue;
      const { canvas, tex, img } = entry;
      const ctx = canvas.getContext('2d')!;
      const W = canvas.width;
      const Hh = canvas.height;
      ctx.fillStyle = '#3a3128';
      ctx.fillRect(0, 0, W, Hh);
      if (img) ctx.drawImage(img, 0, 0, W, Hh);
      // photo-normalised → canvas px
      const X = (x: number) => x * W;
      const Y = (y: number) => y * Hh;

      const faceHolds = holds.filter((h) => h.faceId === f.id);
      const path = (h: Hold) => {
        ctx.beginPath();
        h.outline.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
        ctx.closePath();
      };

      if (sel) {
        // spotlight: dim everything, then re-draw the photo inside the problem's holds
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, W, Hh);
        for (const h of faceHolds) {
          if (!selIds.has(h.id)) continue;
          ctx.save();
          path(h);
          ctx.clip();
          if (img) ctx.drawImage(img, 0, 0, W, Hh);
          ctx.restore();
          path(h);
          ctx.lineJoin = 'round';
          ctx.lineWidth = 9;
          ctx.strokeStyle = h.colour === 'black' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.7)';
          ctx.stroke();
          ctx.lineWidth = 5;
          ctx.strokeStyle = GRADE_COLOUR[h.colour];
          ctx.stroke();
          const isStart = sel.startHoldIds.includes(h.id);
          const isTop = sel.finishHoldId === h.id;
          if (isStart || isTop) {
            const xs = h.outline.map((p) => X(p[0]));
            const ys = h.outline.map((p) => Y(p[1]));
            const bx = xs.reduce((a, b) => a + b, 0) / xs.length;
            const by = Math.min(...ys) - 22;
            ctx.beginPath();
            ctx.arc(bx, by, 16, 0, Math.PI * 2);
            ctx.fillStyle = isTop ? '#fff' : '#111';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = isTop ? '#111' : '#fff';
            ctx.stroke();
            ctx.fillStyle = isTop ? '#111' : '#fff';
            ctx.font = 'bold 18px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(isStart && isTop ? 'S/T' : isStart ? 'S' : 'T', bx, by + 1);
          }
        }
      } else {
        for (const h of faceHolds) {
          path(h);
          ctx.lineJoin = 'round';
          ctx.setLineDash(h.type !== 'hold' ? [8, 6] : []);
          ctx.lineWidth = 5;
          ctx.strokeStyle = h.colour === 'black' ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.6)';
          ctx.stroke();
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = GRADE_COLOUR[h.colour];
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      tex.needsUpdate = true;
    }
    s.requestRender();
  }, [faces, holds, problems, selectedProblem, loaded]);

  // swing to the current face when asked (face switcher), not on every tap
  const firstFocus = useRef(true);
  useEffect(() => {
    if (firstFocus.current) {
      firstFocus.current = false;
      return;
    }
    scene.current?.lookAtFace(currentFaceId, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusFaceKey]);

  // highlight the current face's edges
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    for (const [id, line] of s.outlines) {
      const mat = line.material as THREE.LineBasicMaterial;
      mat.opacity = id === currentFaceId ? 1 : 0.2;
      mat.color.set(id === currentFaceId ? 0xffffff : 0x888888);
    }
    s.requestRender();
  }, [currentFaceId, loaded]);

  const total = faces.filter((f) => f.geometry).length;
  return (
    <div ref={box} className="block">
      {total === 0 && <div className="block-loading">No face geometry for this wall yet (faces[].geometry in the data file).</div>}
      {total > 0 && loaded < total && <div className="block-loading">loading photos {loaded}/{total}</div>}
    </div>
  );
}
