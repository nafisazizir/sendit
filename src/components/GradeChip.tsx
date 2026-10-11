import { GRADE_COLOUR, GRADE_LABEL } from '../grades';
import type { HoldColour } from '../types';

interface Props {
  colour: HoldColour;
  /** Show only the swatch. */
  compact?: boolean;
  active?: boolean;
  onClick?: () => void;
  title?: string;
}

/** Colour swatch paired with a text label, so it still reads when colour alone does not. */
export default function GradeChip({ colour, compact, active, onClick, title }: Props) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={'chip' + (active ? ' active' : '') + (onClick ? ' clickable' : '')}
      onClick={onClick}
      title={title ?? GRADE_LABEL[colour]}
    >
      <i className="swatch" style={{ background: GRADE_COLOUR[colour] }} />
      {!compact && <span>{GRADE_LABEL[colour]}</span>}
    </Tag>
  );
}
