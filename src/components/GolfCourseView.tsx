import { Canvas, useFrame, useThree } from '@react-three/fiber/native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, StyleSheet, View } from 'react-native';
import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  Object3D,
  Quaternion as ThreeQuaternion,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3 as ThreeVector3,
} from 'three';
import {
  applyShot,
  BALL_RADIUS,
  BOUNDARY_WALL_HEIGHT,
  checkSunk,
  createCourseWorld,
  CourseWorld,
  degToRotY,
  isInWater,
  isResting,
  ROCK_MESH_HEIGHT,
  settleBall,
  stepWorld,
  WALL_MESH_HEIGHT,
  WALL_THICKNESS,
} from '../game/physics';
import { BallState, COURSE_HEIGHT, COURSE_WIDTH, HoleDefinition, Vector2 } from '../types';

const MAX_DRAG_WORLD_UNITS = 110;
const AIM_INDICATOR_LENGTH = 90;
const BROADCAST_INTERVAL_MS = 70;
const SINK_DROP_DEPTH = -3;
const SINK_DROP_DURATION_MS = 220;
// Radians of camera yaw per pixel of a horizontal rotate drag, and radians of
// pitch per pixel of a vertical rotate drag.
const ROTATE_SENSITIVITY = 0.006;
const PITCH_SENSITIVITY = 0.005;

interface TouchSnapshot {
  cx: number;
  cy: number;
  /** Finger spread for pinch; 0 when fewer than two touches are down. */
  spread: number;
}

/** Reduce the active touches to a centroid (for orbit/tilt) and a spread (for
 * pinch-zoom), so one code path handles one- and two-finger camera drags. */
function touchSnapshot(
  touches: { pageX: number; pageY: number }[]
): TouchSnapshot {
  if (touches.length >= 2) {
    const a = touches[0];
    const b = touches[1];
    return {
      cx: (a.pageX + b.pageX) / 2,
      cy: (a.pageY + b.pageY) / 2,
      spread: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY),
    };
  }
  const t = touches[0];
  return { cx: t ? t.pageX : 0, cy: t ? t.pageY : 0, spread: 0 };
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

interface BallPosition {
  x: number;
  y: number;
  z: number;
}

interface OtherBall {
  id: string;
  color: string;
  ball: BallState;
}

interface ShotResult {
  x: number;
  y: number;
  z: number;
  strokes: number;
  sunk: boolean;
}

interface Props {
  hole: HoleDefinition;
  accentColor: string;
  myColor: string;
  myBall: BallState;
  otherBalls: OtherBall[];
  isMyTurn: boolean;
  onBallMoving: (partial: Pick<BallState, 'x' | 'y' | 'z' | 'vx' | 'vy' | 'vz' | 'moving'>) => void;
  onShotResolved: (result: ShotResult) => void;
}

function normalize(v: Vector2): Vector2 {
  const mag = Math.hypot(v.x, v.y);
  if (mag < 1e-6) return { x: 0, y: 0 };
  return { x: v.x / mag, y: v.y / mag };
}

/** Turn a screen-space pull-back drag into a world-space shot direction,
 * relative to the current camera azimuth so "pull back" always launches the
 * ball away from the camera regardless of how the view is rotated. Matches the
 * FollowCamera ground axes (right = (cos az, sin az), back = (−sin az, cos az)).
 * At az = 0 this reduces to the original screen-aligned mapping. */
function aimDirFromDrag(dx: number, dy: number, az: number): Vector2 {
  const cos = Math.cos(az);
  const sin = Math.sin(az);
  const worldX = dx * cos - dy * sin;
  const worldZ = dx * sin + dy * cos;
  return normalize({ x: -worldX, y: -worldZ });
}

function rampYawQuaternion(angleDeg: number | undefined): ThreeQuaternion {
  return new ThreeQuaternion().setFromAxisAngle(new ThreeVector3(0, 1, 0), degToRotY(angleDeg));
}

/** Builds the exact same wedge shape as physics.ts's rampToBody
 * (ConvexPolyhedron) — entry edge at local y=0, exit edge at y=rise — so the
 * mesh the player sees is the surface the ball actually rolls on, not a
 * flat plane or a tilted box with a misleading end-cap. Flat-shaded (no
 * shared vertices between faces) since this is the physics-accuracy pass;
 * smoothing/materials are deferred to the visual-polish pass. */
