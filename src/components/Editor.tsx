import { useState, type Dispatch } from 'react';
import GradeChip from './GradeChip';
import { problemFaces, problemTitle } from './ProblemSheet';
import { GRADES, HOLD_COLOURS, isGrade } from '../grades';
import { newProblem, type Action } from '../store';
import type { ClimbingSet, Face, Grade, HoldColour, HoldType, Pt } from '../types';

export type Tool = 'select' | 'draw';

interface Props {
  set: ClimbingSet;
  faces: Face[];
  face: Face;
  dispatch: Dispatch<Action>;
  tool: Tool;
  setTool: (t: Tool) => void;
  drawColour: HoldColour;
  setDrawColour: (c: HoldColour) => void;
  drawType: HoldType;
  setDrawType: (t: HoldType) => void;
  draft: Pt[];
  onUndoPoint: () => void;
  onFinishDraft: () => void;
  onCancelDraft: () => void;
  selectedHoldId: string | null;
  setSelectedHoldId: (id: string | null) => void;
  dirty: boolean;
  startedFromDraft: boolean;
  saveToRepo: () => Promise<string>;
  download: () => void;
  discardDraft: () => void;
  toast: (msg: string) => void;
}

const TYPES: { v: HoldType; label: string }[] = [
  { v: 'hold', label: 'Hold' },
  { v: 'volume', label: 'Volume (shared)' },
  { v: 'downclimb', label: 'Downclimb' },
];

