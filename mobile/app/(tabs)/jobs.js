import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { api } from '../../src/api/client';
import { Card, Button, Field, Banner, Empty, Loading } from '../../src/components/ui';
import { colors, spacing, type } from '../../src/theme';

export default function JobsScreen() {
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const [jobs, setJobs] = useState([]);
  const [provider, setProvider] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savedIds, setSavedIds] = useState(new Set());

  const search = useCallback(async (q = query, loc = location) => {
    setError(null);
    try {
      const [result, saved] = await Promise.all([
        api.searchJobs(q, loc),
        api.listSavedJobs(),
      ]);
      setJobs(result.jobs);
      setProvider(result.provider);
      setSavedIds(new Set(saved.savedJobs.map((s) => s.job_posting_id)));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [query, location]);

  useFocusEffect(useCallback(() => { search(); }, []));

  async function save(job) {
    try {
      await api.saveJob(job.id);
      setSavedIds((cur) => new Set([...cur, job.id]));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: spacing.md }}>
        <Text style={type.h1}>Find jobs</Text>
        {provider === 'fixtures' ? (
          <Text style={[type.small, { marginBottom: spacing.sm }]}>
            Showing the offline sample set. Add Adzuna credentials to .env for live listings.
          </Text>
        ) : null}

        {error ? <Banner tone="error">{error}</Banner> : null}

        <Card>
          <Field label="What" value={query} onChangeText={setQuery} placeholder="software engineer" />
          <Field label="Where" value={location} onChangeText={setLocation} placeholder="New York" />
          <Button title="Search" onPress={() => search()} />
        </Card>

        {loading ? <Loading /> : jobs.length === 0 ? (
          <Card><Empty title="No matches" body="Try a broader search term." /></Card>
        ) : (
          jobs.map((job) => (
            <Card key={job.id}>
              <Text style={type.h3}>{job.title}</Text>
              <Text style={type.small}>
                {job.company ?? 'Unknown company'}{job.location ? ` · ${job.location}` : ''}
              </Text>
              {job.salary_min ? (
                <Text style={[type.small, { color: colors.honeyDark, marginTop: 2 }]}>
                  ${Number(job.salary_min).toLocaleString()} – ${Number(job.salary_max).toLocaleString()}
                </Text>
              ) : null}
              <Text style={[type.body, { fontSize: 14, marginTop: spacing.sm }]} numberOfLines={4}>
                {job.description}
              </Text>

              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                <Button
                  title={savedIds.has(job.id) ? 'Saved ✓' : 'Save'}
                  onPress={() => save(job)}
                  disabled={savedIds.has(job.id)}
                  style={{ flex: 1 }}
                />
                {job.url ? (
                  <Button
                    title="Open"
                    variant="ghost"
                    onPress={() => Linking.openURL(job.url)}
                    style={{ flex: 1 }}
                  />
                ) : null}
              </View>
            </Card>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
