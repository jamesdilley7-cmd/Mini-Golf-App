import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Course, RoomState } from '../types';

interface Props {
  room: RoomState;
  course: Course;
  upToHoleIndex?: number;
}

export default function ScoreTable({ room, course, upToHoleIndex }: Props) {
  const lastHole = upToHoleIndex ?? course.holes.length - 1;
  const holeNumbers = course.holes.slice(0, lastHole + 1).map((h) => h.index);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        <View style={styles.row}>
          <Text style={[styles.cell, styles.nameCell, styles.headerText]}>Player</Text>
          {holeNumbers.map((idx) => (
            <Text key={idx} style={[styles.cell, styles.headerText]}>
              {idx + 1}
            </Text>
          ))}
          <Text style={[styles.cell, styles.headerText]}>Tot</Text>
        </View>
        {room.order.map((playerId) => {
          const player = room.players[playerId];
          if (!player) return null;
          const scores = room.scores?.[playerId] ?? {};
          const total = holeNumbers.reduce((sum, idx) => sum + (scores[idx] ?? 0), 0);
          return (
            <View key={playerId} style={styles.row}>
              <View style={[styles.cell, styles.nameCell, styles.nameRow]}>
                <View style={[styles.dot, { backgroundColor: player.color }]} />
                <Text style={styles.nameText} numberOfLines={1}>
                  {player.name}
                </Text>
              </View>
              {holeNumbers.map((idx) => (
                <Text key={idx} style={styles.cell}>
                  {scores[idx] ?? '-'}
                </Text>
              ))}
              <Text style={[styles.cell, styles.totalText]}>{total || '-'}</Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  cell: {
    width: 34,
    textAlign: 'center',
    color: '#1B1B1B',
    fontSize: 14,
  },
  nameCell: {
    width: 110,
    textAlign: 'left',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  nameText: {
    fontSize: 14,
    fontWeight: '600',
    maxWidth: 90,
  },
  headerText: {
    fontWeight: '700',
    color: '#5A5A5A',
  },
  totalText: {
    fontWeight: '700',
  },
});
