import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { api } from '../../src/api/client';
import {
  Card, Button, Field, Banner, Loading, ScoreBadge, Chip, ApplyLink,
} from '../../src/components/ui';
import { CategoryCoverage } from '../../src/components/charts';
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

  /**
   * Jump from a buried skill straight into Select-a-Bullet.
   *
   * Picks the bullet the analysis is most confident about — one whose entry
   * already declares the term — so the common case is one tap. The user still
   * chooses whether to keep whatever comes back; nothing is applied here.
   */
  function surfaceSkill(item) {
    const best = (item.candidateBullets ?? []).find((c) => c.confident)
      ?? (item.candidateBullets ?? [])[0];
    const match = bullets.find((b) => b.text === best?.text);

    setSuggestion(null);
    setEvidence('');
    if (match) setSelectedBullet(match.text);
    setSelectedTerms((cur) => (cur.includes(item.term) ? cur : [...cur, item.term]));
  }

  if (error && !data) return <View style={{ padding: spacing.lg }}><Banner tone="error">{error}</Banner></View>;
  if (!data) return <Loading />;

  // Two different questions wear the same "needs_input" status. When every open
  // term is one the resume already claims, we are asking where it belongs — not
  // whether the user has it — and the wording has to follow.
  const placementOnly =
    (suggestion?.evidence?.fromResume?.length ?? 0) > 0 &&
    (suggestion?.evidence?.fromBullet?.length ?? 0) === 0 &&
    (suggestion?.evidence?.fromEntry?.length ?? 0) === 0;

  const { analysis } = data;
  const gap = analysis.keywordGap ?? [];
  const buried = analysis.underhighlighted ?? [];

  // Bullets arrive from the analysis with their entry context and their own
  // ranked terms. Older analyses predate that, so fall back to the flat list.
  const bullets = analysis.bullets?.length
    ? analysis.bullets
    : (resume?.bullets ?? []).map((text) => ({ text, entryTitle: null, entryTech: [], targets: [] }));

  // Group by the entry each bullet belongs to. A flat wall of sentences gives
  // the reader no way to tell which job or project they are looking at, which
  // is exactly the context needed to judge whether a term belongs there.
  const groups = [];
  for (const bullet of bullets) {
    const title = bullet.entryTitle ?? 'Other';
    const group = groups.find((g) => g.title === title);
    if (group) group.bullets.push(bullet);
    else groups.push({ title, tech: bullet.entryTech ?? [], bullets: [bullet] });
  }

  const current = bullets.find((b) => b.text === selectedBullet) ?? null;
  const targets = current?.targets ?? [];

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
            {analysis.job.expiredAt ? (
              <Text style={[type.small, { marginTop: 2, color: colors.danger }]}>
                This posting has come down since you analysed it.
              </Text>
            ) : null}
          </View>
        </View>

        <ApplyLink
          url={analysis.job.url}
          label={analysis.job.expiredAt ? 'Open the original posting' : 'Apply to this job'}
          style={{ marginTop: spacing.md }}
        />
      </Card>

      {/* Transparent scoring — the differentiator against a bare percentage. */}
      <Card>
        <Text style={type.h2}>Why this score</Text>
        <Text style={[type.small, { marginBottom: spacing.md }]}>
          Each category is weighted by how much this posting emphasizes it. A category
          the posting never asks about reads N/A, not 100% — there is nothing there to
          cover.
        </Text>
        <CategoryCoverage categories={analysis.categories ?? []} />

        {/* The three figures side by side, so the methodology is inspectable
            rather than a single number taken on trust. */}
        {analysis.retrieval != null ? (
          <View style={{ marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm }}>
            <Text style={type.h3}>How this was measured</Text>
            <Text style={[type.small, { marginTop: 2 }]}>
              Requirement coverage {analysis.score}% · BM25 retrieval {analysis.retrieval}%
              {analysis.similarity != null ? ` · TF-IDF cosine ${analysis.similarity}%` : ''}
            </Text>
            <Text style={[type.small, { marginTop: 2 }]}>
              Coverage is the headline: it asks how much of what this posting requires
              your resume contains. The other two are reported so the number can be
              checked rather than believed.
            </Text>
          </View>
        ) : null}
      </Card>

      {/* Skills the resume has but does not demonstrate. Deliberately separate
          from the gap list below: nothing here needs the user to claim
          anything new, so it is the cheapest fix on the page. */}
      {buried.length > 0 ? (
        <Card>
          <Text style={type.h2}>You have these — they just aren't visible</Text>
          <Text style={[type.small, { marginBottom: spacing.md }]}>
            This posting asks for {buried.length === 1 ? 'a skill' : `${buried.length} skills`} your
            resume already claims, but no accomplishment shows you using
            {buried.length === 1 ? ' it' : ' them'}. The keyword scan counts these; the
            person who reads your resume next will not.
          </Text>

          {buried.map((item) => (
            <View
              key={item.stem}
              style={{
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: 10,
                padding: spacing.md,
                marginBottom: spacing.xs,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Text style={type.h3}>{item.term}</Text>
                <Chip label={item.importance} tone={item.importance} />
              </View>
              <Text style={[type.small, { marginTop: 2 }]}>{item.foundIn}</Text>
              <Text style={[type.body, { fontSize: 14, marginTop: spacing.xs }]}>{item.action}</Text>

              <Button
                title="Work it into a bullet"
                variant="ghost"
                onPress={() => surfaceSkill(item)}
                style={{ marginTop: spacing.sm }}
              />
            </View>
          ))}
        </Card>
      ) : null}

      {/* Select-a-Bullet */}
      <Card>
        <Text style={type.h2}>Improve a bullet</Text>
        <Text style={[type.small, { marginBottom: spacing.sm }]}>
          You choose which bullet to work on, and whether to use what comes back.
        </Text>

        {groups.map((group) => (
          <View key={group.title} style={{ marginBottom: spacing.md }}>
            <Text style={[type.h3, { marginBottom: 2 }]}>{group.title}</Text>
            {group.tech.length > 0 ? (
              <Text style={[type.small, { marginBottom: spacing.xs }]}>
                {group.tech.join(' · ')}
              </Text>
            ) : null}

            {group.bullets.map((bullet) => {
              const isSelected = selectedBullet === bullet.text;
              return (
                <View key={bullet.text}>
                  <Pressable
                    onPress={() => {
                      setSelectedBullet(isSelected ? null : bullet.text);
                      setSuggestion(null);
                      setSelectedTerms([]);
                      setEvidence('');
                    }}
                  >
                    <View style={{
                      flexDirection: 'row',
                      gap: spacing.sm,
                      borderWidth: isSelected ? 2 : 1,
                      borderColor: isSelected ? colors.honeyDark : colors.line,
                      backgroundColor: isSelected ? colors.honeyFaint : colors.surface,
                      borderRadius: 10,
                      padding: spacing.md,
                      marginBottom: spacing.xs,
                    }}>
                      <Text style={{ color: colors.honeyDark, fontSize: 15, lineHeight: 22 }}>•</Text>
                      <Text style={[type.body, { flex: 1, fontSize: 14, lineHeight: 22 }]}>
                        {bullet.text}
                      </Text>
                    </View>
                  </Pressable>

                  {/* The term picker lives under the bullet it belongs to.
                      Detached from the list, it read as one global set of
                      terms — which is exactly what it used to be. */}
                  {isSelected ? (
                    <View style={{
                      borderLeftWidth: 2,
                      borderLeftColor: colors.honeyDark,
                      paddingLeft: spacing.md,
                      marginBottom: spacing.md,
                    }}>
                      <Text style={type.h3}>What should this bullet pick up?</Text>
                      <Text style={[type.small, { marginBottom: spacing.xs }]}>
                        Ranked for this bullet specifically — green needs no confirmation,
                        the rest will ask you a question first.
                      </Text>

                      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                        {targets.map((t) => (
                          <Chip
                            key={t.stem}
                            label={t.evidence === 'entry' ? `✓ ${t.term}` : t.term}
                            tone={t.evidence === 'entry' ? 'success'
                              : t.evidence === 'resume' ? 'important' : 'neutral'}
                            selected={selectedTerms.includes(t.term)}
                            onPress={() => setSelectedTerms((cur) =>
                              cur.includes(t.term) ? cur.filter((x) => x !== t.term) : [...cur, t.term])}
                          />
                        ))}
                      </View>

                      {targets.length === 0 ? (
                        <Text style={type.small}>
                          This bullet already covers what the posting asks of it. Pick another,
                          or rewrite this one for structure alone.
                        </Text>
                      ) : null}

                      {/* Why each selected term was offered here, rather than
                          making the user guess what the colours mean. */}
                      {targets.filter((t) => selectedTerms.includes(t.term)).map((t) => (
                        <Text key={`why-${t.stem}`} style={[type.small, { marginTop: spacing.xs }]}>
                          <Text style={{ fontWeight: '700' }}>{t.term}</Text> — {t.reason}
                        </Text>
                      ))}

                      <Button
                        title="Suggest a revision"
                        onPress={() => requestSuggestion()}
                        loading={busy}
                        style={{ marginTop: spacing.sm }}
                      />
                    {suggestion ? (
                      <View style={{ marginTop: spacing.lg }}>
                        {suggestion.status === 'needs_input' ? (
                          // The honest-AI path: a gap it will not write for you.
                          <>
                            <Banner>{suggestion.question}</Banner>
                            <Field
                              label={placementOnly
                                ? 'Describe how you used it in this work'
                                : 'If you have this experience, describe it'}
                              value={evidence}
                              onChangeText={setEvidence}
                              placeholder={placementOnly
                                ? 'e.g. I wrote the Power BI refresh scripts in Python'
                                : 'e.g. I ran our staging cluster on Kubernetes for a year'}
                              multiline
                              numberOfLines={3}
                              style={{ minHeight: 70, textAlignVertical: 'top' }}
                            />
                            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                              <Button
                                title={placementOnly ? 'Yes, I used it here' : 'I have this experience'}
                                onPress={() => requestSuggestion(evidence)}
                                disabled={evidence.trim().length < 10}
                                loading={busy}
                                style={{ flex: 1 }}
                              />
                              <Button
                                title={placementOnly ? 'It belongs elsewhere' : 'Skip this'}
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
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}

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
