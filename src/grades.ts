import type { Grade, HoldColour } from './types';

/** Easiest to hardest. */
export const GRADES: Grade[] = ['yellow', 'blue', 'purple', 'green', 'orange', 'red', 'black', 'white'];

/** The only place these colours are defined. The UI around them stays monochrome. */
export const GRADE_COLOUR: Record<HoldColour, string> = {
  yellow: '#f2d51e',
  blue: '#3b82f6',
  purple: '#a855f7',
  green: '#22c55e',
  orange: '#fb923c',
  red: '#ef4444',
  black: '#1a1a1a',
  white: '#f5f5f5',
  grey: '#8a8a8a',
  other: '#c08457',
};

export const GRADE_LABEL: Record<HoldColour, string> = {
  yellow: 'Yellow',
  blue: 'Blue',
  purple: 'Purple',
  green: 'Green',
  orange: 'Orange',
  red: 'Red',
  black: 'Black',
  white: 'White',
  grey: 'Grey',
  other: 'Other',
};

export const HOLD_COLOURS: HoldColour[] = [...GRADES, 'grey', 'other'];

export function isGrade(c: string): c is Grade {
  return (GRADES as string[]).includes(c);
}
