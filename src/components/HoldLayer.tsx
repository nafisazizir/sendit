import { GRADE_COLOUR } from '../grades';
import { bounds, centroid } from '../geometry';
import type { Hold, Problem, Pt } from '../types';
import type { View } from './PhotoCanvas';

interface Props {
  holds: Hold[]; // holds on the current face
  width: number;
  height: number;
  problems: Problem[];
  selectedProblem: Problem | null;
  mode: 'view' | 'edit';
  selectedHoldId?: string | null;
  draft?: Pt[];
  view: View;
}

const px = (p: Pt, w: number, h: number) => `${p[0] * w},${p[1] * h}`;

/** Everything drawn over the photo: outlines, the spotlight on a selected problem, start/top badges, editor draft. */
export default function HoldLayer({ holds, width: w, height: h, problems, selectedProblem, mode, selectedHoldId, draft, view }: Props) {
  const inProblem = new Map<string, Problem>();
  for (const p of problems) for (const id of p.holdIds) inProblem.set(id, p);

  const sel = selectedProblem;
  const selIds = new Set(sel?.holdIds ?? []);
  const r = 13 / view.s; // badge radius, constant on screen
  const font = 15 / view.s;

  const outlineFor = (hold: Hold) => {
    const colour = GRADE_COLOUR[hold.colour];
    const halo = hold.colour === 'black' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.7)';
    return { colour, halo };
  };

  return (
    <>
      {sel && mode === 'view' && (
        <>
          <defs>
            <mask id="dim-mask">
              <rect x={0} y={0} width={w} height={h} fill="white" />
              {holds
                .filter((hd) => selIds.has(hd.id))
                .map((hd) => (
                  <polygon key={hd.id} points={hd.outline.map((p) => px(p, w, h)).join(' ')} fill="black" />
                ))}
            </mask>
          </defs>
          <rect x={0} y={0} width={w} height={h} fill="rgba(0,0,0,0.55)" mask="url(#dim-mask)" />
        </>
      )}

      {holds.map((hd) => {
        const { colour, halo } = outlineFor(hd);
        const pts = hd.outline.map((p) => px(p, w, h)).join(' ');
        const isSel = selIds.has(hd.id);
        const owner = inProblem.get(hd.id);

        if (mode === 'view') {
          if (sel && !isSel) return null; // spotlight: hide everything else
          const dashed = hd.type !== 'hold';
          const width = sel ? 3 : 1.75;
          return (
            <g key={hd.id} className={sel ? 'hold-sel' : 'hold'}>
              <polygon points={pts} fill="none" stroke={halo} strokeWidth={width + 2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              <polygon
                points={pts}
                fill={sel ? `${colour}22` : 'none'}
                stroke={colour}
                strokeWidth={width}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                strokeDasharray={dashed ? '6 4' : undefined}
                opacity={sel ? 1 : 0.85}
              />
            </g>
          );
        }

        // edit mode
        const isActive = hd.id === selectedHoldId;
        const unassigned = hd.type === 'hold' && !owner;
        return (
          <g key={hd.id}>
            <polygon points={pts} fill="none" stroke={halo} strokeWidth={isActive ? 5 : 3.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            <polygon
              points={pts}
              fill={isActive ? `${colour}55` : unassigned ? `${colour}18` : 'none'}
              stroke={colour}
              strokeWidth={isActive ? 2.5 : 1.5}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeDasharray={hd.type !== 'hold' ? '6 4' : unassigned ? '2 3' : undefined}
            />
          </g>
        );
      })}

      {/* start / top badges for the selected problem */}
      {sel &&
        mode === 'view' &&
        holds
          .filter((hd) => selIds.has(hd.id) && (sel.startHoldIds.includes(hd.id) || sel.finishHoldId === hd.id))
          .map((hd) => {
            const c = centroid(hd.outline);
            const b = bounds(hd.outline);
            const isStart = sel.startHoldIds.includes(hd.id);
            const isTop = sel.finishHoldId === hd.id;
            const label = isStart && isTop ? 'S/T' : isStart ? 'S' : 'T';
            // Sit the badge just above the hold so it never covers a small one.
            const cx = c[0] * w;
            const above = b.minY * h - r * 1.4;
            const cy = above > r ? above : b.maxY * h + r * 1.4;
            return (
              <g key={'b' + hd.id} className="badge">
                <circle cx={cx} cy={cy} r={r} fill={isTop ? '#fff' : '#111'} stroke={isTop ? '#111' : '#fff'} strokeWidth={2 / view.s} />
                <text x={cx} y={cy} fontSize={font} fill={isTop ? '#111' : '#fff'} textAnchor="middle" dominantBaseline="central" fontWeight={700}>
                  {label}
                </text>
              </g>
            );
          })}

      {/* in-progress outline while drawing */}
      {draft && draft.length > 0 && (
        <g className="draft">
          <polyline
            points={draft.map((p) => px(p, w, h)).join(' ')}
            fill={draft.length > 2 ? 'rgba(255,255,255,0.15)' : 'none'}
            stroke="#fff"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            strokeDasharray="5 4"
          />
          {draft.length > 2 && (
            <line
              x1={draft[draft.length - 1][0] * w}
              y1={draft[draft.length - 1][1] * h}
              x2={draft[0][0] * w}
              y2={draft[0][1] * h}
              stroke="#fff"
              strokeOpacity={0.5}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              strokeDasharray="2 4"
            />
          )}
          {draft.map((p, i) => (
            <circle key={i} cx={p[0] * w} cy={p[1] * h} r={(i === 0 ? 7 : 5) / view.s} fill={i === 0 ? '#fff' : '#111'} stroke="#fff" strokeWidth={1.5 / view.s} />
          ))}
        </g>
      )}
    </>
  );
}
