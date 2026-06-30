import * as CANNON from 'cannon-es';
import {
  COURSE_HEIGHT,
  COURSE_WIDTH,
  HoleDefinition,
  Obstacle,
  RampZone,
  Vector2,
  WaterHazard,
} from '../types';

export const BALL_RADIUS = 6;
export const WALL_THICKNESS = 12;
export const MAX_SHOT_SPEED = 420;

// Shared extruded heights for obstacle colliders/meshes — physics.ts is the
// single source of truth so GolfCourseView's meshes can never drift out of
// sync with what the ball actually collides with.
export const WALL_MESH_HEIGHT = 22;
export const ROCK_MESH_HEIGHT = 16;
// Boundary walls are real 3D colliders now (not a position clamp), so they
// need to be tall enough that a ramp-launched ball can't sail over the edge.
export const BOUNDARY_WALL_HEIGHT = 30;

/** Default elevation gain (game units) a ramp's `rise` takes per `boost`
 * unit of course data, when a course doesn't set `rise` explicitly — see
 * `ramp()` in `courses/helpers.ts`. */
export const RAMP_RISE_PER_BOOST_UNIT = 6;

const GRAVITY_Y = -980;
const GROUND_THICKNESS = 20;
const BALL_FRICTION = 0.4;
// Linear damping alone settles a ball's *position* reasonably, but cannon-es's
// sleep check requires BOTH linear and angular velocity below sleepSpeedLimit,
// and angular velocity starts much higher than linear (rolling without
// slipping means angularVelocity ≈ linearVelocity / BALL_RADIUS, so a
// full-power putt starts spinning at ~70 rad/s). Leaving angularDamping at
// cannon-es's default (0.01) meant a shot's spin took 100+ seconds to decay
// below the sleep threshold even though its linear speed settled in
// seconds — the ball never actually finished a shot. Both values tuned
// numerically so every shot (any power) settles within ~5s.
const BALL_LINEAR_DAMPING = 0.2;
const BALL_ANGULAR_DAMPING = 0.6;
const WALL_RESTITUTION = 0.72;
const OBSTACLE_RESTITUTION = 0.55;
const SLEEP_SPEED_LIMIT = 8;
const SLEEP_TIME_LIMIT = 0.15;
// A resting ball settled near the cup with leftover jitter speed under this
// still counts as "dropping in" — same role as the old 2D check, rescaled
// for the new velocity units.
const SUNK_SPEED_THRESHOLD = 80;
const GROUND_EPSILON = 1.5;

export interface CourseWorld {
  world: CANNON.World;
  ball: CANNON.Body;
}

/** 2D obstacle/hazard `angle` (degrees) rotates a rect within the original
 * (x, y) game plane the same way the old pointInRect math did; converting
 * that into a three.js/cannon-es Y-axis rotation (the ground plane is now
 * x/z) flips the sign. Shared by physics colliders and GolfCourseView's
 * matching meshes so visual and physical geometry can't drift apart. */
export function degToRotY(angleDeg?: number): number {
  return -((angleDeg ?? 0) * Math.PI) / 180;
}

function obstacleToBody(obstacle: Obstacle, material: CANNON.Material): CANNON.Body {
  const meshHeight = obstacle.style === 'rock' ? ROCK_MESH_HEIGHT : WALL_MESH_HEIGHT;
  const body = new CANNON.Body({ mass: 0, material });
  if (obstacle.kind === 'circle') {
    body.addShape(new CANNON.Cylinder(obstacle.radius, obstacle.radius, meshHeight, 16));
  } else {
    body.addShape(
      new CANNON.Box(new CANNON.Vec3(obstacle.width / 2, meshHeight / 2, obstacle.height / 2))
    );
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), degToRotY(obstacle.angle));
  }
  body.position.set(obstacle.x, meshHeight / 2, obstacle.y);
  return body;
}

/** A ramp is a ConvexPolyhedron wedge: entry edge at ground level (y=0),
 * exit edge at height `rise`.  Using a wedge (no end-cap at the entry side)
 * lets the ball roll smoothly onto the inclined surface from ground level
 * instead of bouncing off the face of a tilted box.  Yaw is applied the
 * same way as every other rotated obstacle. */
function rampToBody(ramp: RampZone, material: CANNON.Material): CANNON.Body {
  const rise = ramp.rise ?? 0;
  const W = ramp.width / 2;
  const L = ramp.height / 2;

  // Six vertices: entry edge at y=0 (+z in local), exit edge at y=rise (-z in local).
  // Face normals computed via (v[1]-v[0])×(v[2]-v[0]) — CCW from outside convention.
  const vertices = [
    new CANNON.Vec3(-W, 0,    +L), // 0 entry bottom-left
    new CANNON.Vec3(+W, 0,    +L), // 1 entry bottom-right
    new CANNON.Vec3(-W, 0,    -L), // 2 exit bottom-left
    new CANNON.Vec3(+W, 0,    -L), // 3 exit bottom-right
    new CANNON.Vec3(-W, rise, -L), // 4 exit top-left
    new CANNON.Vec3(+W, rise, -L), // 5 exit top-right
  ];
  const faces = [
    [0, 2, 3, 1], // bottom   → normal (0,-1, 0)
    [0, 1, 5, 4], // slope    → normal (0,+L,rise)/mag (upward toward entry)
    [0, 4, 2],    // left     → normal (-1, 0, 0)
    [1, 3, 5],    // right    → normal (+1, 0, 0)
    [2, 4, 5, 3], // back wall→ normal (0, 0,-1)
  ];

  const body = new CANNON.Body({ mass: 0, material });
  body.addShape(new CANNON.ConvexPolyhedron({ vertices, faces }));
  body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), degToRotY(ramp.angle));
  body.position.set(ramp.x, 0, ramp.y);
  return body;
}

