import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../components/PrimaryButton';
import { getCurrentUid } from '../firebase/auth';
import { leaveLobby, startGame, subscribeRoom } from '../firebase/rooms';
import { getCourseById } from '../game/courses';
import { RootStackParamList } from '../navigation/types';
import { RoomState } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Lobby'>;

export default function LobbyScreen({ route, navigation }: Props) {
  const { code } = route.params;
  const [room, setRoom] = useState<RoomState | null>(null);
  const [starting, setStarting] = useState(false);
  const myId = getCurrentUid();

  useEffect(() => {
    const unsubscribe = subscribeRoom(code, setRoom);
    return unsubscribe;
  }, [code]);

  useEffect(() => {
    if (room?.status === 'playing') {
      navigation.replace('Game', { code });
    }
  }, [room?.status, code, navigation]);

  if (!room) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.notFound}>Looking for room {code}…</Text>
      </SafeAreaView>
    );
  }

  const isHost = myId === room.hostId;
  const course = getCourseById(room.courseId);
  const players = Object.entries(room.players).filter(([, p]) => p.connected);

  async function handleStart() {
    if (players.length < 1) return;
    setStarting(true);
    try {
      await startGame(room!);
    } catch (error: any) {
      Alert.alert('Could not start game', error?.message ?? 'Please try again.');
      setStarting(false);
    }
  }

  function handleLeave() {
    if (myId) leaveLobby(code, myId);
    navigation.popToTop();
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.codeLabel}>Room code</Text>
      <Text style={styles.code}>{code}</Text>
      <Text style={styles.courseLine}>
        {course.name} · {course.holes.length} holes
      </Text>

      <Text style={styles.sectionTitle}>Players ({players.length})</Text>
      <FlatList
        data={players}
        keyExtractor={([id]) => id}
        style={styles.list}
        renderItem={({ item: [id, player] }) => (
          <View style={styles.playerRow}>
            <View style={[styles.dot, { backgroundColor: player.color }]} />
            <Text style={styles.playerName}>{player.name}</Text>
            {player.host && <Text style={styles.hostBadge}>HOST</Text>}
            {id === myId && <Text style={styles.youBadge}>YOU</Text>}
          </View>
        )}
      />

      <View style={styles.footer}>
        {isHost ? (
          <PrimaryButton
            label={`Start Game (${players.length} player${players.length === 1 ? '' : 's'})`}
            onPress={handleStart}
            loading={starting}
          />
        ) : (
          <Text style={styles.waiting}>Waiting for the host to start the game…</Text>
        )}
        <PrimaryButton label="Leave Lobby" variant="secondary" onPress={handleLeave} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 20 },
  notFound: { marginTop: 80, textAlign: 'center', fontSize: 16, color: '#5A5A5A' },
  codeLabel: { fontSize: 13, color: '#5A5A5A', marginTop: 12, textAlign: 'center' },
  code: {
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: 6,
    color: '#1F6F4A',
    textAlign: 'center',
  },
  courseLine: { textAlign: 'center', color: '#3D5347', marginTop: 6, fontWeight: '600' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#3D5347', marginTop: 28, marginBottom: 8 },
  list: { flex: 1 },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  playerName: { fontSize: 16, fontWeight: '600', flex: 1 },
  hostBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: '#1F6F4A',
    backgroundColor: '#DDF3E4',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    marginRight: 6,
  },
  youBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: '#7A5C00',
    backgroundColor: '#FFF4D6',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  footer: { gap: 12, paddingBottom: 12 },
  waiting: { textAlign: 'center', color: '#5A5A5A', marginBottom: 4 },
});
