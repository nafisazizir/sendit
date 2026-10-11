// Data shapes for the playground. These mirror the SPEC.md data model and are
// the thing the playground is meant to stress-test before a database locks them in.

export type Grade = 'yellow' | 'blue' | 'purple' | 'green' | 'orange' | 'red' | 'black' | 'white';

/** Hold colour: a grade colour, or grey/other for volumes that carry no grade. */
export type HoldColour = Grade | 'grey' | 'other';

/** hold: part of a problem. volume: shared by any problem. downclimb: yellow jugs, not a problem. */
export type HoldType = 'hold' | 'volume' | 'downclimb';

export type Angle = 'slab' | 'vertical' | 'overhang' | 'arete';

/** Point in anchor-photo space, normalised 0..1 in both axes. */
export type Pt = [number, number];

export interface Wall {
  id: string;
  name: string;
  /** Faces in walking order. */
  faceIds: string[];
}

export interface Face {
  id: string;
  wallId: string;
  number: number;
  angle: Angle;
  note?: string;
  needsRetake?: boolean;
  /** Rough 3D placement for the block view. Estimated until measured at the gym. */
  geometry?: FaceGeometry;
}

export interface FaceGeometry {
  /** Floor footprint of this face in metres, walking order: from -> to. Faces chain into a closed loop. */
  from: [number, number];
  to: [number, number];
  height: number;
  /** Degrees. Positive leans out over the mat (overhang), negative leans back (slab). */
  lean: number;
  /** Region of the anchor photo that covers exactly this face, normalised [x, y, w, h]. Default whole photo. */
  crop?: [number, number, number, number];
  /** Better than crop: the four photo points (normalised) at the face's top-left, top-right, bottom-right, bottom-left corners. */
  quad?: [Pt, Pt, Pt, Pt];
  /** Where the numbers came from. */
  source?: 'estimate' | 'sfm' | 'measured';
}

export interface FacePhoto {
  id: string;
  faceId: string;
  role: 'anchor' | 'angle' | 'closeup';
  src: string;
  thumb: string;
  width: number;
  height: number;
  shotOn: string;
}

export interface Hold {
  id: string;
  faceId: string;
  colour: HoldColour;
  type: HoldType;
  /** Polygon outline on that face's anchor photo. */
  outline: Pt[];
  note?: string;
}

export interface Problem {
  id: string;
  grade: Grade;
  /** Every hold in the problem, on any face of the wall. */
  holdIds: string[];
  startHoldIds: string[];
  finishHoldId: string | null;
  name?: string;
  note?: string;
  /** False until checked against the wall. */
  verified: boolean;
}

export interface ClimbingSet {
  id: string;
  wallId: string;
  dateUp: string | null;
  dateDown: string | null;
  photographedOn: string;
  photos: FacePhoto[];
  holds: Hold[];
  problems: Problem[];
}

export interface Data {
  version: number;
  grades: Grade[];
  walls: Wall[];
  faces: Face[];
  sets: ClimbingSet[];
}
