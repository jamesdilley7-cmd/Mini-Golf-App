import { Canvas, useThree } from '@react-three/fiber/native';
import Matter from 'matter-js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  applyRampBoost,
  applyShot,
  BALL_RADIUS,
  checkSunk,
  clampBallInBounds,
  createCourseWorld,
  CourseWorld,
  findCrossedRamp,
  isInWater,
  isResting,
  settleBall,
  stepWorld,
  WALL_THICKNESS,
} from '../game/physics';
import { BallState, COURSE_HEIGHT, COURSE_WIDTH, HoleDefinition, Vector2 } from '../types';

const MAX_DRAG_WORLD_UNITS = 110;
const AIM_INDICATOR_LENGTH = 90;
const BROADCAST_INTERVAL_MS = 70;

interface OtherBall {
  id: string;
  color: string;
  ball: BallState;
}

interface ShotResult {
  x: number;
  y: number;
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
  onBallMoving: (partial: Pick<BallState, 'x' | 'y' | 'vx' | 'vy' | 'moving'>) => void;
  onShotResolved: (result: ShotResult) => void;
}

function normalize(v: Vector2): Vector2 {
  const mag = Math.hypot(v.x, v.y);
  if (mag < 1e-6) return { x: 0, y: 0 };
  return { x: v.x / mag, y: v.y / mag };
}

// 3D scene tuning. Physics/network stay in the 2D (x, y) plane from
// src/game/physics.ts and src/firebase/rooms.ts; here that plane is mapped
// onto the 3D ground as (x, z), with 3D height (y) reserved for purely
// decorative geometry — see the README's "physics stays 2D" note.
const WALL_MESH_HEIGHT = 22;
const ROCK_MESH_HEIGHT = 16;
const TRIM_HEIGHT = 10;
const FLAGPOLE_HEIGHT = 38;
const WATER_Y = 0.6;
const RAMP_Y = 1.2;
const SCENE_BACKGROUND = '#bfe6cf';

/** 2D obstacle/hazard `angle` (degrees) rotates a rect within the (x, y)
 * plane the same way physics.ts's pointInRect does; converting that into a
 * three.js Y-axis rotation (the ground plane is now x/z) flips the sign. */
function degToRotY(angleDeg?: number): number {
  return -((angleDeg ?? 0) * Math.PI) / 180;
}

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
  const triggeredRampsRef = useRef<Set<number>>(new Set());

  const [localBallPos, setLocalBallPos] = useState<Vector2>({ x: myBall.x, y: myBall.y });
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
    triggeredRampsRef.current.clear();
    setLocalBallPos({ x: myBall.x, y: myBall.y });
    setCanShoot(true);
    return () => {
      worldRef.current = null;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurn, hole.index, myBall.strokes]);

  function stepLoop(timestamp: number) {
    const world = worldRef.current;
    if (!world) return;
    if (lastFrameRef.current === null) lastFrameRef.current = timestamp;
    const delta = Math.min(32, timestamp - lastFrameRef.current);
    lastFrameRef.current = timestamp;

    stepWorld(world.engine, delta);
    clampBallInBounds(world.ball);

    const crossedRamp = findCrossedRamp(world.ball.position, hole, triggeredRampsRef.current);
    if (crossedRamp !== null) {
      triggeredRampsRef.current.add(crossedRamp);
      applyRampBoost(world.ball, hole.ramps[crossedRamp]);
    }

    const sunk = checkSunk(world.ball, hole);
    if (sunk) {
      settleBall(world.ball);
      movingRef.current = false;
      lastFrameRef.current = null;
      setLocalBallPos({ x: hole.cup.x, y: hole.cup.y });
      onShotResolved({ x: hole.cup.x, y: hole.cup.y, strokes: strokesRef.current, sunk: true });
      return;
    }

    if (isResting(world.ball)) {
      settleBall(world.ball);
      movingRef.current = false;
      lastFrameRef.current = null;

      if (isInWater(world.ball.position, hole)) {
        // Splashed: penalty stroke, retry from where this shot started.
        strokesRef.current += 1;
        const dropPos = shotStartPosRef.current;
        Matter.Body.setPosition(world.ball, dropPos);
        setLocalBallPos(dropPos);
        onShotResolved({ x: dropPos.x, y: dropPos.y, strokes: strokesRef.current, sunk: false });
        return;
      }

      const pos = { x: world.ball.position.x, y: world.ball.position.y };
      setLocalBallPos(pos);
      onShotResolved({ x: pos.x, y: pos.y, strokes: strokesRef.current, sunk: false });
      return;
    }

    setLocalBallPos({ x: world.ball.position.x, y: world.ball.position.y });

    const now = Date.now();
    if (now - lastBroadcastRef.current > BROADCAST_INTERVAL_MS) {
      lastBroadcastRef.current = now;
      onBallMoving({
        x: world.ball.position.x,
        y: world.ball.position.y,
        vx: world.ball.velocity.x,
        vy: world.ball.velocity.y,
        moving: true,
      });
    }

    rafRef.current = requestAnimationFrame(stepLoop);
  }

  function takeShot(aimDir: Vector2, power: number) {
    const world = worldRef.current;
    if (!world || movingRef.current) return;
    shotStartPosRef.current = { x: world.ball.position.x, y: world.ball.position.y };
    triggeredRampsRef.current.clear();
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

  const myRenderPos = isMyTurn ? localBallPos : { x: myBall.x, y: myBall.y };
  const showMyBall = isMyTurn || !myBall.sunk;

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

  const trimBars = [
    // top
    { pos: [COURSE_WIDTH / 2, TRIM_HEIGHT / 2, WALL_THICKNESS / 2], size: [COURSE_WIDTH, TRIM_HEIGHT, WALL_THICKNESS] },
    // bottom
    { pos: [COURSE_WIDTH / 2, TRIM_HEIGHT / 2, COURSE_HEIGHT - WALL_THICKNESS / 2], size: [COURSE_WIDTH, TRIM_HEIGHT, WALL_THICKNESS] },
    // left
    { pos: [WALL_THICKNESS / 2, TRIM_HEIGHT / 2, COURSE_HEIGHT / 2], size: [WALL_THICKNESS, TRIM_HEIGHT, COURSE_HEIGHT] },
    // right
    { pos: [COURSE_WIDTH - WALL_THICKNESS / 2, TRIM_HEIGHT / 2, COURSE_HEIGHT / 2], size: [WALL_THICKNESS, TRIM_HEIGHT, COURSE_HEIGHT] },
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
                position={[r.x, RAMP_Y, r.y]}
                rotation={[-Math.PI / 2, degToRotY(r.angle), 0]}
              >
                <planeGeometry args={[r.width, r.height]} />
                <meshStandardMaterial color="#E8B23A" transparent opacity={0.92} />
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

            {/* cup */}
            <mesh position={[hole.cup.x, 0.15, hole.cup.y]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[hole.cupRadius, 24]} />
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
                <mesh key={o.id} position={[o.ball.x, BALL_RADIUS, o.ball.y]}>
                  <sphereGeometry args={[BALL_RADIUS, 16, 16]} />
                  <meshStandardMaterial color={o.color} />
                </mesh>
              ))}

            {/* my ball */}
            {showMyBall && (
              <mesh position={[myRenderPos.x, BALL_RADIUS, myRenderPos.y]}>
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
