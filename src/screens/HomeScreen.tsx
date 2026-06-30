import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../components/PrimaryButton';
import { firebaseConfigured } from '../firebase/config';
import { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export default function HomeScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.emoji}>⛳️</Text>
        <Text style={styles.title}>Pocket Putt</Text>
        <Text style={styles.subtitle}>
          Host or join a mini golf game with friends, anywhere.
        </Text>
      </View>

      {!firebaseConfigured && (
        <View style={styles.warning}>
          <Text style={styles.warningText}>
            Firebase isn't configured yet. Add your project keys to a .env file (see
            README.md) before hosting or joining online games.
          </Text>
        </View>
      )}

      <View style={styles.actions}>
        <PrimaryButton label="Host a Game" onPress={() => navigation.navigate('Host')} />
        <PrimaryButton
          label="Join a Game"
          variant="secondary"
          onPress={() => navigation.navigate('Join')}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#EAF7EE',
    justifyContent: 'space-between',
    padding: 24,
  },
  hero: {
    marginTop: 60,
    alignItems: 'center',
  },
  emoji: {
    fontSize: 64,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: '#1F6F4A',
    marginTop: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#3D5347',
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 20,
  },
  warning: {
    backgroundColor: '#FFF4D6',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  warningText: {
    color: '#7A5C00',
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    gap: 12,
    marginBottom: 20,
  },
});
