import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { api } from '../../src/api/client';
import { Card, Button, Field, Banner, Empty, Loading, ApplyLink, Chip } from '../../src/components/ui';
import { JobMap } from '../../src/components/JobMap';
import { colors, spacing, type } from '../../src/theme';

export default function JobsScreen() {
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const [jobs, setJobs] = useState([]);
  const [provider, setProvider] = useState(null);
  const [freshness, setFreshness] = useState(null);
  const [sources, setSources] = useState([]);
  const [field, setField] = useState(null);
  const [fields, setFields] = useState([]);
  const [fieldCounts, setFieldCounts] = useState([]);
  const [view, setView] = useState('list');
  const [mapJobs, setMapJobs] = useState([]);
  const [pinned, setPinned] = useState(null);     // postings at a clicked pin
  const [coverage, setCoverage] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savedIds, setSavedIds] = useState(new Set());

  const search = useCallback(async (q = query, loc = location, f = field) => {
    setError(null);
    try {
      const [result, saved] = await Promise.all([
        api.searchJobs(q, loc, 50, f ?? undefined),
        api.listSavedJobs(),
      ]);
      setJobs(result.jobs);
      setProvider(result.provider);
      setFreshness(result.freshness ?? null);
      setSources(result.providers ?? []);
      setFields(result.fields ?? []);
      setFieldCounts(result.fieldCounts ?? []);
      setCoverage(result.coverage ?? null);
      setSavedIds(new Set(saved.savedJobs.map((s) => s.job_posting_id)));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [query, location, field]);

  useFocusEffect(useCallback(() => { search(); }, []));

  /**
   * Pull the postings inside the current viewport.
   *
   * Reads the stored pool rather than re-querying a board, so panning is free.
   */
  const loadBounds = useCallback(async (bbox) => {
    try {
      const result = await api.jobsInBounds(bbox, field ?? undefined, []);
      setMapJobs(result.jobs ?? []);
      setCoverage(result.coverage ?? null);
      setTruncated(Boolean(result.truncated));
      setPinned(null);
    } catch (err) {
      setError(err.message);
    }
  }, [field]);

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
            Showing the offline sample set — it never changes. Set JOBS_PROVIDER in .env
            to adzuna or muse for listings that move.
          </Text>
        ) : (
          <Text style={[type.small, { marginBottom: spacing.sm }]}>
            Live from {sources.filter((s) => s.ok && s.count > 0).map((s) => s.label).join(', ') || 'no source'}.
            {freshness ? ` ${freshness.active} listings open · ${freshness.addedToday} added today · ${freshness.delistedThisWeek} closed this week.` : ''}
          </Text>
        )}

        {/* A provider being down is worth saying out loud: the pool looks
            thinner than it should, and silence would read as "no jobs". */}
        {sources.filter((s) => !s.ok).map((s) => (
          <Banner key={s.name} tone="error">{s.label} is unavailable — {s.error}</Banner>
        ))}

        {error ? <Banner tone="error">{error}</Banner> : null}

        <Card>
          <Field label="What" value={query} onChangeText={setQuery} placeholder="software engineer" />
          <Field label="Where" value={location} onChangeText={setLocation} placeholder="New York" />

          {/* Field is not just a filter — with no search term of its own it
              decides what the board is asked for, which is the difference
              between five technology results and fifty. */}
          <Text style={[type.small, { marginTop: spacing.xs, marginBottom: 2 }]}>Field</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Chip
              label="All fields"
              selected={!field}
              onPress={() => { setField(null); setLoading(true); search(query, location, null); }}
            />
            {fields.map((f) => {
              const count = fieldCounts.find((c) => c.id === f.id)?.count ?? 0;
              return (
                <Chip
                  key={f.id}
                  label={count > 0 ? `${f.label} (${count})` : f.label}
                  selected={field === f.id}
                  onPress={() => { setField(f.id); setLoading(true); search(query, location, f.id); }}
                />
              );
            })}
          </View>

          <Button title="Search" onPress={() => search()} style={{ marginTop: spacing.sm }} />
        </Card>

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
          <Button
            title="List"
            variant={view === 'list' ? 'primary' : 'ghost'}
            onPress={() => setView('list')}
            style={{ flex: 1 }}
          />
          <Button
            title="Map"
            variant={view === 'map' ? 'primary' : 'ghost'}
            onPress={() => setView('map')}
            style={{ flex: 1 }}
          />
        </View>

        {view === 'map' ? (
          <Card>
            <Text style={type.h3}>Jobs by area</Text>
            <Text style={[type.small, { marginBottom: spacing.sm }]}>
              Pan and zoom to an area, then tap a pin to see what is there.
              {coverage
                ? ` ${coverage.mappable} of ${coverage.available} open listings have a location we can place.`
                : ''}
            </Text>

            <JobMap jobs={mapJobs} onBounds={loadBounds} onSelect={setPinned} />

            <Text style={[type.small, { marginTop: spacing.xs }]}>
              {mapJobs.length} listing{mapJobs.length === 1 ? '' : 's'} in view
              {field ? ` · ${fields.find((f) => f.id === field)?.label ?? field}` : ''}
              {' · remote roles have no pin and stay in the list'}
            </Text>

            {truncated ? (
              <Text style={[type.small, { marginTop: 2, color: colors.honeyDark }]}>
                More listings here than the map will draw at once — zoom in to see the rest.
              </Text>
            ) : null}

            {/* What the user clicked, with Apply right there — the point of
                browsing by area is applying from it. */}
            {pinned?.length ? (
              <View style={{ marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm }}>
                <Text style={type.h3}>
                  {pinned.length} job{pinned.length === 1 ? '' : 's'} · {pinned[0].location ?? 'this area'}
                </Text>
                {pinned.slice(0, 12).map((job) => (
                  <View key={job.id} style={{ marginTop: spacing.sm }}>
                    <Text style={[type.body, { fontSize: 14, fontWeight: '600' }]} numberOfLines={2}>
                      {job.title}
                    </Text>
                    <Text style={type.small} numberOfLines={1}>
                      {job.company ?? 'Unknown company'}
                      {job.role?.label ? ` · ${job.role.label}` : job.field?.label ? ` · ${job.field.label}` : ''}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 4 }}>
                      <ApplyLink url={job.url} compact />
                      {!savedIds.has(job.id) ? (
                        <Pressable onPress={() => save(job)} hitSlop={8}>
                          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.honeyDark }}>Save</Text>
                        </Pressable>
                      ) : (
                        <Text style={[type.small, { fontWeight: '700' }]}>Saved ✓</Text>
                      )}
                    </View>
                  </View>
                ))}
                {pinned.length > 12 ? (
                  <Text style={[type.small, { marginTop: spacing.sm }]}>
                    …and {pinned.length - 12} more here. Zoom in to split this pin.
                  </Text>
                ) : null}
              </View>
            ) : null}
          </Card>
        ) : null}

        {view === 'list' ? (loading ? <Loading /> : jobs.length === 0 ? (
          <Card><Empty title="No matches" body="Try a broader search term." /></Card>
        ) : (
          jobs.map((job) => (
            <Card key={job.id}>
              <Text style={type.h3}>{job.title}</Text>
              <Text style={type.small}>
                {job.company ?? 'Unknown company'}{job.location ? ` · ${job.location}` : ''}
              </Text>
              <Text style={[type.small, { color: colors.honeyDark }]}>
                {job.role?.label ?? job.field?.label ?? ''}
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
                <ApplyLink url={job.url} style={{ flex: 1 }} />
              </View>
            </Card>
          ))
        )) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
