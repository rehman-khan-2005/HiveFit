import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { api } from '../../src/api/client';
import {
  Card, Button, Field, Banner, Loading, ScoreBadge, CategoryBar, Chip,
} from '../../src/components/ui';
import { colors, spacing, type } from '../../src/theme';

export default function AnalysisDetail() {
  const { id } = useLocalSearchParams();

  const [data, setData] = useState(null);
  const [resume, setResume] = useState(null);
  const [error, setError] = useState(null);

  const [selectedBullet, setSelectedBullet] = useState(null);
  const [selectedTerms, setSelectedTerms] = useState([]);
  const [suggestion, setSuggestion] = useState(null);
  const [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const payload = await api.getAnalysis(id);
        setData(payload);
        const r = await api.getResume(payload.analysis.resume.id);
        setResume(r.resume);
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [id]);

  async function requestSuggestion(userEvidence = null) {
    setBusy(true);
    setError(null);
    try {
      const { suggestion: s } = await api.suggest({
        analysisId: Number(id),
        bullet: selectedBullet,
        targetTerms: selectedTerms,
        userEvidence,
      });
      setSuggestion(s);
      if (s.status === 'suggested') setEvidence('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function decide(accepted) {
    setBusy(true);
    try {
      await api.decideSuggestion(suggestion.id, accepted);
      setSuggestion((s) => ({ ...s, accepted, status: accepted ? 'accepted' : 'discarded' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <View style={{ padding: spacing.lg }}><Banner tone="error">{error}</Banner></View>;
  if (!data) return <Loading />;

  const { analysis } = data;
  const gap = analysis.keywordGap ?? [];

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ padding: spacing.md }}>
      {error ? <Banner tone="error">{error}</Banner> : null}

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
          <ScoreBadge score={analysis.score} />
          <View style={{ flex: 1 }}>
            <Text style={type.h2}>{analysis.job.title}</Text>
            <Text style={type.small}>{analysis.job.company ?? 'Pasted description'}</Text>
            <Text style={[type.small, { marginTop: spacing.xs }]}>
              Scored against {analysis.resume.title}
            </Text>
          </View>
        </View>
      </Card>

      {/* Transparent scoring — the differentiator against a bare percentage. */}
      <Card>
        <Text style={type.h2}>Why this score</Text>
        <Text style={[type.small, { marginBottom: spacing.md }]}>
          Each category is weighted by how much this posting emphasizes it.
        </Text>
        {(analysis.categories ?? []).map((c) => <CategoryBar key={c.category} category={c} />)}
      </Card>

      {/* Select-a-Bullet */}
      <Card>
        <Text style={type.h2}>Improve a bullet</Text>
        <Text style={[type.small, { marginBottom: spacing.sm }]}>
          You choose which bullet to work on, and whether to use what comes back.
        </Text>

        {(resume?.bullets ?? []).map((b, i) => (
          <Pressable
            key={i}
            onPress={() => { setSelectedBullet(b); setSuggestion(null); setSelectedTerms([]); }}
          >
            <View style={{
              borderWidth: selectedBullet === b ? 2 : 1,
              borderColor: selectedBullet === b ? colors.honeyDark : colors.line,
              backgroundColor: selectedBullet === b ? colors.honeyFaint : colors.surface,
              borderRadius: 10, padding: spacing.md, marginBottom: spacing.xs,
            }}>
              <Text style={[type.body, { fontSize: 14 }]}>{b}</Text>
            </View>
          </Pressable>
        ))}

        {selectedBullet ? (
          <View style={{ marginTop: spacing.md }}>
            <Text style={type.h3}>Which missing terms should it address?</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs }}>
              {gap.slice(0, 12).map((g) => (
                <Chip
                  key={g.stem}
                  label={g.term}
                  tone={g.importance}
                  selected={selectedTerms.includes(g.term)}
                  onPress={() => setSelectedTerms((cur) =>
                    cur.includes(g.term) ? cur.filter((t) => t !== g.term) : [...cur, g.term])}
                />
              ))}
            </View>

            <Button
              title="Suggest a revision"
              onPress={() => requestSuggestion()}
              loading={busy}
              style={{ marginTop: spacing.sm }}
            />
          </View>
        ) : null}

        {suggestion ? (
          <View style={{ marginTop: spacing.lg }}>
            {suggestion.status === 'needs_input' ? (
              // The honest-AI path: a gap it will not write for you.
              <>
                <Banner>{suggestion.question}</Banner>
                <Field
                  label="If you have this experience, describe it"
                  value={evidence}
                  onChangeText={setEvidence}
                  placeholder="e.g. I ran our staging cluster on Kubernetes for a year"
                  multiline
                  numberOfLines={3}
                  style={{ minHeight: 70, textAlignVertical: 'top' }}
                />
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button
                    title="I have this experience"
                    onPress={() => requestSuggestion(evidence)}
                    disabled={evidence.trim().length < 10}
                    loading={busy}
                    style={{ flex: 1 }}
                  />
                  <Button
                    title="Skip this"
                    variant="ghost"
                    onPress={() => { setSuggestion(null); setSelectedTerms([]); }}
                    style={{ flex: 1 }}
                  />
                </View>
              </>
            ) : (
              <>
                <Text style={type.h3}>Suggested revision</Text>
                <View style={{
                  backgroundColor: colors.honeyFaint, borderRadius: 10,
                  padding: spacing.md, marginVertical: spacing.sm,
                  borderWidth: 1, borderColor: '#F3DDB0',
                }}>
                  <Text style={[type.body, { color: colors.ink }]}>{suggestion.suggested}</Text>
                </View>
                <Text style={type.small}>{suggestion.rationale}</Text>

                {suggestion.question ? (
                  <Banner>{suggestion.question}</Banner>
                ) : null}

                {suggestion.status === 'accepted' || suggestion.status === 'discarded' ? (
                  <Text style={[type.small, { marginTop: spacing.sm, fontWeight: '600' }]}>
                    You {suggestion.status === 'accepted' ? 'kept' : 'discarded'} this revision.
                  </Text>
                ) : (
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                    <Button title="Use this" onPress={() => decide(true)} loading={busy} style={{ flex: 1 }} />
                    <Button title="Discard" variant="ghost" onPress={() => decide(false)} style={{ flex: 1 }} />
                  </View>
                )}
              </>
            )}
          </View>
        ) : null}
      </Card>

      {/* Full gap list */}
      <Card>
        <Text style={type.h2}>Missing terms</Text>
        <Text style={[type.small, { marginBottom: spacing.sm }]}>
          Ranked by how much weight this posting puts on them.
        </Text>
        {gap.length === 0
          ? <Text style={type.body}>Nothing missing — this resume covers the posting.</Text>
          : gap.map((g) => (
            <View key={g.stem} style={{
              flexDirection: 'row', justifyContent: 'space-between',
              paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.line,
            }}>
              <View style={{ flex: 1 }}>
                <Text style={type.h3}>{g.term}</Text>
                <Text style={type.small}>{g.label}</Text>
              </View>
              <Text style={{
                fontSize: 12, fontWeight: '700',
                color: g.importance === 'critical' ? colors.poor
                  : g.importance === 'important' ? colors.weak : colors.muted,
              }}>
                {g.importance.toUpperCase()}
              </Text>
            </View>
          ))}
      </Card>

      <View style={{ height: spacing.xl }} />
    </ScrollView>
  );
}