function buildRampWedgeGeometry(width: number, footLen: number, rise: number): BufferGeometry {
  const W = width / 2;
  const L = footLen / 2;
  const v0: [number, number, number] = [-W, 0, L];
  const v1: [number, number, number] = [W, 0, L];
  const v2: [number, number, number] = [-W, 0, -L];
  const v3: [number, number, number] = [W, 0, -L];
  const v4: [number, number, number] = [-W, rise, -L];
  const v5: [number, number, number] = [W, rise, -L];

  const triangles = [
    v0, v2, v3, v0, v3, v1, // bottom
    v0, v1, v5, v0, v5, v4, // slope (the surface the ball rolls on)
    v0, v4, v2, // left wall
    v1, v3, v5, // right wall
    v2, v4, v5, v2, v5, v3, // back (high/exit) wall
  ];

  const positions = new Float32Array(triangles.length * 3);
  triangles.forEach(([x, y, z], i) => {
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// 3D scene tuning. Physics now genuinely simulates in 3D (src/game/physics.ts,
// cannon-es) on the same (x, z) = (game x, game y) ground mapping, with real
// height on the 3D y axis. WALL_MESH_HEIGHT/ROCK_MESH_HEIGHT/
// BOUNDARY_WALL_HEIGHT/degToRotY are imported from physics.ts so these
// meshes can never drift out of sync with what the ball physically collides
// with — see the README's "real 3D physics" note.
const FLAGPOLE_HEIGHT = 38;
const WATER_Y = 0.6;

// Key "sun" light, positioned high and off to one corner of the course so it
// casts long, readable shadows across the play surface. The shadow camera is
// an orthographic frustum sized to comfortably cover the whole course from
// the light's point of view (course is COURSE_WIDTH x COURSE_HEIGHT, centred
// at its midpoint, which is where the light is aimed).
const SUN_POSITION: [number, number, number] = [
  COURSE_WIDTH / 2 - 150,
  380,
  COURSE_HEIGHT / 2 - 280,
];

// ---------------------------------------------------------------------------
// Procedural textures. Expo Go can't bundle image assets easily and native RN
// has no <canvas>, so all "art" is generated numerically into DataTextures at
// runtime — cross-platform (native + web) and asset-free.
// ---------------------------------------------------------------------------

function fract(n: number) {
  return n - Math.floor(n);
}
// Cheap deterministic value hash in [0,1).
function hash2(x: number, y: number) {
  return fract(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453);
}
function clampByte(v: number) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Grassy turf texture: a base green modulated by fine per-texel noise plus
 * broad "mowing stripes" (alternating light/dark bands down the fairway) that
 * read instantly as a manicured golf green. Mapped 1:1 to the course (no
 * tiling) so the stripes span the whole hole and there are no seams. */
function makeGrassTexture(
  width: number,
  height: number,
  base: [number, number, number],
  stripes: number
): DataTexture {
  const data = new Uint8Array(width * height * 4);
  for (let j = 0; j < height; j++) {
    const v = j / height;
    const band = Math.floor(v * stripes) % 2 === 0 ? 1.06 : 0.92;
    for (let i = 0; i < width; i++) {
      const speck = 0.86 + hash2(i, j) * 0.28;
      const bladeRnd = hash2(i * 3.1 + 7.0, j * 1.7 + 2.0);
      const blade = bladeRnd > 0.975 ? 1.3 : bladeRnd < 0.03 ? 0.78 : 1.0;
      const m = band * speck * blade;
      const idx = (j * width + i) * 4;
      data[idx] = clampByte(base[0] * m);
      data[idx + 1] = clampByte(base[1] * m);
      data[idx + 2] = clampByte(base[2] * m);
      data[idx + 3] = 255;
    }
  }
  const tex = new DataTexture(data, width, height, RGBAFormat);
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Darker, tiled grass for the wide "rough" that surrounds the course so the
 * play area sits in an endless field rather than floating in space. */
function makeRoughTexture(): DataTexture {
  const w = 64;
  const h = 64;
  const base: [number, number, number] = [34, 78, 40];
  const data = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const n = hash2(i, j);
      const m = 0.82 + n * 0.36;
      const idx = (j * w + i) * 4;
      data[idx] = clampByte(base[0] * m);
      data[idx + 1] = clampByte(base[1] * m);
      data[idx + 2] = clampByte(base[2] * m);
      data[idx + 3] = 255;
    }
  }
  const tex = new DataTexture(data, w, h, RGBAFormat);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(34, 40);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Vertical sky gradient (deep blue at top → hazy pale at the horizon) used as
 * the scene background; the horizon colour matches the fog so distant rough
 * fades seamlessly into the sky. */
const HORIZON_COLOR: [number, number, number] = [212, 233, 226];
function makeSkyTexture(): DataTexture {
  const h = 128;
  const top: [number, number, number] = [104, 176, 232];
  const data = new Uint8Array(1 * h * 4);
  for (let j = 0; j < h; j++) {
    // texture row 0 is bottom of the screen → horizon; top row → sky.
    const t = j / (h - 1);
    const idx = j * 4;
    data[idx] = clampByte(HORIZON_COLOR[0] + (top[0] - HORIZON_COLOR[0]) * t);
    data[idx + 1] = clampByte(HORIZON_COLOR[1] + (top[1] - HORIZON_COLOR[1]) * t);
    data[idx + 2] = clampByte(HORIZON_COLOR[2] + (top[2] - HORIZON_COLOR[2]) * t);
    data[idx + 3] = 255;
  }
  const tex = new DataTexture(data, 1, h, RGBAFormat);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
const FOG_COLOR = `rgb(${HORIZON_COLOR[0]}, ${HORIZON_COLOR[1]}, ${HORIZON_COLOR[2]})`;

function SkyBackground() {
  const { scene } = useThree();
  const tex = useMemo(() => makeSkyTexture(), []);
  useEffect(() => {
    scene.background = tex;
    // Intentionally not restoring a previous background on cleanup: the scene
    // is being torn down with the Canvas anyway, and touching it during
    // unmount is an unnecessary side-effect.
  }, [scene, tex]);
  return null;
}

const WATER_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const WATER_FRAG = `
  precision mediump float;
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p); vec2 f = fract(p);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }
  void main(){
    vec2 uv = vUv;
    float w1 = sin((uv.x * 11.0 + uv.y * 5.0) + uTime * 1.6);
    float w2 = sin((uv.x * 7.0 - uv.y * 13.0) - uTime * 1.15);
    float ripple = 0.5 + 0.25 * (w1 + w2);
    float n = noise(uv * 9.0 + vec2(uTime * 0.18, uTime * 0.12));
    vec3 col = mix(uDeep, uShallow, clamp(ripple * 0.6 + n * 0.45, 0.0, 1.0));
    float hi = smoothstep(0.9, 1.0, ripple * 0.5 + n * 0.5);
    col += hi * 0.35;
    gl_FragColor = vec4(col, 0.88);
  }
`;

/** Animated stylised water. A ShaderMaterial with two crossing sine wavelets
 * plus value noise, advanced by a uTime uniform every frame — cheap, needs no
 * reflection pass, and reads clearly as rippling water. */
function WaterSurface({
  position,
  rotation,
  children,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  children: React.ReactNode;
}) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: WATER_VERT,
        fragmentShader: WATER_FRAG,
        transparent: true,
        side: DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uDeep: { value: new ThreeVector3(0.05, 0.34, 0.6) },
          uShallow: { value: new ThreeVector3(0.28, 0.7, 0.85) },
        },
      }),
    []
  );
  useFrame((_, delta) => {
    material.uniforms.uTime.value += delta;
  });
  return (
    <mesh position={position} rotation={rotation} material={material}>
      {children}
    </mesh>
  );
}

