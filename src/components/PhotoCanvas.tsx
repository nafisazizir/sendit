import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Pt } from '../types';

export interface View {
  s: number;
  tx: number;
  ty: number;
}

interface Props {
  src: string;
  width: number;
  height: number;
  /** Fired on a clean tap (no drag). Point is normalised photo space. */
  onTap?: (p: Pt) => void;
  /** Optional draggable handles (normalised). Used by the editor to move vertices. */
  handles?: Pt[];
  onHandleMove?: (index: number, p: Pt) => void;
  onHandleDrop?: () => void;
  /** SVG children drawn in photo-pixel space (0..width, 0..height). A function gets the live view (for screen-constant sizes). */
  children?: ReactNode | ((view: View) => ReactNode);
  /** Change this to re-fit (e.g. when switching face). */
  fitKey?: string;
  /** Zoom to this normalised region when `focus.key` changes. */
  focus?: { key: string; minX: number; minY: number; maxX: number; maxY: number } | null;
}

const TAP_MOVE_PX = 8;
const TAP_MS = 400;
const DOUBLE_TAP_MS = 300;
const HANDLE_HIT_PX = 18;

/**
 * Pan/pinch/wheel zoomable photo with an SVG overlay in photo-pixel coordinates.
 * The gesture code is deliberately hand-rolled: how this feels on a phone at the
 * wall is the thing the playground exists to find out.
 */
