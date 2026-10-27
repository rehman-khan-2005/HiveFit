// Charts, built from Views.
//
// No charting dependency on purpose: every form here is a magnitude
// comparison across a handful of labelled rows, which is a horizontal bar —
// and a horizontal bar is a box of a given width. Adding react-native-svg and
// a chart library to draw rectangles would cost a dependency, a build step and
// a bundle, and buy nothing the layout engine does not already do.
//
// Horizontal rather than vertical throughout, because every category here has
// a long name ("Tools & Platforms", "Machine Learning Engineer") and rotated
// axis labels are unreadable.
//
// Two rules from the design language are load-bearing:
//
//   Colour never carries meaning alone. The score bands are a status scale
//   (strong / moderate / weak / poor), and a status scale ships with its label
//   — so every coloured bar is accompanied by its band word and its number.
//   Four bands on a green-amber-orange-red ramp cannot be told apart by hue
//   alone at the adjacent steps; the label is what makes them unambiguous, for
//   a colourblind reader and for everyone else.
//
//   Text does not wear the data colour. The bar carries the hue; the value and
//   the labels stay in ink, so a number is legible whatever its band.

import React from 'react';
import { View, Text } from 'react-native';
import { colors, spacing, type, scoreColor } from '../theme';

// Mark specs, fixed across every chart here.
const BAR = 10;          // thickness; well under the 24px cap, leaving air
const RADIUS = 4;        // rounded data-end, square at the baseline
const GAP = 2;           // surface gap between touching marks

/**
 * One bar. Grows from a single baseline on the left.
 *
 * @param {number|null} value  0-100; null renders the track alone (N/A)
 */
export function Bar({ value, tint = colors.honeyDark, track = colors.line }) {
  const applicable = value != null && Number.isFinite(value);

  return (
    <View style={{
      height: BAR,
      backgroundColor: track,
      borderRadius: RADIUS,
      overflow: 'hidden',
    }}>
      {applicable ? (
        <View style={{
          // A 0% bar still shows a sliver, so "measured and zero" is visibly
          // different from "not measured".
          width: `${Math.max(1.5, Math.min(100, value))}%`,
          height: '100%',
          backgroundColor: tint,
          // Square where it meets the baseline, rounded at the data end.
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
          borderTopRightRadius: RADIUS,
          borderBottomRightRadius: RADIUS,
        }} />
      ) : null}
    </View>
  );
}

/** A labelled row: name on top, value at the right, bar beneath. */
function BarRow({ label, value, display, tint, note, emphasis }) {
  return (
    <View style={{ marginBottom: spacing.sm + GAP }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <Text
          style={[type.body, { fontSize: 13, fontWeight: emphasis ? '700' : '500', flex: 1 }]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {/* Ink, not the data colour — a value has to stay readable in every band. */}
        <Text style={[type.mono, { fontSize: 13, color: colors.ink, marginLeft: spacing.sm }]}>
          {display}
        </Text>
      </View>

      <View style={{ marginTop: 4 }}>
        <Bar value={value} tint={tint} />
      </View>

      {note ? <Text style={[type.small, { marginTop: 2 }]}>{note}</Text> : null}
    </View>
  );
}

/**
 * Score across the pool of compared postings, best match first.
 *
 * Deliberately absent for a single posting: a one-bar bar chart is not a
 * chart, and the score badge already says that number.
 */
export function PoolDistribution({ results, average }) {
  if (!results || results.length < 2) return null;

  return (
    <View>
      {results.map((r) => (
        <BarRow
          key={r.analysisId ?? r.jobId ?? r.title}
          label={`${r.rank}. ${r.title ?? 'Posting'}`}
          value={r.score}
          display={`${r.score}%`}
          tint={scoreColor(r.score)}
          // The band word is what makes the colour unambiguous.
          note={`${r.verdict?.band ?? ''}${r.company ? ` · ${r.company}` : ''}`}
        />
      ))}

      {Number.isFinite(average) ? (
        <Text style={[type.small, { marginTop: spacing.xs }]}>
          Average across the pool: {average}%
        </Text>
      ) : null}
    </View>
  );
}

/**
 * How often each missing term recurs across the pool.
 *
 * One hue for every bar. The bar length already encodes the count, so tinting
 * each bar by its own value would spend the colour channel restating the
 * geometry — and these terms have no natural order to justify a ramp.
 */
export function GapFrequency({ gaps, postingsCompared }) {
  if (!gaps || gaps.length === 0 || !postingsCompared) return null;

  return (
    <View>
      {gaps.map((gap) => (
        <BarRow
          key={gap.term}
          label={gap.term}
          value={(gap.appearsInPostings / postingsCompared) * 100}
          display={`${gap.appearsInPostings}/${postingsCompared}`}
          tint={colors.honeyDark}
          note={gap.categoryLabel ?? gap.label ?? null}
        />
      ))}
    </View>
  );
}

/**
 * Per-category coverage, with the not-applicable case shown as such.
 *
 * A category the posting never mentions has no coverage to report. It used to
 * read 100%, which flatters the resume for something it was never measured on.
 */
export function CategoryCoverage({ categories }) {
  if (!categories || categories.length === 0) return null;

  return (
    <View>
      {categories.map((c) => {
        const applicable = c.applicable !== false && c.coverage != null;
        return (
          <BarRow
            key={c.category}
            label={c.label}
            value={applicable ? c.coverage : null}
            display={applicable ? `${c.coverage}%` : 'N/A'}
            tint={applicable ? scoreColor(c.coverage) : colors.muted}
            note={applicable
              ? `${c.termsMatched}/${c.termsRequired} matched · ${c.weightInPosting}% of this posting`
              : 'Not asked for in this posting'}
          />
        );
      })}
    </View>
  );
}
