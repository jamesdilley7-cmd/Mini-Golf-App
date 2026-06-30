import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import GameScreen from '../screens/GameScreen';
import HomeScreen from '../screens/HomeScreen';
import HostScreen from '../screens/HostScreen';
import JoinScreen from '../screens/JoinScreen';
import LobbyScreen from '../screens/LobbyScreen';
import ResultsScreen from '../screens/ResultsScreen';
import { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerStyle: { backgroundColor: '#1F6F4A' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Host" component={HostScreen} options={{ title: 'Host a Game' }} />
      <Stack.Screen name="Join" component={JoinScreen} options={{ title: 'Join a Game' }} />
      <Stack.Screen
        name="Lobby"
        component={LobbyScreen}
        options={{ title: 'Lobby', headerBackVisible: false }}
      />
      <Stack.Screen
        name="Game"
        component={GameScreen}
        options={{ headerShown: false, gestureEnabled: false }}
      />
      <Stack.Screen
        name="Results"
        component={ResultsScreen}
        options={{ title: 'Results', headerBackVisible: false }}
      />
    </Stack.Navigator>
  );
}
