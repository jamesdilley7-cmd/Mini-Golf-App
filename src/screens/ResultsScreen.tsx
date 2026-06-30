import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../components/PrimaryButton';
import ScoreTable from '../components/ScoreTable';
import { subscribeRoom } from '../firebase/rooms';
import { getCourseById } from '../game/courses';
import { RootStackParamList } from '../navigation/types';
import { RoomState } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Results'>;

export default function ResultsScreen({ route, navigation }: Props) {
  const { code } = route.params;
  const [room, setRoom] = useState<RoomState | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeRoom(code, setRoom);
    return unsubscribe;
  }, [code]);

  if (!room) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.loadingText}>Loading results…</Text>
      </SafeAreaView>
    );
  }

  const course = getCourseById(room.courseId);
  const totals = room.order
    .map((id) => {
      const player = room.players[id];
      const scores = room.scores?.[id] ?? {};
      const total = course.holes.reduce((sum, h) => sum + (scores[h.index] ?? 0), 0);
      return { id, name: player?.name ?? 'Player', color: player?.color ?? '#888', total };
    })
    .sort((a, b) => a.total - b.total);

  const winner = totals[0];

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Final Scorecard</Text>
      {winner && (
        <View style={styles.winnerCard}>
          <Text style={styles.trophy}>🏆</Text>
          <Text style={styles.winnerText}>{winner.name} wins with {winner.total} strokes!</Text>
        </View>
      )}

      <View style={styles.tableWrap}>
        <ScoreTable room={room} course={course} />
      </View>

      <View style={styles.footer}>
        <PrimaryButton label="Back to Home" onPress={() => navigation.popToTop()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: 16, color: '#5A5A5A' },
  title: { fontSize: 26, fontWeight: '800', color: '#1F6F4A', marginTop: 16, textAlign: 'center' },
  winnerCard: {
    alignItems: 'center',
    backgroundColor: '#FFF4D6',
    borderRadius: 14,
    padding: 16,
    marginTop: 20,
  },
  trophy: { fontSize: 32 },
  winnerText: { fontSize: 16, fontWeight: '700', color: '#7A5C00', marginTop: 6, textAlign: 'center' },
  tableWrap: { flex: 1, marginTop: 24 },
  footer: { paddingBottom: 12 },
});