const CAM_LOOK_HEIGHT = 10;
const CAM_FOCUS_LERP = 0.16;
// Orbit distance (zoom) and pitch (angle above the ground). Defaults roughly
// match the previous fixed framing (~248 horizontal, ~187 up).
const CAM_DISTANCE_DEFAULT = 305;
const CAM_DISTANCE_MIN = 150;
const CAM_DISTANCE_MAX = 540;
const CAM_PITCH_DEFAULT = 0.4; // looks toward the horizon so the sky stays in frame
const CAM_PITCH_MIN = 0.12; // near ground level
const CAM_PITCH_MAX = 1.4; // near top-down

/** Chase camera. Every frame it eases a smoothed focus point toward the live
 * ball position (`focusRef`) and orbits the camera around it at the current
 * azimuth / pitch / distance (all gesture-driven refs), always looking at the
 * ball — so the view follows the ball as it rolls and the player can swing the
 * camera around it, tilt it up/down, and pinch to zoom. Ground axes are
 * (x, z) = (game x, game y); azimuth 0 places the camera on the +z (tee) side
 * looking toward −z. */
function FollowCamera({
  focusRef,
  azRef,
  pitchRef,
  distanceRef,
}: {
  focusRef: React.MutableRefObject<Vector2>;
  azRef: React.MutableRefObject<number>;
  pitchRef: React.MutableRefObject<number>;
  distanceRef: React.MutableRefObject<number>;
}) {
  const { camera } = useThree();
  const smooth = useRef<Vector2 | null>(null);
  useFrame(() => {
    const f = focusRef.current;
    if (!smooth.current) smooth.current = { x: f.x, y: f.y };
    smooth.current.x += (f.x - smooth.current.x) * CAM_FOCUS_LERP;
    smooth.current.y += (f.y - smooth.current.y) * CAM_FOCUS_LERP;
    const az = azRef.current;
    const pitch = pitchRef.current;
    const dist = distanceRef.current;
    const horizontal = Math.cos(pitch) * dist;
    const height = Math.sin(pitch) * dist;
    const backX = -Math.sin(az);
    const backZ = Math.cos(az);
    camera.position.set(
      smooth.current.x + backX * horizontal,
      CAM_LOOK_HEIGHT + height,
      smooth.current.y + backZ * horizontal
    );
    camera.lookAt(smooth.current.x, CAM_LOOK_HEIGHT, smooth.current.y);
  });
  return null;
}