function boundaryWalls(material: CANNON.Material): CANNON.Body[] {
  const t = WALL_THICKNESS;
  const h = BOUNDARY_WALL_HEIGHT;
  const make = (x: number, z: number, halfW: number, halfD: number) => {
    const body = new CANNON.Body({ mass: 0, material });
    body.addShape(new CANNON.Box(new CANNON.Vec3(halfW, h / 2, halfD)));
    body.position.set(x, h / 2, z);
    return body;
  };
  return [
    make(COURSE_WIDTH / 2, -t / 2, COURSE_WIDTH / 2 + t, t / 2), // top
    make(COURSE_WIDTH / 2, COURSE_HEIGHT + t / 2, COURSE_WIDTH / 2 + t, t / 2), // bottom
    make(-t / 2, COURSE_HEIGHT / 2, t / 2, COURSE_HEIGHT / 2 + t), // left
    make(COURSE_WIDTH + t / 2, COURSE_HEIGHT / 2, t / 2, COURSE_HEIGHT / 2 + t), // right
  ];
}

export function createCourseWorld(hole: HoleDefinition, startPosition?: Vector2): CourseWorld {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY_Y, 0), allowSleep: true });

  const ballMaterial = new CANNON.Material('ball');
  const groundMaterial = new CANNON.Material('ground');
  const wallMaterial = new CANNON.Material('wall');
  const rockMaterial = new CANNON.Material('rock');

  world.addContactMaterial(
    new CANNON.ContactMaterial(ballMaterial, groundMaterial, {
      friction: BALL_FRICTION,
      restitution: 0.05,
    })
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(ballMaterial, wallMaterial, {
      friction: 0,
      restitution: WALL_RESTITUTION,
    })
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(ballMaterial, rockMaterial, {
      friction: 0,
      restitution: OBSTACLE_RESTITUTION,
    })
  );

  const ground = new CANNON.Body({ mass: 0, material: groundMaterial });
  ground.addShape(
    new CANNON.Box(
      new CANNON.Vec3(
        COURSE_WIDTH / 2 + WALL_THICKNESS,
        GROUND_THICKNESS / 2,
        COURSE_HEIGHT / 2 + WALL_THICKNESS
      )
    )
  );
  ground.position.set(COURSE_WIDTH / 2, -GROUND_THICKNESS / 2, COURSE_HEIGHT / 2);
  world.addBody(ground);

  for (const wallBody of boundaryWalls(wallMaterial)) world.addBody(wallBody);

  for (const obstacle of hole.obstacles) {
    const material = obstacle.style === 'rock' ? rockMaterial : wallMaterial;
    world.addBody(obstacleToBody(obstacle, material));
  }

  for (const ramp of hole.ramps) {
    world.addBody(rampToBody(ramp, groundMaterial));
  }

  const start = startPosition ?? hole.tee;
  const ball = new CANNON.Body({
    mass: 1,
    material: ballMaterial,
    linearDamping: BALL_LINEAR_DAMPING,
    angularDamping: BALL_ANGULAR_DAMPING,
    allowSleep: true,
    sleepSpeedLimit: SLEEP_SPEED_LIMIT,
    sleepTimeLimit: SLEEP_TIME_LIMIT,
  });
  ball.addShape(new CANNON.Sphere(BALL_RADIUS));
  ball.position.set(start.x, BALL_RADIUS, start.y);
  world.addBody(ball);

  return { world, ball };
}

export function applyShot(ball: CANNON.Body, direction: Vector2, power: number) {
  const clampedPower = Math.max(0, Math.min(1, power));
  const speed = clampedPower * MAX_SHOT_SPEED;
  ball.wakeUp();
  ball.velocity.set(direction.x * speed, ball.velocity.y, direction.y * speed);
}

export function stepWorld(world: CANNON.World, deltaMs: number) {
  world.step(1 / 60, deltaMs / 1000, 10);
}

export function ballSpeed(ball: CANNON.Body): number {
  const v = ball.velocity;
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function isResting(ball: CANNON.Body): boolean {
  return ball.sleepState !== CANNON.Body.AWAKE;
}

export function isNearGround(ball: CANNON.Body): boolean {
  return Math.abs(ball.position.y - BALL_RADIUS) < GROUND_EPSILON;
}

export function settleBall(ball: CANNON.Body) {
  ball.velocity.set(0, 0, 0);
  ball.angularVelocity.set(0, 0, 0);
  ball.sleep();
}

export function distanceTo(a: Vector2, b: Vector2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function checkSunk(ball: CANNON.Body, hole: HoleDefinition): boolean {
  const captureRadius = hole.cupRadius * 0.85;
  const dist = distanceTo({ x: ball.position.x, y: ball.position.z }, hole.cup);
  return dist < captureRadius && isNearGround(ball) && ballSpeed(ball) < SUNK_SPEED_THRESHOLD;
}

function pointInRect(
  point: Vector2,
  rect: { x: number; y: number; width: number; height: number; angle?: number }
): boolean {
  const angle = ((rect.angle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const dx = point.x - rect.x;
  const dy = point.y - rect.y;
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  return Math.abs(localX) <= rect.width / 2 && Math.abs(localY) <= rect.height / 2;
}

function pointInCircle(point: Vector2, circle: { x: number; y: number; radius: number }): boolean {
  return distanceTo(point, circle) <= circle.radius;
}

function pointInWaterHazard(point: Vector2, water: WaterHazard): boolean {
  return water.kind === 'circle' ? pointInCircle(point, water) : pointInRect(point, water);
}

export function isInWater(position: Vector2, hole: HoleDefinition): boolean {
  return hole.water.some((w) => pointInWaterHazard(position, w));
}
