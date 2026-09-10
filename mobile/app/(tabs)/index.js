import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';

import { useAuth } from '../../src/state/auth';
import { api } from '../../src/api/client';
import { Card, Button, Empty, Loading, Banner, ScoreBadge } from '../../src/components/ui';
import { colors, spacing, type } from '../../src/theme';

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  const [state, setState] = useState({ loading: true, error: null, resumes: [], analyses: [], counts: {} });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [resumes, analyses, saved] = await Promise.all([
        api.listResumes(), api.listAnalyses(), api.listSavedJobs(),
      ]);
      setState({
        loading: false, error: null,
        resumes: resumes.resumes, analyses: analyses.analyses, counts: saved.counts,
      });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (state.loading) return <SafeAreaView style={{ flex: 1 }}><Loading /></SafeAreaView>;

  const applied = (state.counts.Applied ?? 0) + (state.counts.Interview ?? 0) +
    (state.counts.Offer ?? 0) + (state.counts.Rejected ?? 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={type.h1}>Hi{user?.fullName ? `, ${user.fullName.split(' ')[0]}` : ''} 🐝</Text>
            <Text style={type.small}>{user?.email}</Text>
          </View>
          <Pressable onPress={signOut} hitSlop={8}>
            <Text style={{ color: colors.honeyDark, fontWeight: '600' }}>Sign out</Text>
          </Pressable>
        </View>

        {state.error ? <Banner tone="error">{state.error}</Banner> : null}

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
          <Stat label="Resumes" value={state.resumes.length} />
          <Stat label="Analyses" value={state.analyses.length} />
          <Stat label="Applied" value={applied} />
        </View>

        <Card style={{ marginTop: spacing.md }}>
          <Text style={type.h2}>Analyze a resume</Text>
          <Text style={[type.body, { marginVertical: spacing.sm }]}>
            Score one resume against several postings at once and see exactly which
            terms are missing, grouped by category.
          </Text>
          <Button title="Start an analysis" onPress={() => router.push('/(tabs)/analyze')} />
        </Card>

        <Text style={[type.h2, { marginTop: spacing.sm, marginBottom: spacing.sm }]}>Recent analyses</Text>

        {state.analyses.length === 0 ? (
          <Card>
            <Empty
              title="Nothing analyzed yet"
              body="Upload a resume and compare it against a few postings to get your first score."
            />
          </Card>
        ) : (
          state.analyses.slice(0, 8).map((a) => (
            <Pressable key={a.id} onPress={() => router.push(`/analysis/${a.id}`)}>
              <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <ScoreBadge score={a.score} size="sm" />
                  <View style={{ flex: 1 }}>
                    <Text style={type.h3} numberOfLines={1}>{a.job_title}</Text>
                    <Text style={type.small} numberOfLines={1}>
                      {a.company ?? 'Pasted description'} · {a.resume_title}
                    </Text>
                  </View>
                </View>
              </Card>
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }) {
  return (
    <View style={{
      flex: 1, backgroundColor: colors.surface, borderRadius: 12,
      borderWidth: 1, borderColor: colors.line, padding: spacing.md, alignItems: 'center',
    }}>
      <Text style={{ fontSize: 24, fontWeight: '700', color: colors.ink }}>{value}</Text>
      <Text style={type.small}>{label}</Text>
    </View>
  );
}
