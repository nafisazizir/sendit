import type { Face } from '../types';

interface Props {
  faces: Face[]; // walking order
  index: number;
  onChange: (index: number) => void;
}

/** Move around a wall face by face in walking order. Wraps at both ends because the wall is a loop. */
export default function FaceSwitcher({ faces, index, onChange }: Props) {
  const face = faces[index];
  const n = faces.length;
  return (
    <div className="face-switcher">
      <button type="button" className="icon" onClick={() => onChange((index - 1 + n) % n)} aria-label="Previous face">
        ‹
      </button>
      <div className="face-label">
        <strong>Face {face.number}</strong>
        <span className="muted">
          {' '}
          / {n} · {face.angle}
          {face.needsRetake ? ' · retake' : ''}
        </span>
      </div>
      <button type="button" className="icon" onClick={() => onChange((index + 1) % n)} aria-label="Next face">
        ›
      </button>
    </div>
  );
}
