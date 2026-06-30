import Matter from 'matter-js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Circle, Line, Rect, G } from 'react-native-svg';
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
  // turn, or the hole changes, starting from wherever their ball last rested.
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
  }, [isMyTurn, hole.index]);

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

  return (
    <View style={styles.wrapper} onLayout={handleLayout}>
      <GestureDetector gesture={panGesture}>
        <View style={styles.surface}>
          <Svg width="100%" height="100%" viewBox={`0 0 ${COURSE_WIDTH} ${COURSE_HEIGHT}`}>
            <Rect
              x={0}
              y={0}
              width={COURSE_WIDTH}
              height={COURSE_HEIGHT}
              fill="#2E8B4F"
              rx={10}
            />
            <Rect
              x={WALL_THICKNESS / 2}
              y={WALL_THICKNESS / 2}
              width={COURSE_WIDTH - WALL_THICKNESS}
              height={COURSE_HEIGHT - WALL_THICKNESS}
              fill="none"
              stroke="#256B3E"
              strokeWidth={WALL_THICKNESS}
            />

            {hole.water.map((w, i) =>
              w.kind === 'circle' ? (
                <Circle
                  key={`water-${i}`}
                  cx={w.x}
                  cy={w.y}
                  r={w.radius}
                  fill="#2C7BC9"
                  stroke="#1A4F87"
                  strokeWidth={2}
                />
              ) : (
                <Rect
                  key={`water-${i}`}
                  x={w.x - w.width / 2}
                  y={w.y - w.height / 2}
                  width={w.width}
                  height={w.height}
                  fill="#2C7BC9"
                  stroke="#1A4F87"
                  strokeWidth={2}
                  rx={8}
                  origin={`${w.x}, ${w.y}`}
                  rotation={w.angle ?? 0}
                />
              )
            )}

            {hole.ramps.map((r, i) => (
              <Rect
                key={`ramp-${i}`}
                x={r.x - r.width / 2}
                y={r.y - r.height / 2}
                width={r.width}
                height={r.height}
                fill="#E8B23A"
                stroke="#fff"
                strokeWidth={1.5}
                strokeDasharray="4,3"
                rx={4}
                origin={`${r.x}, ${r.y}`}
                rotation={r.angle ?? 0}
                opacity={0.92}
              />
            ))}

            {hole.obstacles.map((obstacle, i) => {
              if (obstacle.kind === 'circle') {
                return (
                  <Circle
                    key={i}
                    cx={obstacle.x}
                    cy={obstacle.y}
                    r={obstacle.radius}
                    fill={obstacle.style === 'rock' ? '#8B8378' : '#A0522D'}
                  />
                );
              }
              return (
                <Rect
                  key={i}
                  x={obstacle.x - obstacle.width / 2}
                  y={obstacle.y - obstacle.height / 2}
                  width={obstacle.width}
                  height={obstacle.height}
                  fill={obstacle.style === 'rock' ? '#8B8378' : '#A0522D'}
                  rx={3}
                  origin={`${obstacle.x}, ${obstacle.y}`}
                  rotation={obstacle.angle ?? 0}
                />
              );
            })}

            {/* cup */}
            <Circle cx={hole.cup.x} cy={hole.cup.y} r={hole.cupRadius} fill="#0B3D24" />
            <Circle
              cx={hole.cup.x}
              cy={hole.cup.y}
              r={hole.cupRadius}
              fill="none"
              stroke="#fff"
              strokeWidth={1}
              opacity={0.4}
            />
            {/* flag */}
            <Line
              x1={hole.cup.x}
              y1={hole.cup.y}
              x2={hole.cup.x}
              y2={hole.cup.y - 38}
              stroke="#fff"
              strokeWidth={2}
            />
            <Rect
              x={hole.cup.x}
              y={hole.cup.y - 38}
              width={16}
              height={11}
              fill={accentColor}
            />

            {/* other players' balls */}
            {otherBalls
              .filter((o) => !o.ball.sunk)
              .map((o) => (
                <Circle
                  key={o.id}
                  cx={o.ball.x}
                  cy={o.ball.y}
                  r={BALL_RADIUS}
                  fill={o.color}
                  stroke="#00000033"
                  strokeWidth={1}
                />
              ))}

            {/* my ball */}
            {showMyBall && (
              <Circle
                cx={myRenderPos.x}
                cy={myRenderPos.y}
                r={BALL_RADIUS}
                fill={myColor}
                stroke="#fff"
                strokeWidth={1.5}
              />
            )}

            {/* aim indicator */}
            {drag && isMyTurn && (
              <G>
                <Line
                  x1={myRenderPos.x}
                  y1={myRenderPos.y}
                  x2={myRenderPos.x - drag.aimDir.x * drag.power * 40}
                  y2={myRenderPos.y - drag.aimDir.y * drag.power * 40}
                  stroke="#FFFFFFAA"
                  strokeWidth={2}
                  strokeDasharray="4,4"
                />
                <Line
                  x1={myRenderPos.x}
                  y1={myRenderPos.y}
                  x2={myRenderPos.x + drag.aimDir.x * (20 + drag.power * AIM_INDICATOR_LENGTH)}
                  y2={myRenderPos.y + drag.aimDir.y * (20 + drag.power * AIM_INDICATOR_LENGTH)}
                  stroke={drag.power > 0.85 ? '#FF5A5F' : '#FFFFFF'}
                  strokeWidth={3}
                />
              </G>
            )}
          </Svg>
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
