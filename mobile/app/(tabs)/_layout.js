import React from 'react';
import { Text } from 'react-native';
import { Tabs } from 'expo-router';
import { colors } from '../../src/theme';

// Emoji tab icons keep the project dependency-free — no icon font to install
// or license for a student build.
const icon = (glyph) => ({ color, size }) => (
  <Text style={{ fontSize: size - 4, color, opacity: color === colors.honeyDark ? 1 : 0.55 }}>
    {glyph}
  </Text>
);

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.honeyDark,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
      }}
    >
      <Tabs.Screen name="index"   options={{ title: 'Dashboard', tabBarIcon: icon('🏠') }} />
      <Tabs.Screen name="analyze" options={{ title: 'Analyze',   tabBarIcon: icon('📊') }} />
      <Tabs.Screen name="jobs"    options={{ title: 'Jobs',      tabBarIcon: icon('🔍') }} />
      <Tabs.Screen name="tracker" options={{ title: 'Tracker',   tabBarIcon: icon('📋') }} />
    </Tabs>
  );
}
