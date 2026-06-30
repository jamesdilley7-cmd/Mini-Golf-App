import Matter from 'matter-js';
import { COURSE_HEIGHT, COURSE_WIDTH, HoleDefinition, Obstacle, Vector2 } from '../types';

export const BALL_RADIUS = 6;
export const WALL_THICKNESS = 12;
export const MAX_SHOT_SPEED = 22;
export const REST_SPEED_THRESHOLD = 0.04;
const AIR_FRICTION = 0.022;
const WALL_RESTITUTION = 0.72;
const OBSTACLE_RESTITUTION = 0.55;

export interface CourseWorld {
  engine: Matter.Engine;
  ball: Matter.Body;
}

function obstacleToBody(obstacle: Obstacle): Matter.Body {
  const restitution =
    obstacle.style === 'wall' ? WALL_RESTITUTION : OBSTACLE_RESTITUTION;
  if (obstacle.kind === 'circle') {
    return Matter.Bodies.circle(obstacle.x, obstacle.y, obstacle.radius, {
      isStatic: true,
      restitution,
      friction: 0,
      label: 'obstacle',
    });
  }
  const body = Matter.Bodies.rectangle(
    obstacle.x,
    obstacle.y,
    obstacle.width,
    obstacle.height,
    {
      isStatic: true,
      restitution,
      friction: 0,
      label: 'obstacle',
    }
  );
  if (obstacle.angle) {
    Matter.Body.setAngle(body, (obstacle.angle * Math.PI) / 180);
  }
  return body;
}

function boundaryWalls(): Matter.Body[] {
  const t = WALL_THICKNESS;
  return [
    // top
    Matter.Bodies.rectangle(COURSE_WIDTH / 2, -t / 2, COURSE_WIDTH + t * 2, t, {
      isStatic: true,
      restitution: WALL_RESTITUTION,
      label: 'boundary',
    }),
    // bottom
    Matter.Bodies.rectangle(
      COURSE_WIDTH / 2,
      COURSE_HEIGHT + t / 2,
      COURSE_WIDTH + t * 2,
      t,
      { isStatic: true, restitution: WALL_RESTITUTION, label: 'boundary' }
    ),
    // left
    Matter.Bodies.rectangle(-t / 2, COURSE_HEIGHT / 2, t, COURSE_HEIGHT + t * 2, {
      isStatic: true,
      restitution: WALL_RESTITUTION,
      label: 'boundary',
    }),
    // right
    Matter.Bodies.rectangle(
      COURSE_WIDTH + t / 2,
      COURSE_HEIGHT / 2,
      t,
      COURSE_HEIGHT + t * 2,
      { isStatic: true, restitution: WALL_RESTITUTION, label: 'boundary' }
    ),
  ];
}

export function createCourseWorld(hole: HoleDefinition, startPosition?: Vector2): CourseWorld {
  const engine = Matter.Engine.create();
  engine.gravity.y = 0;
  engine.gravity.x = 0;

  const start = startPosition ?? hole.tee;
  const ball = Matter.Bodies.circle(start.x, start.y, BALL_RADIUS, {
    restitution: WALL_RESTITUTION,
    friction: 0,
    frictionAir: AIR_FRICTION,
    label: 'ball',
  });

  Matter.World.add(engine.world, [
    ...boundaryWalls(),
    ...hole.obstacles.map(obstacleToBody),
    ball,
  ]);

  return { engine, ball };
}

export function applyShot(ball: Matter.Body, direction: Vector2, power: number) {
  const clampedPower = Math.max(0, Math.min(1, power));
  const speed = clampedPower * MAX_SHOT_SPEED;
  Matter.Body.setVelocity(ball, { x: direction.x * speed, y: direction.y * speed });
}

export function stepWorld(engine: Matter.Engine, deltaMs: number) {
  Matter.Engine.update(engine, deltaMs);
}

export function ballSpeed(ball: Matter.Body): number {
  const v = ball.velocity;
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

export function isResting(ball: Matter.Body): boolean {
  return ballSpeed(ball) < REST_SPEED_THRESHOLD;
}

export function settleBall(ball: Matter.Body) {
  Matter.Body.setVelocity(ball, { x: 0, y: 0 });
}

export function distanceTo(a: Vector2, b: Vector2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function checkSunk(ball: Matter.Body, hole: HoleDefinition): boolean {
  const captureRadius = hole.cupRadius * 0.85;
  const dist = distanceTo(ball.position, hole.cup);
  return dist < captureRadius && ballSpeed(ball) < 4.2;
}

export function clampBallInBounds(ball: Matter.Body) {
  const { x, y } = ball.position;
  const clampedX = Math.max(WALL_THICKNESS, Math.min(COURSE_WIDTH - WALL_THICKNESS, x));
  const clampedY = Math.max(WALL_THICKNESS, Math.min(COURSE_HEIGHT - WALL_THICKNESS, y));
  if (clampedX !== x || clampedY !== y) {
    Matter.Body.setPosition(ball, { x: clampedX, y: clampedY });
  }
}
