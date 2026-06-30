import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../components/PrimaryButton';
import { ensureSignedIn } from '../firebase/auth';
import { createRoom } from '../firebase/rooms';
import { COURSES } from '../game/courses';
import { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Host'>;

export default function HostScreen({ navigation }: Props) {
  const [name, setName] = useState('');
  const [courseId, setCourseId] = useState(COURSES[0].id);
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!name.trim()) {
      Alert.alert('Enter your name', 'Please enter a name so other players can see you.');
      return;
    }
    setLoading(true);
    try {
      const uid = await ensureSignedIn();
      const code = await createRoom(uid, name, courseId);
      navigation.replace('Lobby', { code });
    } catch (error: any) {
      Alert.alert('Could not create room', error?.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.label}>Your name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="e.g. Sam"
        style={styles.input}
        maxLength={20}
        autoCapitalize="words"
      />

      <Text style={styles.label}>Choose a course</Text>
      <View style={styles.courseList}>
        {COURSES.map((course) => {
          const selected = course.id === courseId;
          return (
            <Pressable
              key={course.id}
              onPress={() => setCourseId(course.id)}
              style={[
                styles.courseCard,
                selected && { borderColor: course.accentColor, backgroundColor: '#F4FBF6' },
              ]}
            >
              <View style={[styles.courseDot, { backgroundColor: course.accentColor }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.courseName}>{course.name}</Text>
                <Text style={styles.courseDesc}>{course.description}</Text>
                <Text style={styles.courseHoles}>{course.holes.length} holes</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.footer}>
        <PrimaryButton label="Create Room" onPress={handleCreate} loading={loading} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 20 },
  label: { fontSize: 14, fontWeight: '700', color: '#3D5347', marginTop: 16, marginBottom: 8 },
  input: {
    borderWidth: 1.5,
    borderColor: '#D8E6DC',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  courseList: { gap: 10 },
  courseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderColor: '#E5ECE7',
    borderRadius: 14,
    padding: 14,
  },
  courseDot: { width: 14, height: 14, borderRadius: 7 },
  courseName: { fontSize: 16, fontWeight: '700', color: '#1B1B1B' },
  courseDesc: { fontSize: 13, color: '#5A5A5A', marginTop: 2 },
  courseHoles: { fontSize: 12, color: '#1F6F4A', marginTop: 4, fontWeight: '600' },
  footer: { marginTop: 'auto', paddingBottom: 12 },
});
