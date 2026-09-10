import React, { useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../src/state/auth';
import { Button, Field, Banner, Card } from '../src/components/ui';
import { colors, spacing, type } from '../src/theme';

export default function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const isSignUp = mode === 'signup';

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (isSignUp) await signUp(email, password, fullName);
      else await signIn(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ padding: spacing.lg, flexGrow: 1, justifyContent: 'center' }}>
          <View style={{ alignItems: 'center', marginBottom: spacing.xl }}>
            <Text style={{ fontSize: 40 }}>🐝</Text>
            <Text style={[type.h1, { marginTop: spacing.sm }]}>HiveFit</Text>
            <Text style={[type.small, { textAlign: 'center', marginTop: spacing.xs }]}>
              See why your resume was filtered out — and fix it honestly.
            </Text>
          </View>

          <Card>
            {error ? <Banner tone="error">{error}</Banner> : null}

            {isSignUp ? (
              <Field
                label="Name"
                value={fullName}
                onChangeText={setFullName}
                placeholder="Your name"
                autoCapitalize="words"
              />
            ) : null}

            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@school.edu"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              inputMode="email"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder={isSignUp ? 'At least 8 characters' : 'Your password'}
              secureTextEntry
              autoCapitalize="none"
            />

            <Button
              title={isSignUp ? 'Create account' : 'Sign in'}
              onPress={submit}
              loading={busy}
              disabled={!email || !password}
            />
            <Button
              title={isSignUp ? 'I already have an account' : 'Create an account'}
              variant="ghost"
              onPress={() => { setMode(isSignUp ? 'signin' : 'signup'); setError(null); }}
              style={{ marginTop: spacing.sm }}
            />
          </Card>

          <Text style={[type.small, { textAlign: 'center' }]}>
            Every feature is free. No subscription tiers.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