/** Azimuth (radians) that orients the camera to look from behind the tee
 * straight toward the cup — the natural starting view for each hole. */
function defaultAzimuth(tee: Vector2, cup: Vector2): number {
  const fx = cup.x - tee.x;
  const fy = cup.y - tee.y;
  if (Math.abs(fx) < 1e-6 && Math.abs(fy) < 1e-6) return 0;
  // forward = (sin az, -cos az) should match normalize(cup - tee).
  return Math.atan2(fx, -fy);
}

/** Directional "sun" that casts shadows. Lives in its own component so it can
 * point its shadow-casting target at the centre of the course via a ref once
 * mounted (three.js directional lights shadow toward their `target`, which
 * defaults to the world origin — wrong for our off-origin course). */
function ShadowLight() {
  const lightRef = useRef<DirectionalLight>(null);
  const targetRef = useRef<Object3D>(null);
  useEffect(() => {
    if (lightRef.current && targetRef.current) {
      lightRef.current.target = targetRef.current;
      lightRef.current.target.updateMatrixWorld();
    }
  }, []);
  return (
    <>
      <directionalLight
        ref={lightRef}
        castShadow
        position={SUN_POSITION}
        intensity={1.15}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={1400}
        shadow-camera-left={-460}
        shadow-camera-right={460}
        shadow-camera-top={460}
        shadow-camera-bottom={-460}
        shadow-bias={-0.0005}
      />
      <object3D ref={targetRef} position={[COURSE_WIDTH / 2, 0, COURSE_HEIGHT / 2]} />
    </>
  );
}

/** A thin bar from `ballX/Z + dir*from` to `ballX/Z + dir*to`, used for the
 * pull-back and aim segments of the shot indicator. */
function AimBar({
  ballX,
  ballZ,
  dirX,
  dirZ,
  from,
  to,
  color,
  opacity = 1,
}: {
  ballX: number;
  ballZ: number;
  dirX: number;
  dirZ: number;
  from: number;
  to: number;
  color: string;
  opacity?: number;
}) {
  const length = to - from;
  if (length <= 0.5) return null;
  const mid = from + length / 2;
  const midX = ballX + dirX * mid;
  const midZ = ballZ + dirZ * mid;
  const rotY = Math.atan2(-dirZ, dirX);
  return (
    <mesh position={[midX, 2, midZ]} rotation={[0, rotY, 0]}>
      <boxGeometry args={[length, 1.2, 1.6]} />
      <meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  );
}