export default function PhotoCanvas({ src, width, height, onTap, handles, onHandleMove, onHandleDrop, children, fitKey, focus }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setViewState] = useState<View>({ s: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  const fitScale = useRef(1);
  // Programmatic view changes tween over a few frames; gestures apply immediately.
  // (A CSS transition on transform was tried first and stalled while the browser decoded the new photo.)
  const anim = useRef<{ raf: number; timer: number } | null>(null);
  const setView = useCallback((v: View, animated = false) => {
    if (anim.current) {
      cancelAnimationFrame(anim.current.raf);
      clearTimeout(anim.current.timer);
      anim.current = null;
    }
    if (!animated) {
      viewRef.current = v;
      setViewState(v);
      return;
    }
    const from = viewRef.current;
    const t0 = performance.now();
    const D = 220;
    const finish = () => {
      anim.current = null;
      viewRef.current = v;
      setViewState(v);
    };
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / D);
      if (t >= 1) {
        clearTimeout(anim.current?.timer);
        finish();
        return;
      }
      const e = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const cur = { s: from.s + (v.s - from.s) * e, tx: from.tx + (v.tx - from.tx) * e, ty: from.ty + (v.ty - from.ty) * e };
      viewRef.current = cur;
      setViewState(cur);
      if (anim.current) anim.current.raf = requestAnimationFrame(step);
    };
    // rAF is throttled to nothing in a background or occluded tab; the timer guarantees we still land.
    anim.current = { raf: requestAnimationFrame(step), timer: window.setTimeout(finish, D + 100) };
  }, []);

  const clampScale = (s: number) => Math.min(Math.max(s, fitScale.current * 0.6), fitScale.current * 12);

  const fit = useCallback(
    (animated = false) => {
      const el = box.current;
      if (!el) return;
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      const s = Math.min(cw / width, ch / height);
      fitScale.current = s;
      setView({ s, tx: (cw - width * s) / 2, ty: (ch - height * s) / 2 }, animated);
    },
    [width, height, setView],
  );

  useEffect(() => {
    fit();
  }, [fit, fitKey]);

  const focusKey = focus?.key ?? null;
  useEffect(() => {
    const el = box.current;
    if (!el || !focus) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const pad = 0.18; // fraction of region size added around it
    const rw = Math.max((focus.maxX - focus.minX) * width, 60);
    const rh = Math.max((focus.maxY - focus.minY) * height, 60);
    // Never closer than 4x fit: a lone crimp at 12x is a blurry square with no context.
    const s = Math.min(clampScale(Math.min(cw / (rw * (1 + pad * 2)), ch / (rh * (1 + pad * 2)))), fitScale.current * 4);
    const cx = ((focus.minX + focus.maxX) / 2) * width;
    const cy = ((focus.minY + focus.maxY) / 2) * height;
    setView({ s, tx: cw / 2 - cx * s, ty: ch / 2 - cy * s }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  // --- coordinate helpers ---
  const toLocal = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };
  const localToPhoto = (l: { x: number; y: number }, v: View = viewRef.current): Pt => [
    (l.x - v.tx) / v.s / width,
    (l.y - v.ty) / v.s / height,
  ];
  const photoToLocal = (p: Pt, v: View = viewRef.current) => ({ x: p[0] * width * v.s + v.tx, y: p[1] * height * v.s + v.ty });

  const zoomAt = (local: { x: number; y: number }, newScale: number, animated = false, from: View = viewRef.current) => {
    const s = clampScale(newScale);
    const px = (local.x - from.tx) / from.s;
    const py = (local.y - from.ty) / from.s;
    setView({ s, tx: local.x - px * s, ty: local.y - py * s }, animated);
  };

  // --- gestures ---
  type Gesture =
    | { mode: 'none' }
    | { mode: 'pan'; startX: number; startY: number; startView: View; moved: boolean; downAt: number; pointerId: number }
    | { mode: 'pinch'; startDist: number; startMid: { x: number; y: number }; startView: View }
    | { mode: 'handle'; index: number; pointerId: number };
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture>({ mode: 'none' });
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);

  const beginPan = (pointerId: number, l: { x: number; y: number }, downAt: number): Extract<Gesture, { mode: 'pan' }> => ({
    mode: 'pan',
    startX: l.x,
    startY: l.y,
    startView: viewRef.current,
    moved: false,
    downAt,
    pointerId,
  });

  const onPointerDown = (e: React.PointerEvent) => {
    const el = box.current!;
    el.setPointerCapture(e.pointerId);
    const l = toLocal(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, l);

    if (pointers.current.size === 1) {
      // handle hit test first
      if (handles && onHandleMove) {
        let best = -1;
        let bestD = HANDLE_HIT_PX;
        handles.forEach((h, i) => {
          const hl = photoToLocal(h);
          const d = Math.hypot(hl.x - l.x, hl.y - l.y);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        if (best >= 0) {
          gesture.current = { mode: 'handle', index: best, pointerId: e.pointerId };
          return;
        }
      }
      gesture.current = beginPan(e.pointerId, l, e.timeStamp);
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        mode: 'pinch',
        startDist: Math.hypot(a.x - b.x, a.y - b.y),
        startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        startView: viewRef.current,
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const l = toLocal(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, l);
    const g = gesture.current;

    if (g.mode === 'handle' && g.pointerId === e.pointerId) {
      const p = localToPhoto(l);
      onHandleMove?.(g.index, [Math.min(1, Math.max(0, p[0])), Math.min(1, Math.max(0, p[1]))]);
    } else if (g.mode === 'pan' && g.pointerId === e.pointerId) {
      const dx = l.x - g.startX;
      const dy = l.y - g.startY;
      if (!g.moved && Math.hypot(dx, dy) > TAP_MOVE_PX) g.moved = true;
      if (g.moved) setView({ s: g.startView.s, tx: g.startView.tx + dx, ty: g.startView.ty + dy });
    } else if (g.mode === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const s = clampScale(g.startView.s * (d / g.startDist));
      // keep the photo point that was under the start midpoint under the current midpoint
      const px = (g.startMid.x - g.startView.tx) / g.startView.s;
      const py = (g.startMid.y - g.startView.ty) / g.startView.s;
      setView({ s, tx: mid.x - px * s, ty: mid.y - py * s });
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    const g = gesture.current;
    const l = toLocal(e.clientX, e.clientY);
    pointers.current.delete(e.pointerId);

    if (g.mode === 'handle' && g.pointerId === e.pointerId) {
      onHandleDrop?.();
      gesture.current = { mode: 'none' };
    } else if (g.mode === 'pan' && g.pointerId === e.pointerId) {
      gesture.current = { mode: 'none' };
      const quick = e.timeStamp - g.downAt < TAP_MS;
      if (!g.moved && quick && e.type !== 'pointercancel') {
        const prev = lastTap.current;
        if (prev && e.timeStamp - prev.t < DOUBLE_TAP_MS && Math.hypot(prev.x - l.x, prev.y - l.y) < 24) {
          // double tap: zoom in to 3x fit, or back out to fit
          lastTap.current = null;
          const v = viewRef.current;
          if (v.s > fitScale.current * 1.5) fit(true);
          else zoomAt(l, fitScale.current * 3, true);
        } else {
          lastTap.current = { t: e.timeStamp, x: l.x, y: l.y };
          onTap?.(localToPhoto(l));
        }
      }
    } else if (g.mode === 'pinch') {
      if (pointers.current.size === 1) {
        const [id, pl] = [...pointers.current.entries()][0];
        gesture.current = { ...beginPan(id, pl, e.timeStamp), moved: true };
      } else if (pointers.current.size === 0) {
        gesture.current = { mode: 'none' };
      }
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const l = toLocal(e.clientX, e.clientY);
    if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      zoomAt(l, viewRef.current.s * Math.exp(-e.deltaY * 0.0025));
    } else {
      const v = viewRef.current;
      setView({ ...v, tx: v.tx - e.deltaX });
    }
  };

  // React's onWheel is passive; attach non-passive so preventDefault works.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const h = (ev: WheelEvent) => onWheel(ev as unknown as React.WheelEvent);
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={box}
      className="canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="canvas-inner"
        style={{ width, height, transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})` }}
      >
        <img src={src} width={width} height={height} draggable={false} alt="" />
        <svg className="overlay" viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
          {typeof children === 'function' ? children(view) : children}
          {handles?.map((h, i) => (
            <circle
              key={i}
              cx={h[0] * width}
              cy={h[1] * height}
              r={9 / view.s}
              className="handle"
              style={{ strokeWidth: 2 / view.s }}
            />
          ))}
        </svg>
      </div>
      <div className="zoom-hud">{Math.round((view.s / fitScale.current) * 100)}%</div>
    </div>
  );
}
