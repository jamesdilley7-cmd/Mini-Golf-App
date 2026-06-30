import {
  get,
  onDisconnect,
  onValue,
  ref,
  serverTimestamp,
  set,
  update,
} from 'firebase/database';
import { getCourseById } from '../game/courses';
import { BALL_RADIUS } from '../game/physics';
import { db } from './config';
import { BallState, MAX_STROKES_PER_HOLE, PLAYER_COLORS, RoomState } from '../types';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion

function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

export class RoomError extends Error {}

function requireDb() {
  if (!db) {
    throw new RoomError('Firebase is not configured. Add your Firebase credentials to .env first.');
  }
  return db;
}

export async function createRoom(
  hostId: string,
  hostName: string,
  courseId: string
): Promise<string> {
  const database = requireDb();
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = generateRoomCode();
    const roomRef = ref(database, `rooms/${code}`);
    const snap = await get(roomRef);
    if (snap.exists()) continue;

    const initialRoom: Omit<RoomState, 'balls' | 'scores'> & {
      balls: Record<string, never>;
      scores: Record<string, never>;
    } = {
      code,
      hostId,
      courseId,
      status: 'lobby',
      createdAt: Date.now(),
      holeIndex: 0,
      order: [],
      activePlayerId: null,
      players: {
        [hostId]: {
          name: hostName.trim().slice(0, 20) || 'Host',
          color: PLAYER_COLORS[0],
          joinedAt: Date.now(),
          connected: true,
          host: true,
        },
      },
      balls: {},
      scores: {},
    };

    await set(roomRef, initialRoom);
    onDisconnect(ref(database, `rooms/${code}/players/${hostId}/connected`)).set(false);
    return code;
  }
  throw new RoomError('Could not generate a unique room code. Please try again.');
}

export async function joinRoom(
  code: string,
  playerId: string,
  name: string
): Promise<void> {
  const database = requireDb();
  const normalizedCode = code.trim().toUpperCase();
  const roomRef = ref(database, `rooms/${normalizedCode}`);
  const snap = await get(roomRef);
  if (!snap.exists()) {
    throw new RoomError('Room not found. Check the code and try again.');
  }
  const room = snap.val() as RoomState;
  if (room.status !== 'lobby') {
    throw new RoomError('This game has already started.');
  }
  if (room.players && room.players[playerId]) {
    onDisconnect(ref(database, `rooms/${normalizedCode}/players/${playerId}/connected`)).set(
      false
    );
    return;
  }

  const existingCount = room.players ? Object.keys(room.players).length : 0;
  if (existingCount >= PLAYER_COLORS.length) {
    throw new RoomError('This room is full.');
  }

  await update(ref(database, `rooms/${normalizedCode}/players/${playerId}`), {
    name: name.trim().slice(0, 20) || 'Player',
    color: PLAYER_COLORS[existingCount % PLAYER_COLORS.length],
    joinedAt: Date.now(),
    connected: true,
    host: false,
  });
  onDisconnect(ref(database, `rooms/${normalizedCode}/players/${playerId}/connected`)).set(
    false
  );
}

export function subscribeRoom(
  code: string,
  callback: (room: RoomState | null) => void
): () => void {
  const database = requireDb();
  const roomRef = ref(database, `rooms/${code}`);
  const unsubscribe = onValue(roomRef, (snap) => {
    callback(snap.exists() ? (snap.val() as RoomState) : null);
  });
  return unsubscribe;
}

function ballsForHole(playerIds: string[], teeX: number, teeY: number) {
  const balls: Record<string, BallState> = {};
  for (const id of playerIds) {
    balls[id] = {
      x: teeX,
      y: teeY,
      z: BALL_RADIUS,
      vx: 0,
      vy: 0,
      vz: 0,
      moving: false,
      sunk: false,
      retired: false,
      strokes: 0,
      updatedAt: Date.now(),
    };
  }
  return balls;
}

export async function startGame(room: RoomState): Promise<void> {
  const database = requireDb();
  const course = getCourseById(room.courseId);
  const order = Object.entries(room.players)
    .sort((a, b) => a[1].joinedAt - b[1].joinedAt)
    .map(([id]) => id);

  const tee = course.holes[0].tee;
  await update(ref(database, `rooms/${room.code}`), {
    status: 'playing',
    holeIndex: 0,
    order,
    activePlayerId: order[0],
    balls: ballsForHole(order, tee.x, tee.y),
    scores: {},
  });
}

export function streamBallPosition(
  code: string,
  playerId: string,
  ball: Pick<BallState, 'x' | 'y' | 'z' | 'vx' | 'vy' | 'vz' | 'moving'>
) {
  if (!db) return;
  update(ref(db, `rooms/${code}/balls/${playerId}`), {
    ...ball,
    updatedAt: serverTimestamp(),
  }).catch(() => {
    // best-effort streaming update; transient failures are fine
  });
}

interface ResolveShotArgs {
  room: RoomState;
  playerId: string;
  finalX: number;
  finalY: number;
  finalZ: number;
  strokes: number;
  sunk: boolean;
}

export async function resolveShot({
  room,
  playerId,
  finalX,
  finalY,
  finalZ,
  strokes,
  sunk,
}: ResolveShotArgs): Promise<void> {
  const database = requireDb();
  const course = getCourseById(room.courseId);
  const retired = sunk || strokes >= MAX_STROKES_PER_HOLE;
  const updates: Record<string, unknown> = {};

  updates[`balls/${playerId}`] = {
    x: finalX,
    y: finalY,
    z: finalZ,
    vx: 0,
    vy: 0,
    vz: 0,
    moving: false,
    sunk,
    retired,
    strokes,
    updatedAt: Date.now(),
  };

  const retiredMap: Record<string, boolean> = {};
  for (const id of room.order) {
    retiredMap[id] = id === playerId ? retired : Boolean(room.balls?.[id]?.retired);
  }

  if (retired) {
    updates[`scores/${playerId}/${room.holeIndex}`] = strokes;
  }

  const everyoneDone = room.order.every((id) => retiredMap[id]);

  if (everyoneDone) {
    const nextHoleIndex = room.holeIndex + 1;
    if (nextHoleIndex >= course.holes.length) {
      updates['status'] = 'finished';
      updates['activePlayerId'] = null;
    } else {
      const tee = course.holes[nextHoleIndex].tee;
      updates['holeIndex'] = nextHoleIndex;
      updates['balls'] = ballsForHole(room.order, tee.x, tee.y);
      updates['activePlayerId'] = room.order[nextHoleIndex % room.order.length];
    }
  } else {
    const currentIdx = room.order.indexOf(playerId);
    let nextIdx = currentIdx;
    for (let i = 1; i <= room.order.length; i++) {
      const candidate = (currentIdx + i) % room.order.length;
      if (!retiredMap[room.order[candidate]]) {
        nextIdx = candidate;
        break;
      }
    }
    updates['activePlayerId'] = room.order[nextIdx];
  }

  await update(ref(database, `rooms/${room.code}`), updates);
}

export async function leaveLobby(code: string, playerId: string): Promise<void> {
  const database = requireDb();
  await update(ref(database, `rooms/${code}/players/${playerId}`), { connected: false });
}