export default function GolfCourseView({
  hole,
  accentColor,
  myColor,
  myBall,
  otherBalls,
  isMyTurn,
  onBallMoving,
  onShotResolved,
}: Props) {
  const worldRef = useRef<CourseWorld | null>(null);
  const strokesRef = useRef(myBall.strokes);
  const movingRef = useRef(false);
  const lastFrameRef = useRef<number | null>(null);
  const lastBroadcastRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const scaleRef = useRef(1);
  const shotStartPosRef = useRef<Vector2>({ x: myBall.x, y: myBall.y });

  // Camera state lives in refs (not React state) so the per-frame FollowCamera
  // can read them without re-rendering: `azRef` is the view azimuth the rotate
  // gesture drives, `focusRef` is the ground point the camera chases (the live
  // ball).
  const azRef = useRef(defaultAzimuth(hole.tee, hole.cup));
  const pitchRef = useRef(CAM_PITCH_DEFAULT);
  const distanceRef = useRef(CAM_DISTANCE_DEFAULT);
  const focusRef = useRef<Vector2>({ x: myBall.x, y: myBall.y });

  const [localBallPos, setLocalBallPos] = useState<BallPosition>({
    x: myBall.x,
    y: myBall.y,
    z: myBall.z,
  });
  const [drag, setDrag] = useState<{ aimDir: Vector2; power: number } | null>(null);
  const [canShoot, setCanShoot] = useState(true);

  // The PanResponder is created once (see below) but its callbacks must read
  // the *latest* turn/shoot state and call the latest takeShot, so we mirror
  // them into refs that we keep fresh on every render.
  const isMyTurnRef = useRef(isMyTurn);
  isMyTurnRef.current = isMyTurn;
  const canShootRef = useRef(canShoot);
  canShootRef.current = canShoot;
  const takeShotRef = useRef<(aimDir: Vector2, power: number) => void>(() => {});
  // Per-gesture state for the shot/rotate PanResponder below.
  const gestureModeRef = useRef<'none' | 'aim' | 'rotate'>('none');
  const lastTouchRef = useRef<TouchSnapshot | null>(null);

  // (Re)initialize the local physics world whenever it becomes this player's
  // turn, the hole changes, or a shot of theirs resolves (myBall.strokes ticks
  // up) — that last case covers a player keeping the turn shot-to-shot, e.g.
  // solo testing or being the last non-retired player on a hole, where
  // isMyTurn never flips false/true to retrigger this otherwise.
  useEffect(() => {
    if (!isMyTurn) {
      worldRef.current = null;
      return;
    }
    const world = createCourseWorld(hole, { x: myBall.x, y: myBall.y });
    worldRef.current = world;
    strokesRef.current = myBall.strokes;
    movingRef.current = false;
    shotStartPosRef.current = { x: myBall.x, y: myBall.y };
    setLocalBallPos({ x: myBall.x, y: myBall.y, z: myBall.z });
    setCanShoot(true);
    return () => {
      worldRef.current = null;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurn, hole.index, myBall.strokes]);

  // Reset the camera to the natural "behind the tee, facing the cup" angle
  // whenever the hole changes (the player can then rotate freely from there).
  useEffect(() => {
    azRef.current = defaultAzimuth(hole.tee, hole.cup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hole.index]);

  // Keep the camera's chase target on the live ball: the locally simulated
  // position while it's our shot, otherwise our last resting position.
  useEffect(() => {
    focusRef.current = isMyTurn
      ? { x: localBallPos.x, y: localBallPos.y }
      : { x: myBall.x, y: myBall.y };
  }, [localBallPos, isMyTurn, myBall.x, myBall.y]);

  // Cup physics stays a heuristic trigger (not real pit geometry): once
  // checkSunk fires, physics simulation for this shot is done, and we ease
  // the rendered ball height down a little so it visibly drops into the cup
  // instead of teleporting — a small, necessary consequence of the ball
  // having real height now.
  function animateSink() {
    const strokesAtSink = strokesRef.current;
    let animStart: number | null = null;
    function tick(timestamp: number) {
      if (animStart === null) animStart = timestamp;
      const t = Math.min(1, (timestamp - animStart) / SINK_DROP_DURATION_MS);
      setLocalBallPos({
        x: hole.cup.x,
        y: hole.cup.y,
        z: BALL_RADIUS + (SINK_DROP_DEPTH - BALL_RADIUS) * t,
      });
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        onShotResolved({
          x: hole.cup.x,
          y: hole.cup.y,
          z: SINK_DROP_DEPTH,
          strokes: strokesAtSink,
          sunk: true,
        });
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  function stepLoop(timestamp: number) {
    const world = worldRef.current;
    if (!world) return;
    if (lastFrameRef.current === null) lastFrameRef.current = timestamp;
    const delta = Math.min(32, timestamp - lastFrameRef.current);
    lastFrameRef.current = timestamp;

    stepWorld(world.world, delta);

    if (checkSunk(world.ball, hole)) {
      settleBall(world.ball);
      movingRef.current = false;
      lastFrameRef.current = null;
      animateSink();
      return;
    }

    if (isResting(world.ball)) {
      settleBall(world.ball);
      movingRef.current = false;
      lastFrameRef.current = null;

      const groundPos: Vector2 = { x: world.ball.position.x, y: world.ball.position.z };
      if (isInWater(groundPos, hole)) {
        // Splashed: penalty stroke, retry from where this shot started.
        strokesRef.current += 1;
        const dropPos = shotStartPosRef.current;
        world.ball.position.set(dropPos.x, BALL_RADIUS, dropPos.y);
        world.ball.velocity.set(0, 0, 0);
        setLocalBallPos({ x: dropPos.x, y: dropPos.y, z: BALL_RADIUS });
        onShotResolved({
          x: dropPos.x,
          y: dropPos.y,
          z: BALL_RADIUS,
          strokes: strokesRef.current,
          sunk: false,
        });
        return;
      }

      const pos = { x: world.ball.position.x, y: world.ball.position.z, z: world.ball.position.y };
      setLocalBallPos(pos);
      onShotResolved({ x: pos.x, y: pos.y, z: pos.z, strokes: strokesRef.current, sunk: false });
      return;
    }

    setLocalBallPos({
      x: world.ball.position.x,
      y: world.ball.position.z,
      z: world.ball.position.y,
    });

    const now = Date.now();
    if (now - lastBroadcastRef.current > BROADCAST_INTERVAL_MS) {
      lastBroadcastRef.current = now;
      onBallMoving({
        x: world.ball.position.x,
        y: world.ball.position.z,
        z: world.ball.position.y,
        vx: world.ball.velocity.x,
        vy: world.ball.velocity.z,
        vz: world.ball.velocity.y,
        moving: true,
      });
    }

    rafRef.current = requestAnimationFrame(stepLoop);
  }

  function takeShot(aimDir: Vector2, power: number) {
    const world = worldRef.current;
    if (!world || movingRef.current) return;
    shotStartPosRef.current = { x: world.ball.position.x, y: world.ball.position.z };
    strokesRef.current += 1;
    setCanShoot(false);
    applyShot(world.ball, aimDir, power);
    movingRef.current = true;
    lastFrameRef.current = null;
    rafRef.current = requestAnimationFrame(stepLoop);
  }
  takeShotRef.current = takeShot;

  // Shot + camera input runs through React Native's PanResponder on a
  // transparent overlay laid over the GL <Canvas> (see render below), NOT
  // through react-native-gesture-handler wrapping the canvas. On a real device
  // the expo-gl surface swallows touches before gesture-handler sees them, so
  // the gesture never fired — PanResponder works at the RN view layer and
  // reliably receives touches on both native and web.
  //
  // Two gestures share the surface, disambiguated per touch:
  //   • one finger, on your turn → aim & putt (pull back, release)
  //   • two fingers (or one finger when it isn't your shot) → move the camera:
  //       horizontal drag = orbit, vertical drag = tilt, pinch = zoom
  // The mode is decided on the first move of each gesture and held until release.
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Claim every touch so the camera can be moved at any time, not just
        // on your turn.
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          gestureModeRef.current = 'none';
          lastTouchRef.current = null;
        },
        onPanResponderMove: (evt, gesture) => {
          // `touches` is populated on native but can be absent for
          // mouse-driven events on web — guard so the mode still resolves.
          const touches = evt.nativeEvent.touches ?? [];
          if (gestureModeRef.current === 'none') {
            const twoFingers = touches.length >= 2;
            const canAim = isMyTurnRef.current && canShootRef.current;
            gestureModeRef.current = !twoFingers && canAim ? 'aim' : 'rotate';
            lastTouchRef.current = null;
          }
          if (gestureModeRef.current === 'rotate') {
            // Drive orbit/tilt/zoom incrementally from the touch centroid and
            // spread, so one- and two-finger drags (and pinches) all work and
            // transition smoothly if a second finger joins mid-gesture.
            const snap = touchSnapshot(touches);
            const last = lastTouchRef.current;
            if (last) {
              azRef.current -= (snap.cx - last.cx) * ROTATE_SENSITIVITY;
              pitchRef.current = clamp(
                pitchRef.current - (snap.cy - last.cy) * PITCH_SENSITIVITY,
                CAM_PITCH_MIN,
                CAM_PITCH_MAX
              );
              if (snap.spread > 0 && last.spread > 0) {
                distanceRef.current = clamp(
                  distanceRef.current * (last.spread / snap.spread),
                  CAM_DISTANCE_MIN,
                  CAM_DISTANCE_MAX
                );
              }
            }
            lastTouchRef.current = snap;
            return;
          }
          const s = scaleRef.current || 1;
          const power = Math.max(
            0,
            Math.min(1, Math.hypot(gesture.dx / s, gesture.dy / s) / MAX_DRAG_WORLD_UNITS)
          );
          setDrag({ aimDir: aimDirFromDrag(gesture.dx, gesture.dy, azRef.current), power });
        },
        onPanResponderRelease: (_evt, gesture) => {
          const mode = gestureModeRef.current;
          gestureModeRef.current = 'none';
          lastTouchRef.current = null;
          if (mode !== 'aim') return;
          const s = scaleRef.current || 1;
          const mag = Math.hypot(gesture.dx / s, gesture.dy / s);
          setDrag(null);
          if (mag < 8) return; // too small a flick, ignore
          const power = Math.max(0, Math.min(1, mag / MAX_DRAG_WORLD_UNITS));
          takeShotRef.current(aimDirFromDrag(gesture.dx, gesture.dy, azRef.current), power);
        },
        onPanResponderTerminate: () => {
          gestureModeRef.current = 'none';
          lastTouchRef.current = null;
          setDrag(null);
        },
      }),
    []
  );

  function handleLayout(e: LayoutChangeEvent) {
    const { width } = e.nativeEvent.layout;
    scaleRef.current = width / COURSE_WIDTH;
  }

  const myRenderPos: BallPosition = isMyTurn
    ? localBallPos
    : { x: myBall.x, y: myBall.y, z: myBall.z };
  const showMyBall = isMyTurn || !myBall.sunk;

  const rampGeometries = useMemo(
    () => hole.ramps.map((r) => buildRampWedgeGeometry(r.width, r.height, r.rise ?? 0)),
    [hole]
  );

  // Procedural turf/rough textures, built once and reused across holes.
  const grassTexture = useMemo(() => makeGrassTexture(256, 448, [58, 128, 62], 9), []);
  const roughTexture = useMemo(() => makeRoughTexture(), []);

  // Mirrors physics.ts's boundaryWalls() geometry exactly (same footprint,
  // same height) since these are now real colliders, not decorative trim.
  const trimBars = [
    // top
    { pos: [COURSE_WIDTH / 2, BOUNDARY_WALL_HEIGHT / 2, -WALL_THICKNESS / 2], size: [COURSE_WIDTH + WALL_THICKNESS * 2, BOUNDARY_WALL_HEIGHT, WALL_THICKNESS] },
    // bottom
    { pos: [COURSE_WIDTH / 2, BOUNDARY_WALL_HEIGHT / 2, COURSE_HEIGHT + WALL_THICKNESS / 2], size: [COURSE_WIDTH + WALL_THICKNESS * 2, BOUNDARY_WALL_HEIGHT, WALL_THICKNESS] },
    // left
    { pos: [-WALL_THICKNESS / 2, BOUNDARY_WALL_HEIGHT / 2, COURSE_HEIGHT / 2], size: [WALL_THICKNESS, BOUNDARY_WALL_HEIGHT, COURSE_HEIGHT + WALL_THICKNESS * 2] },
    // right
    { pos: [COURSE_WIDTH + WALL_THICKNESS / 2, BOUNDARY_WALL_HEIGHT / 2, COURSE_HEIGHT / 2], size: [WALL_THICKNESS, BOUNDARY_WALL_HEIGHT, COURSE_HEIGHT + WALL_THICKNESS * 2] },
  ] as const;

  return (
    <View style={styles.wrapper} onLayout={handleLayout}>
      <View style={styles.surface}>
        <Canvas shadows camera={{ fov: 55, near: 1, far: 2000 }}>
            <FollowCamera
              focusRef={focusRef}
              azRef={azRef}
              pitchRef={pitchRef}
              distanceRef={distanceRef}
            />
            <SkyBackground />
            <fog attach="fog" args={[FOG_COLOR, 950, 1750]} />
            <ambientLight intensity={0.4} />
            <hemisphereLight args={['#bfe0ff', '#2b5d3a', 0.55]} />
            <ShadowLight />

            {/* wide surrounding rough so the course sits in an endless field */}
            <mesh
              receiveShadow
              position={[COURSE_WIDTH / 2, -1.2, COURSE_HEIGHT / 2]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <planeGeometry args={[2400, 2800]} />
              <meshStandardMaterial map={roughTexture} roughness={1} metalness={0} />
            </mesh>

            {/* course green (manicured turf with mowing stripes) */}
            <mesh
              receiveShadow
              position={[COURSE_WIDTH / 2, 0, COURSE_HEIGHT / 2]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <planeGeometry args={[COURSE_WIDTH, COURSE_HEIGHT]} />
              <meshStandardMaterial map={grassTexture} roughness={0.95} metalness={0} />
            </mesh>
            {/* boundary trim */}
            {trimBars.map((bar, i) => (
              <mesh
                key={`trim-${i}`}
                castShadow
                receiveShadow
                position={bar.pos as unknown as [number, number, number]}
              >
                <boxGeometry args={bar.size as unknown as [number, number, number]} />
                <meshStandardMaterial color="#256B3E" roughness={0.85} />
              </mesh>
            ))}

            {hole.water.map((w, i) =>
              w.kind === 'circle' ? (
                <WaterSurface
                  key={`water-${i}`}
                  position={[w.x, WATER_Y, w.y]}
                  rotation={[-Math.PI / 2, 0, 0]}
                >
                  <circleGeometry args={[w.radius, 40]} />
                </WaterSurface>
              ) : (
                <WaterSurface
                  key={`water-${i}`}
                  position={[w.x, WATER_Y, w.y]}
                  rotation={[-Math.PI / 2, degToRotY(w.angle), 0]}
                >
                  <planeGeometry args={[w.width, w.height]} />
                </WaterSurface>
              )
            )}

            {hole.ramps.map((r, i) => (
              <mesh
                key={`ramp-${i}`}
                castShadow
                receiveShadow
                position={[r.x, 0, r.y]}
                quaternion={rampYawQuaternion(r.angle)}
                geometry={rampGeometries[i]}
              >
                <meshStandardMaterial color="#E8B23A" roughness={0.7} />
              </mesh>
            ))}

            {hole.obstacles.map((obstacle, i) => {
              const isRock = obstacle.style === 'rock';
              const color = isRock ? '#8B8378' : '#A0522D';
              const meshHeight = isRock ? ROCK_MESH_HEIGHT : WALL_MESH_HEIGHT;
              if (obstacle.kind === 'circle') {
                return (
                  <mesh
                    key={i}
                    castShadow
                    receiveShadow
                    position={[obstacle.x, meshHeight / 2, obstacle.y]}
                  >
                    <cylinderGeometry args={[obstacle.radius, obstacle.radius, meshHeight, 20]} />
                    <meshStandardMaterial color={color} roughness={0.9} />
                  </mesh>
                );
              }
              return (
                <mesh
                  key={i}
                  castShadow
                  receiveShadow
                  position={[obstacle.x, meshHeight / 2, obstacle.y]}
                  rotation={[0, degToRotY(obstacle.angle), 0]}
                >
                  <boxGeometry args={[obstacle.width, meshHeight, obstacle.height]} />
                  <meshStandardMaterial color={color} roughness={0.8} />
                </mesh>
              );
            })}

            {/* cup: a slightly recessed cylinder — cup physics stays a
                heuristic distance/speed trigger (not real pit collision),
                this is just enough geometry to look recessed now that the
                ball has real height. */}
            <mesh position={[hole.cup.x, -1.5, hole.cup.y]}>
              <cylinderGeometry args={[hole.cupRadius, hole.cupRadius, 3, 24]} />
              <meshStandardMaterial color="#0B3D24" />
            </mesh>
            {/* flagpole + flag */}
            <mesh castShadow position={[hole.cup.x, FLAGPOLE_HEIGHT / 2, hole.cup.y]}>
              <cylinderGeometry args={[0.6, 0.6, FLAGPOLE_HEIGHT, 8]} />
              <meshStandardMaterial color="#ffffff" />
            </mesh>
            <mesh castShadow position={[hole.cup.x + 8, FLAGPOLE_HEIGHT - 5, hole.cup.y]}>
              <boxGeometry args={[16, 11, 0.5]} />
              <meshStandardMaterial color={accentColor} />
            </mesh>

            {/* other players' balls */}
            {otherBalls
              .filter((o) => !o.ball.sunk)
              .map((o) => (
                <mesh castShadow key={o.id} position={[o.ball.x, o.ball.z, o.ball.y]}>
                  <sphereGeometry args={[BALL_RADIUS, 24, 24]} />
                  <meshStandardMaterial color={o.color} roughness={0.35} metalness={0.1} />
                </mesh>
              ))}

            {/* my ball */}
            {showMyBall && (
              <mesh castShadow position={[myRenderPos.x, myRenderPos.z, myRenderPos.y]}>
                <sphereGeometry args={[BALL_RADIUS, 24, 24]} />
                <meshStandardMaterial color={myColor} roughness={0.35} metalness={0.1} />
              </mesh>
            )}

            {/* aim indicator */}
            {drag && isMyTurn && (
              <>
                <AimBar
                  ballX={myRenderPos.x}
                  ballZ={myRenderPos.y}
                  dirX={-drag.aimDir.x}
                  dirZ={-drag.aimDir.y}
                  from={0}
                  to={drag.power * 40}
                  color="#FFFFFF"
                  opacity={0.65}
                />
                <AimBar
                  ballX={myRenderPos.x}
                  ballZ={myRenderPos.y}
                  dirX={drag.aimDir.x}
                  dirZ={drag.aimDir.y}
                  from={20}
                  to={20 + drag.power * AIM_INDICATOR_LENGTH}
                  color={drag.power > 0.85 ? '#FF5A5F' : '#FFFFFF'}
                />
              </>
            )}
          </Canvas>
          {/* Transparent touch overlay on top of the GL canvas. It captures
              the drag-to-putt gesture via PanResponder (RN view layer), which
              — unlike gesture-handler wrapping the canvas — reliably receives
              touches over the expo-gl surface on a real device. */}
          <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers} />
        </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    aspectRatio: COURSE_WIDTH / COURSE_HEIGHT,
    borderRadius: 12,
    overflow: 'hidden',
  },
  surface: {
    flex: 1,
  },
});
