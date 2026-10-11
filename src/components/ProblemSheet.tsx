import { useState } from 'react';
import GradeChip from './GradeChip';
import { GRADES, GRADE_LABEL } from '../grades';
import type { Face, Grade, Hold, Problem } from '../types';

interface Props {
  problems: Problem[];
  holds: Hold[];
  faces: Face[];
  currentFaceId: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onJumpToFace: (faceId: string) => void;
}

export function problemFaces(p: Problem, holdsById: Map<string, Hold>): string[] {
  const seen: string[] = [];
  for (const id of p.holdIds) {
    const f = holdsById.get(id)?.faceId;
    if (f && !seen.includes(f)) seen.push(f);
  }
  return seen;
}

export function problemTitle(p: Problem, faceNumbers: number[]): string {
  if (p.name) return p.name;
  const f = faceNumbers.length ? ` · F${faceNumbers.join('→')}` : '';
  return `${GRADE_LABEL[p.grade]}${f}`;
}

/** List of problems on the wall. Those touching the current face come first. */
export default function ProblemSheet({ problems, holds, faces, currentFaceId, selectedId, onSelect, onJumpToFace }: Props) {
  const [filter, setFilter] = useState<Grade | null>(null);
  const holdsById = new Map(holds.map((h) => [h.id, h]));
  const faceById = new Map(faces.map((f) => [f.id, f]));

  const rows = problems
    .filter((p) => !filter || p.grade === filter)
    .map((p) => {
      const fids = problemFaces(p, holdsById);
      return { p, fids, nums: fids.map((id) => faceById.get(id)?.number ?? 0), here: fids.includes(currentFaceId) };
    })
    .sort((a, b) => Number(b.here) - Number(a.here) || GRADES.indexOf(a.p.grade) - GRADES.indexOf(b.p.grade));

  const selected = rows.find((r) => r.p.id === selectedId);

  return (
    <div className="sheet">
      <div className="filter-row">
        {GRADES.map((g) => (
          <GradeChip key={g} colour={g} compact active={filter === g} onClick={() => setFilter(filter === g ? null : g)} />
        ))}
        {filter && (
          <button type="button" className="text" onClick={() => setFilter(null)}>
            clear
          </button>
        )}
      </div>

      {selected && (
        <div className="selected-bar">
          <GradeChip colour={selected.p.grade} />
          <div className="grow">
            <div>
              <strong>{problemTitle(selected.p, selected.nums)}</strong>
              {!selected.p.verified && <span className="tag">unverified</span>}
            </div>
            <div className="muted small">
              {selected.p.holdIds.length} holds · {selected.p.startHoldIds.length || 'no'} start · {selected.p.finishHoldId ? 'top marked' : 'no top'}
              {selected.p.note ? ` · ${selected.p.note}` : ''}
            </div>
            {selected.fids.length > 1 && (
              <div className="face-jumps">
                {selected.fids.map((fid) => (
                  <button key={fid} type="button" className={'pill' + (fid === currentFaceId ? ' active' : '')} onClick={() => onJumpToFace(fid)}>
                    F{faceById.get(fid)?.number}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="icon" onClick={() => onSelect(null)} aria-label="Deselect">
            ×
          </button>
        </div>
      )}

      <ul className="problem-list">
        {rows.map(({ p, nums, here }) => (
          <li key={p.id} className={(p.id === selectedId ? 'active' : '') + (here ? '' : ' elsewhere')}>
            <button type="button" onClick={() => onSelect(p.id === selectedId ? null : p.id)}>
              <GradeChip colour={p.grade} compact />
              <span className="grow">{problemTitle(p, nums)}</span>
              {!p.verified && <span className="tag">?</span>}
              <span className="muted small">{p.holdIds.length}</span>
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="muted small empty">No problems{filter ? ` in ${GRADE_LABEL[filter]}` : ''} yet.</li>}
      </ul>
    </div>
  );
}
