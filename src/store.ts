import { useEffect, useMemo, useReducer } from 'react';
import type { ClimbingSet, Data, Grade, Hold, Problem } from './types';
import initial from './data/jawa.json';

const DRAFT_KEY = 'sendit-draft-v1';

export type Action =
  | { type: 'replace'; data: Data }
  | { type: 'addHold'; setId: string; hold: Hold }
  | { type: 'updateHold'; setId: string; id: string; patch: Partial<Hold> }
  | { type: 'deleteHold'; setId: string; id: string }
  | { type: 'addProblem'; setId: string; problem: Problem }
  | { type: 'updateProblem'; setId: string; id: string; patch: Partial<Problem> }
  | { type: 'deleteProblem'; setId: string; id: string }
  | { type: 'assignHold'; setId: string; holdId: string; problemId: string | null }
  | { type: 'toggleStart'; setId: string; problemId: string; holdId: string }
  | { type: 'setFinish'; setId: string; problemId: string; holdId: string | null }
  | { type: 'setDateUp'; setId: string; date: string | null };

function mapSet(data: Data, setId: string, f: (s: ClimbingSet) => ClimbingSet): Data {
  return { ...data, sets: data.sets.map((s) => (s.id === setId ? f(s) : s)) };
}

/** Remove a hold from every problem it is in (hold belongs to at most one, but be safe). */
function detachHold(problems: Problem[], holdId: string): Problem[] {
  return problems.map((p) =>
    p.holdIds.includes(holdId) || p.startHoldIds.includes(holdId) || p.finishHoldId === holdId
      ? {
          ...p,
          holdIds: p.holdIds.filter((h) => h !== holdId),
          startHoldIds: p.startHoldIds.filter((h) => h !== holdId),
          finishHoldId: p.finishHoldId === holdId ? null : p.finishHoldId,
        }
      : p,
  );
}

interface State {
  data: Data;
  /** True once the user has changed something since the last save or discard. */
  edited: boolean;
}

export function reducer(state: State, a: Action): State {
  if (a.type === 'replace') return { data: a.data, edited: false };
  return { data: applyAction(state.data, a), edited: true };
}

function applyAction(data: Data, a: Action): Data {
  switch (a.type) {
    case 'replace':
      return a.data;
    case 'addHold':
      return mapSet(data, a.setId, (s) => ({ ...s, holds: [...s.holds, a.hold] }));
    case 'updateHold':
      return mapSet(data, a.setId, (s) => ({ ...s, holds: s.holds.map((h) => (h.id === a.id ? { ...h, ...a.patch } : h)) }));
    case 'deleteHold':
      return mapSet(data, a.setId, (s) => ({
        ...s,
        holds: s.holds.filter((h) => h.id !== a.id),
        problems: detachHold(s.problems, a.id),
      }));
    case 'addProblem':
      return mapSet(data, a.setId, (s) => ({ ...s, problems: [...s.problems, a.problem] }));
    case 'updateProblem':
      return mapSet(data, a.setId, (s) => ({ ...s, problems: s.problems.map((p) => (p.id === a.id ? { ...p, ...a.patch } : p)) }));
    case 'deleteProblem':
      return mapSet(data, a.setId, (s) => ({ ...s, problems: s.problems.filter((p) => p.id !== a.id) }));
    case 'assignHold':
      return mapSet(data, a.setId, (s) => {
        const problems = detachHold(s.problems, a.holdId);
        return {
          ...s,
          problems: a.problemId
            ? problems.map((p) => (p.id === a.problemId ? { ...p, holdIds: [...p.holdIds, a.holdId] } : p))
            : problems,
        };
      });
    case 'toggleStart':
      return mapSet(data, a.setId, (s) => ({
        ...s,
        problems: s.problems.map((p) =>
          p.id !== a.problemId
            ? p
            : {
                ...p,
                startHoldIds: p.startHoldIds.includes(a.holdId)
                  ? p.startHoldIds.filter((h) => h !== a.holdId)
                  : [...p.startHoldIds, a.holdId],
              },
        ),
      }));
    case 'setFinish':
      return mapSet(data, a.setId, (s) => ({
        ...s,
        problems: s.problems.map((p) => (p.id === a.problemId ? { ...p, finishHoldId: a.holdId } : p)),
      }));
    case 'setDateUp':
      return mapSet(data, a.setId, (s) => ({ ...s, dateUp: a.date }));
  }
}

const fileData = initial as unknown as Data;

function loadInitial(): { state: State; fromDraft: boolean } {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Data;
      // Only sets are editable in the app, so walls and faces always come from the file.
      // That way schema additions (e.g. face geometry) reach a browser holding an older draft.
      const draft: Data = { ...fileData, sets: parsed.sets };
      // A draft identical to the file is just a stale leftover from the last save.
      if (parsed.version === fileData.version && JSON.stringify(draft) !== JSON.stringify(fileData)) {
        return { state: { data: draft, edited: true }, fromDraft: true };
      }
      localStorage.removeItem(DRAFT_KEY);
    }
  } catch {
    /* ignore a broken draft */
  }
  return { state: { data: fileData, edited: false }, fromDraft: false };
}

export function useData() {
  const init = useMemo(loadInitial, []);
  const [{ data, edited: dirty }, dispatch] = useReducer(reducer, init.state);

  // Persist every change as a draft so a reload at the gym does not lose work.
  useEffect(() => {
    try {
      if (dirty) localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
      else localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* storage may be unavailable */
    }
  }, [data, dirty]);

  const discardDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    dispatch({ type: 'replace', data: fileData });
  };

  const saveToRepo = async (): Promise<string> => {
    const res = await fetch('/api/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    if (!res.ok) throw new Error(await res.text());
    localStorage.removeItem(DRAFT_KEY);
    dispatch({ type: 'replace', data });
    return 'Saved to src/data/jawa.json';
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'jawa.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return { data, dispatch, dirty, startedFromDraft: init.fromDraft, discardDraft, saveToRepo, download };
}

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 7)}`;
}

export function newProblem(setId: string, grade: Grade): Problem {
  return { id: `${setId}-${grade}-${Math.random().toString(36).slice(2, 6)}`, grade, holdIds: [], startHoldIds: [], finishHoldId: null, verified: false };
}
