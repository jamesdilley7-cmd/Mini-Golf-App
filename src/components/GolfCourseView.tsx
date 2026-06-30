import { Canvas, useThree } from '@react-three/fiber/native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { BufferAttribute, BufferGeometry, Quaternion as ThreeQuaternion, Vector3 as ThreeVector3 } from 'three';
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
const SCENE_BACKGROUND = '#bfe6cf';

function CameraRig({
  position,
  lookAt,
}: {
  position: [number, number, number];
  lookAt: [number, number, number];
}) {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(position[0], position[1], position[2]);
    camera.lookAt(lookAt[0], lookAt[1], lookAt[2]);
    camera.updateProjectionMatrix();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, ...position, ...lookAt]);
  return null;
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

  const [localBallPos, setLocalBallPos] = useState<BallPosition>({
    x: myBall.x,
    y: myBall.y,
    z: myBall.z,
  });
  const [drag, setDrag] = useState<{ aimDir: Vector2; power: number } | null>(null);
  const [canShoot, setCanShoot] = useState(true);

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

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(isMyTurn && canShoot)
        .onUpdate((e) => {
          const s = scaleRef.current || 1;
          const dragVector = { x: e.translationX / s, y: e.translationY / s };
          const aimDir = normalize({ x: -dragVector.x, y: -dragVector.y });
          const power = Math.max(
            0,
            Math.min(1, Math.hypot(dragVector.x, dragVector.y) / MAX_DRAG_WORLD_UNITS)
          );
          setDrag({ aimDir, power });
        })
        .onEnd((e) => {
          const s = scaleRef.current || 1;
          const dragVector = { x: e.translationX / s, y: e.translationY / s };
          const mag = Math.hypot(dragVector.x, dragVector.y);
          setDrag(null);
          if (mag < 8) return; // too small a flick, ignore
          const aimDir = normalize({ x: -dragVector.x, y: -dragVector.y });
          const power = Math.max(0, Math.min(1, mag / MAX_DRAG_WORLD_UNITS));
          takeShot(aimDir, power);
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isMyTurn, canShoot, hole.index]
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

  // Static per-hole camera: positioned behind the tee, elevated, looking at
  // the tee-cup midpoint. Recomputed only when the hole (or its tee/cup)
  // changes, since this view has no orbit/touch camera controls — those
  // would conflict with the shot-aim pan gesture above.
  const cameraConfig = useMemo(() => {
    const dx = hole.cup.x - hole.tee.x;
    const dz = hole.cup.y - hole.tee.y;
    const len = Math.hypot(dx, dz) || 1;
    const backX = -dx / len;
    const backZ = -dz / len;
    // Pulled back far enough that the tee (where the ball sits) stays inside
    // the vertical FOV alongside the cup — see GolfCourseView camera-framing
    // notes: a small pullback puts the tee at a much steeper depression
    // angle than the (farther) look-at point, pushing it below the frustum.
    const pullback = 260;
    const position: [number, number, number] = [
      hole.tee.x + backX * pullback,
      80 + len * 0.5,
      hole.tee.y + backZ * pullback,
    ];
    const lookAt: [number, number, number] = [
      (hole.tee.x + hole.cup.x) / 2,
      0,
      (hole.tee.y + hole.cup.y) / 2,
    ];
    return { position, lookAt };
  }, [hole.index, hole.tee.x, hole.tee.y, hole.cup.x, hole.cup.y]);

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
      <GestureDetector gesture={panGesture}>
        <View style={styles.surface}>
          <Canvas camera={{ fov: 55, near: 1, far: 2000 }}>
            <CameraRig position={cameraConfig.position} lookAt={cameraConfig.lookAt} />
            <color attach="background" args={[SCENE_BACKGROUND]} />
            <ambientLight intensity={0.65} />
            <directionalLight position={[120, 220, 80]} intensity={0.9} />

            {/* ground */}
            <mesh position={[COURSE_WIDTH / 2, 0, COURSE_HEIGHT / 2]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[COURSE_WIDTH, COURSE_HEIGHT]} />
              <meshStandardMaterial color="#2E8B4F" />
            </mesh>
            {/* boundary trim */}
            {trimBars.map((bar, i) => (
              <mesh key={`trim-${i}`} position={bar.pos as unknown as [number, number, number]}>
                <boxGeometry args={bar.size as unknown as [number, number, number]} />
                <meshStandardMaterial color="#256B3E" />
              </mesh>
            ))}

            {hole.water.map((w, i) =>
              w.kind === 'circle' ? (
                <mesh key={`water-${i}`} position={[w.x, WATER_Y, w.y]} rotation={[-Math.PI / 2, 0, 0]}>
                  <circleGeometry args={[w.radius, 28]} />
                  <meshStandardMaterial color="#2C7BC9" transparent opacity={0.82} />
                </mesh>
              ) : (
                <mesh
                  key={`water-${i}`}
                  position={[w.x, WATER_Y, w.y]}
                  rotation={[-Math.PI / 2, degToRotY(w.angle), 0]}
                >
                  <planeGeometry args={[w.width, w.height]} />
                  <meshStandardMaterial color="#2C7BC9" transparent opacity={0.82} />
                </mesh>
              )
            )}

            {hole.ramps.map((r, i) => (
              <mesh
                key={`ramp-${i}`}
                position={[r.x, 0, r.y]}
                quaternion={rampYawQuaternion(r.angle)}
                geometry={rampGeometries[i]}
              >
                <meshStandardMaterial color="#E8B23A" />
              </mesh>
            ))}

            {hole.obstacles.map((obstacle, i) => {
              const isRock = obstacle.style === 'rock';
              const color = isRock ? '#8B8378' : '#A0522D';
              const meshHeight = isRock ? ROCK_MESH_HEIGHT : WALL_MESH_HEIGHT;
              if (obstacle.kind === 'circle') {
                return (
                  <mesh key={i} position={[obstacle.x, meshHeight / 2, obstacle.y]}>
                    <cylinderGeometry args={[obstacle.radius, obstacle.radius, meshHeight, 20]} />
                    <meshStandardMaterial color={color} />
                  </mesh>
                );
              }
              return (
                <mesh
                  key={i}
                  position={[obstacle.x, meshHeight / 2, obstacle.y]}
                  rotation={[0, degToRotY(obstacle.angle), 0]}
                >
                  <boxGeometry args={[obstacle.width, meshHeight, obstacle.height]} />
                  <meshStandardMaterial color={color} />
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
            <mesh position={[hole.cup.x, FLAGPOLE_HEIGHT / 2, hole.cup.y]}>
              <cylinderGeometry args={[0.6, 0.6, FLAGPOLE_HEIGHT, 8]} />
              <meshStandardMaterial color="#ffffff" />
            </mesh>
            <mesh position={[hole.cup.x + 8, FLAGPOLE_HEIGHT - 5, hole.cup.y]}>
              <boxGeometry args={[16, 11, 0.5]} />
              <meshStandardMaterial color={accentColor} />
            </mesh>

            {/* other players' balls */}
            {otherBalls
              .filter((o) => !o.ball.sunk)
              .map((o) => (
                <mesh key={o.id} position={[o.ball.x, o.ball.z, o.ball.y]}>
                  <sphereGeometry args={[BALL_RADIUS, 16, 16]} />
                  <meshStandardMaterial color={o.color} />
                </mesh>
              ))}

            {/* my ball */}
            {showMyBall && (
              <mesh position={[myRenderPos.x, myRenderPos.z, myRenderPos.y]}>
                <sphereGeometry args={[BALL_RADIUS, 16, 16]} />
                <meshStandardMaterial color={myColor} />
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
        </View>
      </GestureDetector>
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
