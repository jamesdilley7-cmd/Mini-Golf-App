export interface Vector2 {
  x: number;
  y: number;
}

export type ObstacleStyle = 'wall' | 'rock';

export interface RectObstacle {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  style?: ObstacleStyle;
}

export interface CircleObstacle {
  kind: 'circle';
  x: number;
  y: number;
  radius: number;
  style?: ObstacleStyle;
}

export type Obstacle = RectObstacle | CircleObstacle;

/** Non-solid hazard zone: the ball rolls over it freely, but if it comes to
 * rest inside, the shot is penalized and the ball is replaced at its
 * pre-shot position. */
export interface RectWaterHazard {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
}

export interface CircleWaterHazard {
  kind: 'circle';
  x: number;
  y: number;
  radius: number;
}

export type WaterHazard = RectWaterHazard | CircleWaterHazard;

/** Non-solid boost zone: the first time a shot's ball crosses it, its
 * current speed is increased (direction unchanged) by `boost`. */
export interface RampZone {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  boost: number;
}

export interface HoleDefinition {
  index: number;
  par: number;
  tee: Vector2;
  cup: Vector2;
  cupRadius: number;
  obstacles: Obstacle[];
  water: WaterHazard[];
  ramps: RampZone[];
}

export interface Course {
  id: string;
  name: string;
  description: string;
  accentColor: string;
  holes: HoleDefinition[];
}

export const COURSE_WIDTH = 320;
export const COURSE_HEIGHT = 560;

export interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  moving: boolean;
  /** Ball literally dropped into the cup (used for sink visuals/animation). */
  sunk: boolean;
  /** Player is done with this hole, either by sinking or hitting the stroke cap. */
  retired: boolean;
  strokes: number;
  updatedAt: number;
}

export interface RoomPlayer {
  name: string;
  color: string;
  joinedAt: number;
  connected: boolean;
  host: boolean;
}

export type RoomStatus = 'lobby' | 'playing' | 'finished';

export interface RoomState {
  code: string;
  hostId: string;
  courseId: string;
  status: RoomStatus;
  createdAt: number;
  holeIndex: number;
  order: string[];
  activePlayerId: string | null;
  players: Record<string, RoomPlayer>;
  balls: Record<string, BallState>;
  scores: Record<string, Record<number, number>>;
}

export const PLAYER_COLORS = [
  '#FF5A5F',
  '#3D8BFD',
  '#FFC93C',
  '#3DDC97',
  '#B968C7',
  '#FF8C42',
  '#39A0ED',
  '#E15554',
];

export const MAX_STROKES_PER_HOLE = 10;
