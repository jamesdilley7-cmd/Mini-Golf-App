import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../components/PrimaryButton';
import { ensureSignedIn } from '../firebase/auth';
import { joinRoom } from '../firebase/rooms';
import { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Join'>;

export default function JoinScreen({ navigation }: Props) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleJoin() {
    if (!name.trim()) {
      Alert.alert('Enter your name', 'Please enter a name so other players can see you.');
      return;
    }
    if (code.trim().length < 4) {
      Alert.alert('Enter a room code', 'Ask the host for their 5-character room code.');
      return;
    }
    setLoading(true);
    try {
      const uid = await ensureSignedIn();
      const normalizedCode = code.trim().toUpperCase();
      await joinRoom(normalizedCode, uid, name);
      navigation.replace('Lobby', { code: normalizedCode });
    } catch (error: any) {
      Alert.alert('Could not join room', error?.message ?? 'Please try again.');
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

      <Text style={styles.label}>Room code</Text>
      <TextInput
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        placeholder="e.g. AB3CD"
        style={[styles.input, styles.codeInput]}
        maxLength={5}
        autoCapitalize="characters"
        autoCorrect={false}
      />

      <View style={styles.footer}>
        <PrimaryButton label="Join Room" onPress={handleJoin} loading={loading} />
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
  codeInput: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 4,
    textAlign: 'center',
  },
  footer: { marginTop: 'auto', paddingBottom: 12 },
});
