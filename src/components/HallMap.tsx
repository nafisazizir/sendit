import type { Face, Hall, Wall } from '../types';

interface Props {
  hall: Hall;
  walls: Wall[];
  faces: Face[];
  currentFaceId: string;
  onTapFace: (faceId: string) => void;
}

/** Top-down schematic of the boulder hall. Walls with fitted geometry are drawn face by face and are tappable. */
export default function HallMap({ hall, walls, faces, currentFaceId, onTapFace }: Props) {
  const xs = hall.outline.map((p) => p[0]);
  const ys = hall.outline.map((p) => p[1]);
  const pad = 2;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const w = Math.max(...xs) - minX + pad;
  const h = Math.max(...ys) - minY + pad;
  const pts = (poly: [number, number][]) => poly.map((p) => `${p[0]},${p[1]}`).join(' ');

  return (
    <div className="hall">
      <svg viewBox={`${minX} ${minY} ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
        <polygon points={pts(hall.outline)} className="hall-outline" />
        {hall.blocks.map((b) => {
          const cx = b.outline.reduce((a, p) => a + p[0], 0) / b.outline.length;
          const cy = b.outline.reduce((a, p) => a + p[1], 0) / b.outline.length;
          return (
            <g key={b.id} className={'hall-block' + (b.inScope ? '' : ' out')}>
              <polygon points={pts(b.outline)} />
              <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central">
                {b.name}
              </text>
            </g>
          );
        })}
        {walls
          .filter((wall) => wall.position)
          .map((wall) => {
            const { x, y, rotation } = wall.position!;
            const wf = wall.faceIds.map((id) => faces.find((f) => f.id === id)!).filter((f) => f?.geometry);
            // centre the footprint on the wall's position
            const cx = wf.reduce((a, f) => a + f.geometry!.from[0], 0) / (wf.length || 1);
            const cz = wf.reduce((a, f) => a + f.geometry!.from[1], 0) / (wf.length || 1);
            return (
              <g key={wall.id} className="hall-wall" transform={`translate(${x} ${y}) rotate(${rotation}) translate(${-cx} ${-cz})`}>
                {wf.map((f) => {
                  const g = f.geometry!;
                  const mx = (g.from[0] + g.to[0]) / 2;
                  const mz = (g.from[1] + g.to[1]) / 2;
                  // label just outside the face: along the outward normal (away from the centroid)
                  let nx = g.to[1] - g.from[1];
                  let nz = -(g.to[0] - g.from[0]);
                  const nl = Math.hypot(nx, nz) || 1;
                  nx /= nl;
                  nz /= nl;
                  if (nx * (mx - cx) + nz * (mz - cz) < 0) {
                    nx = -nx;
                    nz = -nz;
                  }
                  const active = f.id === currentFaceId;
                  return (
                    <g key={f.id} className={'hall-face' + (active ? ' active' : '')} onClick={() => onTapFace(f.id)}>
                      <line x1={g.from[0]} y1={g.from[1]} x2={g.to[0]} y2={g.to[1]} />
                      {/* wide invisible hit area */}
                      <line x1={g.from[0]} y1={g.from[1]} x2={g.to[0]} y2={g.to[1]} className="hit" />
                      <text x={mx + nx * 1.1} y={mz + nz * 1.1} textAnchor="middle" dominantBaseline="central">
                        {f.number}
                      </text>
                    </g>
                  );
                })}
                <text className="wall-name" x={cx} y={cz} textAnchor="middle" dominantBaseline="central" transform={`rotate(${-rotation} ${cx} ${cz})`}>
                  {wall.name}
                </text>
              </g>
            );
          })}
      </svg>
      <div className="hall-note">{hall.note}</div>
    </div>
  );
}
