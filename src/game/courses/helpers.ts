import { CircleObstacle, HoleDefinition, RectObstacle, Vector2 } from '../../types';

export function wall(
  x: number,
  y: number,
  width: number,
  height: number,
  angle = 0
): RectObstacle {
  return { kind: 'rect', x, y, width, height, angle, style: 'wall' };
}

export function rock(x: number, y: number, radius: number): CircleObstacle {
  return { kind: 'circle', x, y, radius, style: 'rock' };
}

export function rockBlock(
  x: number,
  y: number,
  width: number,
  height: number,
  angle = 0
): RectObstacle {
  return { kind: 'rect', x, y, width, height, angle, style: 'rock' };
}

export function hole(
  index: number,
  par: number,
  tee: Vector2,
  cup: Vector2,
  obstacles: HoleDefinition['obstacles'],
  cupRadius = 11
): HoleDefinition {
  return { index, par, tee, cup, cupRadius, obstacles };
}
