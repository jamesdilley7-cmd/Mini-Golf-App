import {
  CircleObstacle,
  HoleDefinition,
  RampZone,
  RectObstacle,
  Vector2,
  WaterHazard,
} from '../../types';
import { RAMP_RISE_PER_BOOST_UNIT } from '../physics';

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

export function water(
  x: number,
  y: number,
  width: number,
  height: number,
  angle = 0
): WaterHazard {
  return { kind: 'rect', x, y, width, height, angle };
}

export function waterPond(x: number, y: number, radius: number): WaterHazard {
  return { kind: 'circle', x, y, radius };
}

export function ramp(
  x: number,
  y: number,
  width: number,
  height: number,
  boost: number,
  angle = 0,
  rise?: number
): RampZone {
  return {
    kind: 'rect',
    x,
    y,
    width,
    height,
    angle,
    boost,
    rise: rise ?? boost * RAMP_RISE_PER_BOOST_UNIT,
  };
}

export function hole(
  index: number,
  par: number,
  tee: Vector2,
  cup: Vector2,
  obstacles: HoleDefinition['obstacles'],
  cupRadius = 11,
  hazards?: { water?: WaterHazard[]; ramps?: RampZone[] }
): HoleDefinition {
  return {
    index,
    par,
    tee,
    cup,
    cupRadius,
    obstacles,
    water: hazards?.water ?? [],
    ramps: hazards?.ramps ?? [],
  };
}