/** Rough editor: outline holds, assign them to problems, mark start and top. */
export default function Editor(p: Props) {
  const { set, dispatch } = p;
  const setId = set.id;
  const holdsById = new Map(set.holds.map((h) => [h.id, h]));
  const faceById = new Map(p.faces.map((f) => [f.id, f]));
  const hold = p.selectedHoldId ? holdsById.get(p.selectedHoldId) ?? null : null;
  const owner = hold ? set.problems.find((pr) => pr.holdIds.includes(hold.id)) ?? null : null;
  const [openProblem, setOpenProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const titleOf = (pr: (typeof set.problems)[number]) =>
    problemTitle(
      pr,
      problemFaces(pr, holdsById).map((id) => faceById.get(id)?.number ?? 0),
    );

  const save = async () => {
    setSaving(true);
    try {
      p.toast(await p.saveToRepo());
    } catch (e) {
      p.toast(`Save failed (${String(e).slice(0, 80)}). Use Download instead.`);
    } finally {
      setSaving(false);
    }
  };

  const holdGrade: Grade | null = hold && isGrade(hold.colour) ? hold.colour : null;
  const candidateProblems = set.problems.filter((pr) => !holdGrade || pr.grade === holdGrade);

  return (
    <div className="editor">
      <div className="row toolbar">
        <div className="seg">
          <button type="button" className={p.tool === 'select' ? 'active' : ''} onClick={() => p.setTool('select')}>
            Select
          </button>
          <button type="button" className={p.tool === 'draw' ? 'active' : ''} onClick={() => p.setTool('draw')}>
            Draw
          </button>
        </div>
        <span className="grow" />
        {p.dirty && (
          <button type="button" className="text" onClick={() => confirm('Throw away unsaved changes?') && p.discardDraft()}>
            Discard
          </button>
        )}
        <button type="button" className="text" onClick={p.download}>
          Download
        </button>
        <button type="button" className={'primary' + (p.dirty ? '' : ' quiet')} onClick={save} disabled={saving || !p.dirty}>
          {saving ? 'Saving…' : p.dirty ? 'Save' : 'Saved'}
        </button>
      </div>
      {p.startedFromDraft && p.dirty && <div className="notice">Restored an unsaved draft from this browser.</div>}

      {p.tool === 'draw' && (
        <section>
          <div className="row wrap">
            {HOLD_COLOURS.map((c) => (
              <GradeChip key={c} colour={c} compact active={p.drawColour === c} onClick={() => p.setDrawColour(c)} />
            ))}
          </div>
          <div className="row wrap">
            {TYPES.map((t) => (
              <button key={t.v} type="button" className={'pill' + (p.drawType === t.v ? ' active' : '')} onClick={() => p.setDrawType(t.v)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="row">
            <span className="muted small grow">
              {p.draft.length === 0 ? 'Tap around a hold to outline it.' : `${p.draft.length} point${p.draft.length === 1 ? '' : 's'}`}
            </span>
            <button type="button" className="text" onClick={p.onUndoPoint} disabled={p.draft.length === 0}>
              Undo
            </button>
            <button type="button" className="text" onClick={p.onCancelDraft} disabled={p.draft.length === 0}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={p.onFinishDraft} disabled={p.draft.length < 3}>
              Finish hold
            </button>
          </div>
        </section>
      )}

      {p.tool === 'select' && !hold && (
        <section className="muted small">Tap a hold to edit it. Drag its corners to fix the outline. Tap a problem below to edit its details.</section>
      )}

      {p.tool === 'select' && hold && (
        <section className="hold-panel">
          <div className="row">
            <strong className="grow mono">{hold.id}</strong>
            <button type="button" className="text" onClick={() => p.setSelectedHoldId(null)}>
              Done
            </button>
          </div>
          <div className="row wrap">
            {HOLD_COLOURS.map((c) => (
              <GradeChip
                key={c}
                colour={c}
                compact
                active={hold.colour === c}
                onClick={() => dispatch({ type: 'updateHold', setId, id: hold.id, patch: { colour: c, ...(c === 'yellow' && hold.type === 'hold' ? { type: 'downclimb' } : {}) } })}
              />
            ))}
          </div>
          <div className="row wrap">
            {TYPES.map((t) => (
              <button
                key={t.v}
                type="button"
                className={'pill' + (hold.type === t.v ? ' active' : '')}
                onClick={() => {
                  dispatch({ type: 'updateHold', setId, id: hold.id, patch: { type: t.v } });
                  if (t.v !== 'hold') dispatch({ type: 'assignHold', setId, holdId: hold.id, problemId: null });
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <input
            className="note"
            placeholder="Note (tag text, what it is…)"
            value={hold.note ?? ''}
            onChange={(e) => dispatch({ type: 'updateHold', setId, id: hold.id, patch: { note: e.target.value || undefined } })}
          />

          {hold.type === 'hold' && (
            <>
              <div className="label">Problem</div>
              <div className="row wrap">
                <button type="button" className={'pill' + (!owner ? ' active' : '')} onClick={() => dispatch({ type: 'assignHold', setId, holdId: hold.id, problemId: null })}>
                  None
                </button>
                {candidateProblems.map((pr) => (
                  <button
                    key={pr.id}
                    type="button"
                    className={'pill' + (owner?.id === pr.id ? ' active' : '')}
                    onClick={() => dispatch({ type: 'assignHold', setId, holdId: hold.id, problemId: pr.id })}
                  >
                    <GradeChip colour={pr.grade} compact /> {titleOf(pr)}
                  </button>
                ))}
                {holdGrade && (
                  <button
                    type="button"
                    className="pill dashed"
                    onClick={() => {
                      const pr = newProblem(setId, holdGrade);
                      dispatch({ type: 'addProblem', setId, problem: pr });
                      dispatch({ type: 'assignHold', setId, holdId: hold.id, problemId: pr.id });
                    }}
                  >
                    + New {holdGrade} problem
                  </button>
                )}
              </div>
              {owner && (
                <div className="row">
                  <button
                    type="button"
                    className={'pill' + (owner.startHoldIds.includes(hold.id) ? ' active' : '')}
                    onClick={() => dispatch({ type: 'toggleStart', setId, problemId: owner.id, holdId: hold.id })}
                  >
                    Start
                  </button>
                  <button
                    type="button"
                    className={'pill' + (owner.finishHoldId === hold.id ? ' active' : '')}
                    onClick={() => dispatch({ type: 'setFinish', setId, problemId: owner.id, holdId: owner.finishHoldId === hold.id ? null : hold.id })}
                  >
                    Top
                  </button>
                </div>
              )}
            </>
          )}
          <div className="row">
            <span className="grow" />
            <button
              type="button"
              className="text danger"
              onClick={() => {
                dispatch({ type: 'deleteHold', setId, id: hold.id });
                p.setSelectedHoldId(null);
              }}
            >
              Delete hold
            </button>
          </div>
        </section>
      )}

      <section>
        <div className="row">
          <div className="label grow">Problems on {p.faces[0] ? 'this wall' : ''}</div>
          <select
            className="small"
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              const pr = newProblem(setId, e.target.value as Grade);
              dispatch({ type: 'addProblem', setId, problem: pr });
              setOpenProblem(pr.id);
            }}
          >
            <option value="">+ New problem…</option>
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <ul className="problem-list edit">
          {set.problems.map((pr) => {
            const open = openProblem === pr.id;
            return (
              <li key={pr.id} className={open ? 'open' : ''}>
                <button type="button" onClick={() => setOpenProblem(open ? null : pr.id)}>
                  <GradeChip colour={pr.grade} compact />
                  <span className="grow">{titleOf(pr)}</span>
                  {!pr.verified && <span className="tag">?</span>}
                  <span className="muted small">{pr.holdIds.length}</span>
                </button>
                {open && (
                  <div className="problem-edit">
                    <input className="note" placeholder="Name (optional)" value={pr.name ?? ''} onChange={(e) => dispatch({ type: 'updateProblem', setId, id: pr.id, patch: { name: e.target.value || undefined } })} />
                    <textarea className="note" placeholder="Note" rows={2} value={pr.note ?? ''} onChange={(e) => dispatch({ type: 'updateProblem', setId, id: pr.id, patch: { note: e.target.value || undefined } })} />
                    <div className="row">
                      <label className="small">
                        <input type="checkbox" checked={pr.verified} onChange={(e) => dispatch({ type: 'updateProblem', setId, id: pr.id, patch: { verified: e.target.checked } })} /> Checked at the wall
                      </label>
                      <span className="grow" />
                      <button
                        type="button"
                        className="text danger"
                        onClick={() => {
                          if (!confirm('Delete this problem? Its holds stay.')) return;
                          dispatch({ type: 'deleteProblem', setId, id: pr.id });
                          setOpenProblem(null);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="row">
        <label className="small grow">
          Set went up&nbsp;
          <input type="date" value={set.dateUp ?? ''} onChange={(e) => dispatch({ type: 'setDateUp', setId, date: e.target.value || null })} />
        </label>
        <span className="muted small">photographed {set.photographedOn}</span>
      </section>
    </div>
  );
}
