import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';

import { api } from '../../src/api/client';
import {
  Card, Button, Field, Banner, Empty, Loading, ScoreBadge, Chip,
} from '../../src/components/ui';
import { colors, spacing, type } from '../../src/theme';

export default function AnalyzeScreen() {
  const router = useRouter();

  const [resumes, setResumes] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [selectedResume, setSelectedResume] = useState(null);
  const [selectedJobs, setSelectedJobs] = useState([]);
  const [pastedTitle, setPastedTitle] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [resumeText, setResumeText] = useState('');
  const [showPasteResume, setShowPasteResume] = useState(false);
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    try {
      const [r, j] = await Promise.all([api.listResumes(), api.searchJobs('')]);
      setResumes(r.resumes);
      setJobs(j.jobs);
      if (r.resumes.length > 0) setSelectedResume((cur) => cur ?? r.resumes[0].id);
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function pickResumeFile() {
    setError(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'text/plain'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;

      const asset = picked.assets[0];
      const form = new FormData();

      // FormData takes a different shape on each platform, and getting this
      // wrong fails silently: web stringifies an unrecognized object to
      // "[object Object]", so the server receives a text field named "file"
      // and reports that no file was attached.
      if (Platform.OS === 'web') {
        // DocumentPicker hands back a real File on web. Older pickers only set
        // uri, so fall back to fetching the blob it points at.
        const blob = asset.file ?? await (await fetch(asset.uri)).blob();
        form.append('file', blob, asset.name);
      } else {
        // React Native's FormData understands this {uri, name, type} shape.
        form.append('file', {
          uri: asset.uri,
          name: asset.name,
          type: asset.mimeType ?? 'application/octet-stream',
        });
      }

      form.append('title', asset.name);

      setBusy(true);
      const { resume, warning } = await api.uploadResume(form);
      if (warning) setError(warning);
      await load();
      setSelectedResume(resume.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveTypedResume() {
    setError(null);
    setBusy(true);
    try {
      const { resume } = await api.createResumeFromText('Pasted resume', resumeText);
      setResumeText('');
      setShowPasteResume(false);
      await load();
      setSelectedResume(resume.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function toggleJob(id) {
    setSelectedJobs((cur) => (cur.includes(id) ? cur.filter((j) => j !== id) : [...cur, id]));
  }

  async function runAnalysis() {
    setError(null);
    setBusy(true);
    setResult(null);
    try {
      const postings = pastedText.trim()
        ? [{ title: pastedTitle.trim() || 'Pasted job description', description: pastedText.trim() }]
        : [];

      const payload = await api.analyze({
        resumeId: selectedResume,
        jobPostingIds: selectedJobs,
        postings,
      });
      setResult(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <SafeAreaView style={{ flex: 1 }}><Loading /></SafeAreaView>;

  const canRun = selectedResume && (selectedJobs.length > 0 || pastedText.trim().length > 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: spacing.md }}>
        <Text style={type.h1}>Analyze</Text>
        <Text style={[type.small, { marginBottom: spacing.md }]}>
          One resume against many postings — see how you stand across the field.
        </Text>

        {error ? <Banner tone="error">{error}</Banner> : null}

        {/* Step 1 — resume */}
        <Card>
          <Text style={type.h2}>1. Pick a resume</Text>

          {resumes.length === 0 ? (
            <Text style={[type.body, { marginTop: spacing.sm }]}>
              No resumes yet. Upload a PDF or paste the text.
            </Text>
          ) : (
            <View style={{ marginTop: spacing.sm }}>
              {resumes.map((r) => (
                <Pressable key={r.id} onPress={() => setSelectedResume(r.id)}>
                  <View style={[
                    styles(selectedResume === r.id).option,
                  ]}>
                    <Text style={type.h3}>{r.title}</Text>
                    <Text style={type.small}>{r.characters} characters</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            <Button title="Upload file" variant="ghost" onPress={pickResumeFile} style={{ flex: 1 }} />
            <Button
              title={showPasteResume ? 'Cancel' : 'Paste text'}
              variant="ghost"
              onPress={() => setShowPasteResume((v) => !v)}
              style={{ flex: 1 }}
            />
          </View>

          {showPasteResume ? (
            <View style={{ marginTop: spacing.md }}>
              <Field
                label="Resume text"
                value={resumeText}
                onChangeText={setResumeText}
                placeholder="Paste your resume here…"
                multiline
                numberOfLines={8}
                style={{ minHeight: 140, textAlignVertical: 'top' }}
              />
              <Button
                title="Save resume"
                onPress={saveTypedResume}
                disabled={resumeText.trim().length < 50}
                loading={busy}
              />
            </View>
          ) : null}
        </Card>

        {/* Step 2 — postings */}
        <Card>
          <Text style={type.h2}>2. Choose postings</Text>
          <Text style={[type.small, { marginBottom: spacing.sm }]}>
            Pick several. Comparing against a pool is what shows whether the gap is
            this one job or your resume overall.
          </Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {jobs.map((j) => (
              <Chip
                key={j.id}
                label={`${j.title} · ${j.company ?? ''}`.trim()}
                selected={selectedJobs.includes(j.id)}
                onPress={() => toggleJob(j.id)}
              />
            ))}
          </View>

          <Text style={[type.h3, { marginTop: spacing.md, marginBottom: spacing.xs }]}>
            …or paste one
          </Text>
          <Field label="Job title" value={pastedTitle} onChangeText={setPastedTitle} placeholder="Backend Engineer" />
          <Field
            label="Job description"
            value={pastedText}
            onChangeText={setPastedText}
            placeholder="Paste the full job description…"
            multiline
            numberOfLines={6}
            style={{ minHeight: 110, textAlignVertical: 'top' }}
          />
        </Card>

        <Button
          title={`Analyze against ${selectedJobs.length + (pastedText.trim() ? 1 : 0)} posting(s)`}
          onPress={runAnalysis}
          disabled={!canRun}
          loading={busy}
        />

        {result ? <Results result={result} router={router} /> : null}
        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Results({ result, router }) {
  const { comparison, results } = result;
  return (
    <View style={{ marginTop: spacing.lg }}>
      <Text style={type.h2}>Results</Text>

      <Card style={{ marginTop: spacing.sm }}>
        <Text style={type.h3}>Across the field</Text>
        <Text style={[type.body, { marginTop: spacing.xs }]}>{comparison.interpretation}</Text>

        <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
          <Metric label="Average" value={`${comparison.averageScore}%`} />
          <Metric label="Best" value={`${comparison.bestScore}%`} />
          <Metric label="Worst" value={`${comparison.worstScore}%`} />
        </View>

        {comparison.recurringGaps.length > 0 ? (
          <View style={{ marginTop: spacing.md }}>
            <Text style={type.h3}>Gaps that repeat</Text>
            <Text style={[type.small, { marginBottom: spacing.xs }]}>
              Fixing these lifts every one of these applications at once.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {comparison.recurringGaps.slice(0, 10).map((g) => (
                <Chip key={g.term} label={`${g.term} · ${g.coverage}`} tone="important" />
              ))}
            </View>
          </View>
        ) : null}
      </Card>

      {results.map((r) => (
        <Pressable key={r.analysisId} onPress={() => router.push(`/analysis/${r.analysisId}`)}>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <ScoreBadge score={r.score} size="sm" />
              <View style={{ flex: 1 }}>
                <Text style={type.h3} numberOfLines={1}>{r.title ?? 'Posting'}</Text>
                <Text style={type.small} numberOfLines={2}>{r.verdict.message}</Text>
                <Text style={[type.small, { marginTop: 2, color: colors.honeyDark }]}>
                  Tap for the full breakdown →
                </Text>
              </View>
            </View>
          </Card>
        </Pressable>
      ))}
    </View>
  );
}

function Metric({ label, value }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>{value}</Text>
      <Text style={type.small}>{label}</Text>
    </View>
  );
}

const styles = (selected) => ({
  option: {
    borderWidth: selected ? 2 : 1,
    borderColor: selected ? colors.honeyDark : colors.line,
    backgroundColor: selected ? colors.honeyFaint : colors.surface,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.xs,
  },
});
