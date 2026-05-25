import { Buffer } from 'buffer';
global.Buffer = Buffer;

import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import HomeScreen from './src/screens/HomeScreen';
import SyncScreen from './src/screens/SyncScreen';
import notesStore from './src/store/notesStore';
import * as syncManager from './src/sync/syncManager';
import { requestPermission } from './src/utils/notifications';

const Tab = createBottomTabNavigator();

export default function App() {
  useEffect(() => {
    notesStore.loadNotes();
    const unsubSync = syncManager.init();
    requestPermission(); // 请求通知权限
    return () => { unsubSync(); };
  }, []);

  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#1a73e8',
          tabBarInactiveTintColor: '#999',
          tabBarStyle: { height: 56, paddingBottom: 6 },
        }}
      >
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{
            title: '便签',
            tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>📝</Text>,
          }}
        />
        <Tab.Screen
          name="Sync"
          component={SyncScreen}
          options={{
            title: '同步',
            tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>🔗</Text>,
          }}
        />
      </Tab.Navigator>
      <StatusBar style="dark" />
    </NavigationContainer>
  );
}
