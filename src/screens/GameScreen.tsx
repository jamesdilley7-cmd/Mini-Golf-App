import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import GolfCourseView from '../components/GolfCourseView';
import ScoreTable from '../components/ScoreTable';
import { getCurrentUid } from '../firebase/auth';
import { resolveShot, streamBallPosition, subscribeRoom } from '../firebase/rooms';
import { getCourseById } from '../game/courses';
import { RootStackParamList } from '../navigation/types';
import { RoomState } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Game'>;

export default function GameScreen({ route, navigation }: Props) {
  const { code } = route.params;
  const [room, setRoom] = useState<RoomState | null>(null);
  const [showScores, setShowScores] = useState(false);
  const myId = getCurrentUid();

  useEffect(() => {
    const unsubscribe = subscribeRoom(code, setRoom);
    return unsubscribe;
  }, [code]);

  useEffect(() => {
    if (room?.status === 'finished') {
      navigation.replace('Results', { code });
    }
  }, [room?.status, code, navigation]);

  if (!room || !myId) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.loadingText}>Loading game…</Text>
      </SafeAreaView>
    );
  }

  if (room.status !== 'playing' || !room.balls[myId]) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.loadingText}>Waiting for the round to begin…</Text>
      </SafeAreaView>
    );
  }

  const course = getCourseById(room.courseId);
  const hole = course.holes[room.holeIndex];
  const isMyTurn = room.activePlayerId === myId;
  const myBall = room.balls[myId];
  const myColor = room.players[myId]?.color ?? '#3D8BFD';
  const activePlayerName = room.activePlayerId
    ? room.players[room.activePlayerId]?.name ?? '...'
    : '';

  const otherBalls = Object.entries(room.balls)
    .filter(([id]) => id !== myId)
    .map(([id, ball]) => ({
      id,
      color: room.players[id]?.color ?? '#888888',
      ball,
    }));

  function handleBallMoving(partial: {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    moving: boolean;
  }) {
    if (!myId) return;
    streamBallPosition(code, myId, partial);
  }

  function handleShotResolved(result: {
    x: number;
    y: number;
    z: number;
    strokes: number;
    sunk: boolean;
  }) {
    if (!myId) return;
    resolveShot({
      room: room!,
      playerId: myId,
      finalX: result.x,
      finalY: result.y,
      finalZ: result.z,
      strokes: result.strokes,
      sunk: result.sunk,
    }).catch(() => {
      // best effort; room listener will reconcile state on next snapshot
    });
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.holeLabel}>
            Hole {room.holeIndex + 1} / {course.holes.length}
          </Text>
          <Text style={styles.parLabel}>Par {hole.par}</Text>
        </View>
        <Pressable style={styles.scoreButton} onPress={() => setShowScores(true)}>
          <Text style={styles.scoreButtonText}>Scorecard</Text>
        </Pressable>
      </View>

      <Text style={[styles.turnBanner, isMyTurn && styles.turnBannerActive]}>
        {isMyTurn ? 'Your turn — drag back and release to putt' : `${activePlayerName}'s turn`}
      </Text>

      <View style={styles.courseWrap}>
        <GolfCourseView
          hole={hole}
          accentColor={course.accentColor}
          myColor={myColor}
          myBall={myBall}
          otherBalls={otherBalls}
          isMyTurn={isMyTurn}
          onBallMoving={handleBallMoving}
          onShotResolved={handleShotResolved}
        />
      </View>

      <View style={styles.strokesRow}>
        <Text style={styles.strokesText}>Your strokes this hole: {myBall.strokes}</Text>
      </View>

      <Modal visible={showScores} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Scorecard</Text>
            <ScoreTable room={room} course={course} upToHoleIndex={room.holeIndex} />
            <Pressable style={styles.closeButton} onPress={() => setShowScores(false)}>
              <Text style={styles.closeButtonText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F3D24', paddingHorizontal: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F3D24' },
  loadingText: { color: '#fff', fontSize: 16 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  holeLabel: { color: '#fff', fontSize: 18, fontWeight: '800' },
  parLabel: { color: '#BFE3CC', fontSize: 13, marginTop: 2 },
  scoreButton: {
    backgroundColor: '#ffffff22',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  scoreButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  turnBanner: {
    color: '#BFE3CC',
    textAlign: 'center',
    marginTop: 14,
    marginBottom: 10,
    fontSize: 14,
    fontWeight: '600',
  },
  turnBannerActive: { color: '#FFD166', fontSize: 15, fontWeight: '800' },
  courseWrap: { alignItems: 'center', justifyContent: 'center' },
  strokesRow: { alignItems: 'center', marginTop: 14 },
  strokesText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: '#00000088',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '70%',
  },
  modalTitle: { fontSize: 18, fontWeight: '800', marginBottom: 12 },
  closeButton: {
    marginTop: 16,
    backgroundColor: '#1F6F4A',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  closeButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
