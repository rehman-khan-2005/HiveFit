import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';

import { api } from '../../src/api/client';
import {
  Card, Button, Field, Banner, Empty, Loading, ScoreBadge, Chip, ApplyLink,
} from '../../src/components/ui';
import { PoolDistribution, GapFrequency } from '../../src/components/charts';
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
  const [pool, setPool] = useState(null);
  const [field, setField] = useState(null);
  const [skillFilter, setSkillFilter] = useState([]);
  // Titles of everything selected, kept as they are picked. Selections survive
  // a change of field, so the picker needs a name for an id that is no longer
  // in the loaded pool — otherwise "6 selected" is unreviewable.
  const [selectedMeta, setSelectedMeta] = useState({});

  const loadJobs = useCallback(async (nextField, nextSkills = []) => {
    // Ask for the maximum the API will serve; the picker below is built to
    // stay usable at that size, and a short list is the thing users notice.
    const j = await api.searchJobs('', '', 50, nextField ?? undefined, nextSkills);
    setJobs(j.jobs);
    setPool({
      provider: j.provider,
      live: j.live,
      field: j.field ?? null,
      fieldLabel: j.fieldLabel ?? null,
      fieldCounts: j.fieldCounts ?? [],
      fields: j.fields ?? [],
      maxComparable: j.maxComparable ?? 20,
      skillOptions: j.skillOptions ?? [],
      askedFor: j.query,
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const [r] = await Promise.all([api.listResumes(), loadJobs(field, skillFilter)]);
      setResumes(r.resumes);
      if (r.resumes.length > 0) setSelectedResume((cur) => cur ?? r.resumes[0].id);
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, [field, skillFilter, loadJobs]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  /** Re-pull the pool for a new field or skill filter. */
  async function refilter(nextField, nextSkills) {
    setField(nextField);
    setSkillFilter(nextSkills);
    setError(null);
    setBusy(true);
    try {
      await loadJobs(nextField, nextSkills);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

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

  const maxComparable = pool?.maxComparable ?? 20;

  function remember(list) {
    setSelectedMeta((cur) => {
      const next = { ...cur };
      for (const job of list) next[job.id] = { title: job.title, company: job.company };
      return next;
    });
  }

  function toggleJob(id) {
    setSelectedJobs((cur) => {
      if (cur.includes(id)) return cur.filter((j) => j !== id);
      // Silently dropping the tap would look broken; the picker disables the
      // row and says why instead, so reaching here at the cap is a no-op.
      if (cur.length >= maxComparable) return cur;
      const job = jobs.find((j) => j.id === id);
      if (job) remember([job]);
      return [...cur, id];
    });
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

  const pastedCount = pastedText.trim() ? 1 : 0;
  const canRun = selectedResume
    && (selectedJobs.length > 0 || pastedCount > 0)
    // A pasted description is a posting too, so it counts against the cap the
    // server enforces — otherwise 20 selected plus a paste is a 400.
    && selectedJobs.length + pastedCount <= maxComparable;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: spacing.md }}>
        <Text style={type.h1}>Analyze</Text>
        <Text style={[type.small, { marginBottom: spacing.md }]}>
          One resume against many postings — see how you stand across the field.
        </Text>

        {error ? <Banner tone="error">{error}</Banner> : null}

        {selectedJobs.length + pastedCount > maxComparable ? (
          <Banner tone="error">
            {selectedJobs.length} selected plus the pasted description is{' '}
            {selectedJobs.length + pastedCount}, over the {maxComparable} posting maximum.
            Deselect one, or clear the pasted text.
          </Banner>
        ) : null}

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

          <JobPicker
            jobs={jobs}
            selected={selectedJobs}
            selectedMeta={selectedMeta}
            onToggle={toggleJob}
            onSetSelection={setSelectedJobs}
            onRemember={remember}
            pool={pool}
            field={field}
            skillFilter={skillFilter}
            onRefilter={refilter}
            maxComparable={maxComparable}
            busy={busy}
          />

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
          title={`Analyze against ${selectedJobs.length + (pastedText.trim() ? 1 : 0)} of ${maxComparable} postings`}
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

/**
 * Compact, filterable posting picker.
 *
 * Replaces a flat wall of chips, which did not survive a real job pool: fifty
 * postings is an unreadable block of truncated text with no way to say "all
 * the backend ones". Three levels of narrowing, because a job board's idea of
 * a relevant result is loose enough to need all three:
 *
 *   field   the industry, which re-queries the board — filtering alone cannot
 *           conjure technology jobs out of a pool of nursing posts
 *   role    the specialty within technology
 *   text    anything the taxonomy misses
 */
function JobPicker({
  jobs, selected, selectedMeta, onToggle, onSetSelection, onRemember,
  pool, field, skillFilter, onRefilter, maxComparable, busy,
}) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState('all');
  const [text, setText] = useState('');

  const atCap = selected.length >= maxComparable;
  const remaining = Math.max(0, maxComparable - selected.length);

  // Role families only mean something inside Technology, and only the ones
  // actually present are worth offering.
  const families = [];
  for (const job of jobs) {
    if (!job.role) continue;
    const found = families.find((f) => f.id === job.role.id);
    if (found) found.count += 1;
    else families.push({ id: job.role.id, label: job.role.label, count: 1 });
  }
  families.sort((a, b) => b.count - a.count);

  const needle = text.trim().toLowerCase();
  const visible = jobs.filter((job) => {
    if (role !== 'all' && job.role?.id !== role) return false;
    if (!needle) return true;
    return `${job.title} ${job.company ?? ''}`.toLowerCase().includes(needle);
  });

  // Select-all adds only what will actually fit. A button that selects fifty
  // postings the analysis then refuses is worse than no button.
  const addable = visible.map((j) => j.id).filter((id) => !selected.includes(id));
  const willAdd = Math.min(addable.length, remaining);

  function selectUpToCap() {
    const take = addable.slice(0, remaining);
    onRemember(visible.filter((j) => take.includes(j.id)));
    onSetSelection([...selected, ...take]);
  }

  return (
    <View>
      <Pressable onPress={() => setOpen((v) => !v)}>
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          borderWidth: 1, borderColor: colors.line, borderRadius: 10,
          padding: spacing.md, backgroundColor: colors.surface,
        }}>
          <View style={{ flex: 1 }}>
            <Text style={type.h3}>
              {selected.length > 0
                ? `${selected.length} of ${maxComparable} selected`
                : 'Choose from the job pool'}
            </Text>
            <Text style={type.small}>
              {jobs.length} available
              {pool?.fieldLabel ? ` in ${pool.fieldLabel}` : ''}
              {pool && !pool.live ? ' · offline sample set' : ''}
            </Text>
          </View>
          <Text style={[type.h3, { color: colors.honeyDark }]}>{open ? '▲' : '▼'}</Text>
        </View>
      </Pressable>

      {open ? (
        <View style={{ marginTop: spacing.sm }}>
          {/* What the user has picked, always visible — selections survive a
              change of field, so some of these are not in the list below. */}
          {selected.length > 0 ? (
            <View style={{ marginBottom: spacing.sm }}>
              <Text style={[type.small, { marginBottom: spacing.xs }]}>
                Selected{atCap ? ` — at the ${maxComparable} posting maximum` : ''}:
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {selected.map((id) => (
                  <Chip
                    key={`sel-${id}`}
                    label={`${(selectedMeta[id]?.title ?? `#${id}`).slice(0, 26)} ✕`}
                    tone="important"
                    onPress={() => onToggle(id)}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {/* Field — the only filter that changes what the board is asked for. */}
          <Text style={[type.small, { marginBottom: 2 }]}>Field</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.xs }}>
            <Chip
              label="All fields"
              selected={!field}
              onPress={() => { setRole('all'); onRefilter(null, skillFilter); }}
            />
            {(pool?.fields ?? []).map((f) => {
              const count = (pool?.fieldCounts ?? []).find((c) => c.id === f.id)?.count ?? 0;
              return (
                <Chip
                  key={f.id}
                  label={count > 0 ? `${f.label} (${count})` : f.label}
                  selected={field === f.id}
                  onPress={() => { setRole('all'); onRefilter(f.id, skillFilter); }}
                />
              );
            })}
          </View>

          {/* Required skills — Li's point about information overload. A term
              in nearly every posting is excluded, since filtering by it would
              narrow nothing. */}
          {(pool?.skillOptions ?? []).length > 0 ? (
            <>
              <Text style={[type.small, { marginBottom: 2 }]}>
                Must mention{skillFilter.length > 0 ? ` (${skillFilter.length} selected)` : ''}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.xs }}>
                {pool.skillOptions.slice(0, 14).map((skill) => {
                  const on = skillFilter.includes(skill.term);
                  return (
                    <Chip
                      key={skill.stem}
                      label={`${skill.term} (${skill.postings})`}
                      selected={on}
                      onPress={() => onRefilter(
                        field,
                        on ? skillFilter.filter((t) => t !== skill.term) : [...skillFilter, skill.term]
                      )}
                    />
                  );
                })}
                {skillFilter.length > 0 ? (
                  <Chip label="Clear skills ✕" tone="important" onPress={() => onRefilter(field, [])} />
                ) : null}
              </View>
            </>
          ) : null}

          {busy ? <Text style={type.small}>Loading {pool?.fieldLabel ?? 'postings'}…</Text> : null}

          {/* Role — meaningful only inside Technology. */}
          {families.length > 1 ? (
            <>
              <Text style={[type.small, { marginBottom: 2 }]}>Specialty</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.xs }}>
                <Chip label={`All (${jobs.length})`} selected={role === 'all'} onPress={() => setRole('all')} />
                {families.map((f) => (
                  <Chip
                    key={f.id}
                    label={`${f.label} (${f.count})`}
                    selected={role === f.id}
                    onPress={() => setRole(f.id)}
                  />
                ))}
              </View>
            </>
          ) : null}

          <Field
            label="Narrow by title or company"
            value={text}
            onChangeText={setText}
            placeholder="e.g. backend, Northwind"
          />

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs }}>
            <Button
              title={willAdd > 0 ? `Select ${willAdd}` : `Full (${maxComparable} max)`}
              variant="ghost"
              onPress={selectUpToCap}
              disabled={willAdd === 0}
              style={{ flex: 1 }}
            />
            {selected.length > 0 ? (
              <Button title="Clear selection" variant="ghost" onPress={() => onSetSelection([])} style={{ flex: 1 }} />
            ) : null}
          </View>

          {atCap ? (
            <Text style={[type.small, { marginBottom: spacing.xs, color: colors.honeyDark }]}>
              {maxComparable} is the most one analysis compares at once. Deselect one to swap
              another in.
            </Text>
          ) : null}

          {visible.map((job) => {
            const isSelected = selected.includes(job.id);
            const blocked = !isSelected && atCap;
            return (
              <Pressable key={job.id} onPress={() => onToggle(job.id)} disabled={blocked}>
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
                  borderWidth: 1,
                  borderColor: isSelected ? colors.honeyDark : colors.line,
                  backgroundColor: isSelected ? colors.honeyFaint : colors.surface,
                  borderRadius: 8, paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
                  marginBottom: 4,
                  opacity: blocked ? 0.45 : 1,
                }}>
                  <Text style={{ fontSize: 15, color: isSelected ? colors.honeyDark : colors.line }}>
                    {isSelected ? '☑' : '☐'}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.body, { fontSize: 14, fontWeight: '600' }]} numberOfLines={1}>
                      {job.title}
                    </Text>
                    <Text style={type.small} numberOfLines={1}>
                      {job.company ?? 'Unknown company'}
                      {job.role ? ` · ${job.role.label}` : job.field ? ` · ${job.field.label}` : ''}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          })}

          {visible.length === 0 ? (
            <Text style={[type.small, { padding: spacing.md }]}>
              {needle || role !== 'all'
                ? 'Nothing matches that narrowing. Clear it, or pick another field.'
                : 'No postings came back for this field.'}
            </Text>
          ) : null}

          {pool && !pool.live ? (
            <Text style={[type.small, { marginTop: spacing.sm }]}>
              These {jobs.length} are the bundled sample postings — the set never changes.
              Set JOBS_PROVIDER in .env to adzuna for live listings.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
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

        {/* Where you stand across the pool, at a glance. Absent for a single
            posting — one bar is not a chart, and the badge already says it. */}
        {results.length > 1 ? (
          <View style={{ marginTop: spacing.md }}>
            <Text style={type.h3}>Score across the pool</Text>
            <Text style={[type.small, { marginBottom: spacing.sm }]}>
              Ranked best match first.
            </Text>
            <PoolDistribution results={results} average={comparison.averageScore} />
          </View>
        ) : null}

        {comparison.bestMatch?.url ? (
          <View style={{ marginTop: spacing.md }}>
            <Text style={type.small}>
              Your strongest match is {comparison.bestMatch.title}
              {comparison.bestMatch.company ? ` at ${comparison.bestMatch.company}` : ''}.
            </Text>
            <ApplyLink
              url={comparison.bestMatch.url}
              label="Apply to your best match"
              style={{ marginTop: spacing.xs }}
            />
          </View>
        ) : null}

        {comparison.recurringUnderhighlighted?.length > 0 ? (
          <View style={{ marginTop: spacing.md }}>
            <Text style={type.h3}>Already yours, across the pool</Text>
            <Text style={[type.small, { marginBottom: spacing.xs }]}>
              Skills several postings want that your resume claims but never demonstrates.
              These need no new experience — only a bullet that shows them.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {comparison.recurringUnderhighlighted.slice(0, 10).map((b) => (
                <Chip key={b.term} label={`${b.term} · ${b.coverage}`} />
              ))}
            </View>
          </View>
        ) : null}

        {comparison.recurringGaps.length > 0 ? (
          <View style={{ marginTop: spacing.md }}>
            <Text style={type.h3}>Gaps that repeat</Text>
            <Text style={[type.small, { marginBottom: spacing.sm }]}>
              How many of these {comparison.postingsCompared} postings ask for each term
              you are missing. Fixing the longest bars lifts several applications at once.
            </Text>
            <GapFrequency
              gaps={comparison.recurringGaps.slice(0, 8)}
              postingsCompared={comparison.postingsCompared}
            />
          </View>
        ) : null}
      </Card>

      {/* Ranked by the server, best match first — the top of this list is
          where the user's afternoon is best spent. */}
      {results.map((r) => (
        <Pressable key={r.analysisId} onPress={() => router.push(`/analysis/${r.analysisId}`)}>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <View style={{ alignItems: 'center', width: 28 }}>
                <Text style={[type.h3, { color: colors.honeyDark }]}>#{r.rank}</Text>
              </View>
              <ScoreBadge score={r.score} size="sm" />
              <View style={{ flex: 1 }}>
                <Text style={type.h3} numberOfLines={1}>{r.title ?? 'Posting'}</Text>
                <Text style={[type.small, { fontWeight: '600' }]} numberOfLines={1}>
                  {r.company ?? 'Pasted description'}
                </Text>
                <Text style={[type.small, { marginTop: 2 }]} numberOfLines={2}>{r.verdict.message}</Text>

                {r.underhighlighted?.length > 0 ? (
                  <Text style={[type.small, { marginTop: 4, color: colors.honeyDark }]}>
                    {r.underhighlighted.length} skill{r.underhighlighted.length === 1 ? '' : 's'} you
                    have but haven't shown: {r.underhighlighted.slice(0, 3).map((u) => u.term).join(', ')}
                  </Text>
                ) : null}

                <View style={{
                  flexDirection: 'row', alignItems: 'center',
                  gap: spacing.md, marginTop: spacing.xs,
                }}>
                  <Text style={[type.small, { color: colors.honeyDark }]}>
                    Tap for the full breakdown →
                  </Text>
                  {/* Sits inside the card's Pressable, so it needs its own
                      press target — otherwise tapping Apply opens the
                      breakdown instead of the posting. */}
                  <ApplyLink url={r.url} compact />
                </View>
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
