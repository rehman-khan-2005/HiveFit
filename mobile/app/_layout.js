import React from 'react';
import { Stack, Redirect, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';

import { AuthProvider, useAuth } from '../src/state/auth';
import { Loading } from '../src/components/ui';
import { colors } from '../src/theme';

function Gate() {
  const { user, booting } = useAuth();
  const segments = useSegments();

  if (booting) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.canvas }}>
        <Loading label="Starting HiveFit…" />
      </View>
    );
  }

  const inApp = segments[0] === '(tabs)' || segments[0] === 'analysis';

  // Send signed-out users to the auth screen, and signed-in users past it.
  if (!user && inApp) return <Redirect href="/" />;
  if (user && !inApp) return <Redirect href="/(tabs)" />;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="analysis/[id]"
        options={{ headerShown: true, title: 'Analysis', headerTintColor: colors.ink }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
