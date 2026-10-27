import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { api } from '../../src/api/client';
import { Card, Banner, Empty, Loading, Chip, ApplyLink } from '../../src/components/ui';
import { colors, spacing, type } from '../../src/theme';

// The five lifecycle states from the ERD.
const STATUSES = ['Saved', 'Applied', 'Interview', 'Offer', 'Rejected'];

const STATUS_COLOR = {
  Saved: colors.muted,
  Applied: colors.honeyDark,
  Interview: '#1565C0',
  Offer: colors.strong,
  Rejected: colors.danger,
};

export default function TrackerScreen() {
  const [saved, setSaved] = useState([]);
  const [counts, setCounts] = useState({});
  const [filter, setFilter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (status = filter) => {
    try {
      const payload = await api.listSavedJobs(status ?? undefined);
      setSaved(payload.savedJobs);
      setCounts(payload.counts);
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, [filter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function advance(job, status) {
    try {
      await api.updateSavedJob(job.id, { status });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(job) {
    try {
      await api.deleteSavedJob(job.id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <SafeAreaView style={{ flex: 1 }}><Loading /></SafeAreaView>;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: spacing.md }}>
        <Text style={type.h1}>Tracker</Text>
        <Text style={[type.small, { marginBottom: spacing.md }]}>
          Every application, from saved through offer.
        </Text>

        {error ? <Banner tone="error">{error}</Banner> : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm }}>
          <Chip
            label={`All (${Object.values(counts).reduce((a, b) => a + b, 0)})`}
            selected={filter === null}
            onPress={() => { setFilter(null); load(null); }}
          />
          {STATUSES.map((s) => (
            <Chip
              key={s}
              label={`${s} (${counts[s] ?? 0})`}
              selected={filter === s}
              onPress={() => { setFilter(s); load(s); }}
            />
          ))}
        </View>

        {saved.length === 0 ? (
          <Card>
            <Empty
              title="Nothing tracked yet"
              body="Save a posting from the Jobs tab and it will appear here."
            />
          </Card>
        ) : saved.map((job) => (
          <Card key={job.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text style={type.h3}>{job.title}</Text>
                <Text style={type.small}>
                  {job.company ?? 'Unknown'}{job.location ? ` · ${job.location}` : ''}
                </Text>
                {/* Kept in the tracker rather than removed: an application in
                    progress against a posting that has closed is something the
                    user needs to know, not something to quietly delete. */}
                {job.expired_at ? (
                  <Text style={[type.small, { marginTop: 2, color: colors.danger }]}>
                    No longer listed — this posting has come down since you saved it.
                  </Text>
                ) : null}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: STATUS_COLOR[job.status] }}>
                  {job.status.toUpperCase()}
                </Text>
                <ApplyLink url={job.url} label="Open" compact style={{ marginTop: 4 }} />
              </View>
            </View>

            <Text style={[type.small, { marginTop: spacing.sm, marginBottom: spacing.xs }]}>
              Move to:
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {STATUSES.filter((s) => s !== job.status).map((s) => (
                <Chip key={s} label={s} onPress={() => advance(job, s)} />
              ))}
            </View>

            <Pressable onPress={() => remove(job)} hitSlop={8} style={{ marginTop: spacing.xs }}>
              <Text style={{ color: colors.danger, fontSize: 13 }}>Remove</Text>
            </Pressable>
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
