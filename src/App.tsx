import { useEffect, useMemo, useState } from 'react';
import PhotoCanvas from './components/PhotoCanvas';
import HoldLayer from './components/HoldLayer';
import FaceSwitcher from './components/FaceSwitcher';
import ProblemSheet from './components/ProblemSheet';
import Editor, { type Tool } from './components/Editor';
import BlockView from './components/BlockView';
import HallMap from './components/HallMap';
import { bounds, pointInPolygon, polygonArea } from './geometry';
import { newId, useData } from './store';
import type { Hold, HoldColour, HoldType, Pt } from './types';

export default function App() {
  const { data, dispatch, dirty, startedFromDraft, discardDraft, saveToRepo, download } = useData();

  // One wall and one set for the playground.
  const wall = data.walls[0];
  const set = data.sets.find((s) => s.wallId === wall.id)!;
  const faces = useMemo(() => wall.faceIds.map((id) => data.faces.find((f) => f.id === id)!), [wall, data.faces]);

  const [faceIndex, setFaceIndex] = useState(() => {
    const n = Number(new URLSearchParams(location.search).get('face'));
    const i = faces.findIndex((f) => f.number === n);
    return i >= 0 ? i : faces.findIndex((f) => f.number === 4);
  });
  const face = faces[faceIndex];
  const photo = set.photos.find((p) => p.faceId === face.id && p.role === 'anchor')!;
  const holdsOnFace = useMemo(() => set.holds.filter((h) => h.faceId === face.id), [set.holds, face.id]);

  const [view, setView] = useState<'face' | 'block' | 'hall'>(() => {
    const v = new URLSearchParams(location.search).get('view');
    return v === 'block' || v === 'hall' ? v : 'face';
  });
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null);
  const selectedProblem = set.problems.find((p) => p.id === selectedProblemId) ?? null;

  // editor state
  const [editing, setEditing] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [drawColour, setDrawColour] = useState<HoldColour>('green');
  const [drawType, setDrawType] = useState<HoldType>('hold');
  const [draft, setDraft] = useState<Pt[]>([]);
  const [selectedHoldId, setSelectedHoldId] = useState<string | null>(null);
  const selectedHold = selectedHoldId ? holdsOnFace.find((h) => h.id === selectedHoldId) ?? null : null;

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 2500);
    return () => clearTimeout(t);
  }, [toastMsg]);

  useEffect(() => {
    const u = new URL(location.href);
    u.searchParams.set('face', String(face.number));
    if (view !== 'face') u.searchParams.set('view', view);
    else u.searchParams.delete('view');
    history.replaceState(null, '', u);
  }, [face.number, view]);

  const [switcherUses, setSwitcherUses] = useState(0);
  const goToFace = (i: number, swing = false) => {
    setFaceIndex(i);
    setSelectedHoldId(null);
    setDraft([]);
    if (swing) setSwitcherUses((n) => n + 1);
  };

  // Smallest hold under the point wins, so a hold sitting on a volume is still tappable.
  const hitHold = (p: Pt): Hold | null => {
    let best: Hold | null = null;
    let bestArea = Infinity;
    for (const h of holdsOnFace) {
      if (!pointInPolygon(p, h.outline)) continue;
      const a = polygonArea(h.outline);
      if (a < bestArea) {
        bestArea = a;
        best = h;
      }
    }
    return best;
  };

  const onTap = (p: Pt) => {
    if (editing && tool === 'draw') {
      setDraft((d) => [...d, p]);
      return;
    }
    const h = hitHold(p);
    if (editing) {
      setSelectedHoldId(h?.id ?? null);
      return;
    }
    if (!h) {
      setSelectedProblemId(null);
      return;
    }
    if (h.type === 'downclimb') {
      setToastMsg('Yellow downclimb hold');
      return;
    }
    const owner = set.problems.find((pr) => pr.holdIds.includes(h.id));
    if (owner) setSelectedProblemId(owner.id === selectedProblemId ? null : owner.id);
    else setToastMsg(h.type === 'volume' ? 'Shared volume' : 'Not assigned to a problem yet');
  };

  const selectProblem = (id: string | null) => {
    setSelectedProblemId(id);
    if (!id) return;
    const pr = set.problems.find((p) => p.id === id);
    if (!pr) return;
    // If nothing of it is on this face, jump to the face it starts on (or its first hold).
    const onThisFace = pr.holdIds.some((hid) => holdsOnFace.some((h) => h.id === hid));
    if (onThisFace) return;
    const firstId = pr.startHoldIds[0] ?? pr.holdIds[0];
    const fid = set.holds.find((h) => h.id === firstId)?.faceId;
    const i = faces.findIndex((f) => f.id === fid);
    if (i >= 0) goToFace(i);
  };

  // Zoom to the selected problem's holds on this face.
  const focus = useMemo(() => {
    if (!selectedProblem || editing) return null;
    const pts = holdsOnFace.filter((h) => selectedProblem.holdIds.includes(h.id)).flatMap((h) => h.outline);
    if (pts.length === 0) return null;
    return { key: `${selectedProblem.id}:${face.id}`, ...bounds(pts) };
  }, [selectedProblem, holdsOnFace, face.id, editing]);

  const finishDraft = () => {
    if (draft.length < 3) return;
    const hold: Hold = {
      id: newId(`f${face.number}-${drawColour}`),
      faceId: face.id,
      colour: drawColour,
      type: drawColour === 'yellow' && drawType === 'hold' ? 'downclimb' : drawType,
      outline: draft.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)] as Pt),
    };
    dispatch({ type: 'addHold', setId: set.id, hold });
    setDraft([]);
    setSelectedHoldId(hold.id);
    setTool('select');
  };

  const moveVertex = (i: number, p: Pt) => {
    if (!selectedHold) return;
    const outline = selectedHold.outline.map((q, j) => (j === i ? ([+p[0].toFixed(4), +p[1].toFixed(4)] as Pt) : q));
    dispatch({ type: 'updateHold', setId: set.id, id: selectedHold.id, patch: { outline } });
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="wall-name">
          {wall.name}
          <span className="muted small"> · {set.dateUp ? `set ${set.dateUp}` : 'set date unknown'}</span>
        </div>
        <FaceSwitcher faces={faces} index={faceIndex} onChange={(i) => goToFace(i, true)} />
        {!editing && (
          <div className="seg">
            <button type="button" className={view === 'face' ? 'active' : ''} onClick={() => setView('face')}>
              Face
            </button>
            <button type="button" className={view === 'block' ? 'active' : ''} onClick={() => setView('block')}>
              Block
            </button>
            {data.hall && (
              <button type="button" className={view === 'hall' ? 'active' : ''} onClick={() => setView('hall')}>
                Hall
              </button>
            )}
          </div>
        )}
        <button
          type="button"
          className={'pill' + (editing ? ' active' : '')}
          onClick={() => {
            setEditing(!editing);
            if (!editing) setView('face');
            setSelectedHoldId(null);
            setDraft([]);
            setSelectedProblemId(null);
          }}
        >
          {editing ? 'Done' : 'Edit'}
          {dirty && <i className="dot" />}
        </button>
      </header>

      {view === 'hall' && !editing && data.hall ? (
        <div className="canvas-wrap">
          <HallMap
            hall={data.hall}
            walls={data.walls}
            faces={data.faces}
            currentFaceId={face.id}
            onTapFace={(fid) => {
              const i = faces.findIndex((f) => f.id === fid);
              if (i >= 0) goToFace(i);
              setView('face');
            }}
          />
        </div>
      ) : view === 'block' && !editing ? (
        <div className="canvas-wrap">
          <BlockView
            faces={faces}
            photos={set.photos}
            holds={set.holds}
            problems={set.problems}
            selectedProblem={selectedProblem}
            currentFaceId={face.id}
            focusFaceKey={switcherUses}
            onTapFace={(fid) => {
              const i = faces.findIndex((f) => f.id === fid);
              if (i >= 0) goToFace(i);
            }}
            onTapHold={(h) => {
              if (h.type === 'downclimb') {
                setToastMsg('Yellow downclimb hold');
                return;
              }
              const owner = set.problems.find((pr) => pr.holdIds.includes(h.id));
              if (owner) setSelectedProblemId(owner.id === selectedProblemId ? null : owner.id);
              else setToastMsg(h.type === 'volume' ? 'Shared volume' : 'Not assigned to a problem yet');
              const i = faces.findIndex((f) => f.id === h.faceId);
              if (i >= 0) goToFace(i);
            }}
          />
          <div className="block-hud">
            <span className="hint">Drag to orbit · pinch to zoom · tap a hold or a face</span>
            <span className="grow" />
            <button type="button" className="primary" onClick={() => setView('face')}>
              Open face {face.number} ›
            </button>
          </div>
        </div>
      ) : (
        <div className="canvas-wrap">
          <PhotoCanvas
            src={photo.src}
            width={photo.width}
            height={photo.height}
            fitKey={face.id}
            focus={focus}
            onTap={onTap}
            handles={editing && tool === 'select' && selectedHold ? selectedHold.outline : undefined}
            onHandleMove={moveVertex}
          >
            {(view) => (
              <HoldLayer
                holds={holdsOnFace}
                width={photo.width}
                height={photo.height}
                problems={set.problems}
                selectedProblem={selectedProblem}
                mode={editing ? 'edit' : 'view'}
                selectedHoldId={selectedHoldId}
                draft={editing && tool === 'draw' ? draft : undefined}
                view={view}
              />
            )}
          </PhotoCanvas>

          {face.needsRetake && !editing && <div className="banner">Anchor photo for this face needs a straight-on retake.</div>}
        </div>
      )}

      <div className="panel">
        {editing ? (
          <Editor
            set={set}
            faces={faces}
            face={face}
            dispatch={dispatch}
            tool={tool}
            setTool={(t) => {
              setTool(t);
              setSelectedHoldId(null);
              setDraft([]);
            }}
            drawColour={drawColour}
            setDrawColour={setDrawColour}
            drawType={drawType}
            setDrawType={setDrawType}
            draft={draft}
            onUndoPoint={() => setDraft((d) => d.slice(0, -1))}
            onFinishDraft={finishDraft}
            onCancelDraft={() => setDraft([])}
            selectedHoldId={selectedHoldId}
            setSelectedHoldId={setSelectedHoldId}
            dirty={dirty}
            startedFromDraft={startedFromDraft}
            saveToRepo={saveToRepo}
            download={download}
            discardDraft={discardDraft}
            toast={setToastMsg}
          />
        ) : (
          <ProblemSheet
            problems={set.problems}
            holds={set.holds}
            faces={faces}
            currentFaceId={face.id}
            selectedId={selectedProblemId}
            onSelect={selectProblem}
            onJumpToFace={(fid) => goToFace(faces.findIndex((f) => f.id === fid))}
          />
        )}
      </div>

      {toastMsg && <div className="toast">{toastMsg}</div>}
      <footer className="foot muted small">Unofficial. Not affiliated with Urban Climb.</footer>
    </div>
  );
}
