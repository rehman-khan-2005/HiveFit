import React from 'react';
import {
  View, Text, Pressable, ActivityIndicator, StyleSheet, TextInput, Linking,
} from 'react-native';
import { colors, spacing, radius, type, shadow, scoreColor } from '../theme';

export function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({ title, onPress, variant = 'primary', disabled, loading, style }) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        isPrimary ? styles.buttonPrimary : styles.buttonGhost,
        (disabled || loading) && styles.buttonDisabled,
        pressed && !disabled && { opacity: 0.85 },
        style,
      ]}
    >
      {loading
        ? <ActivityIndicator color={isPrimary ? '#fff' : colors.honeyDark} />
        : <Text style={[styles.buttonText, !isPrimary && { color: colors.honeyDark }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, hint, ...props }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        style={styles.input}
        {...props}
      />
      {hint ? <Text style={[type.small, { marginTop: spacing.xs }]}>{hint}</Text> : null}
    </View>
  );
}

/** Big headline score with the band colour. */
export function ScoreBadge({ score, size = 'lg' }) {
  const dimension = size === 'lg' ? 96 : 56;
  const fontSize = size === 'lg' ? 28 : 17;
  return (
    <View style={[
      styles.scoreBadge,
      { width: dimension, height: dimension, borderRadius: dimension / 2, borderColor: scoreColor(score) },
    ]}>
      <Text style={{ fontSize, fontWeight: '700', color: scoreColor(score) }}>
        {Math.round(score)}
      </Text>
      <Text style={{ fontSize: size === 'lg' ? 11 : 9, color: colors.muted }}>/ 100</Text>
    </View>
  );
}

/** One row of the transparent category breakdown. */
export function Chip({ label, tone = 'neutral', onPress, selected }) {
  const toneStyle =
    tone === 'critical' ? { backgroundColor: '#FDECEA', borderColor: '#F5C6C0' }
      : tone === 'important' ? { backgroundColor: colors.honeyFaint, borderColor: '#F3DDB0' }
        // Green means "already evidenced" — a term that can be written with no
        // further questions. Same meaning everywhere it appears.
        : tone === 'success' ? { backgroundColor: '#E8F5E9', borderColor: '#A5D6A7' }
          : { backgroundColor: colors.canvas, borderColor: colors.line };

  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper
      onPress={onPress}
      style={[styles.chip, toneStyle, selected && { borderColor: colors.honeyDark, borderWidth: 2 }]}
    >
      <Text style={{ fontSize: 13, color: colors.ink }}>{label}</Text>
    </Wrapper>
  );
}

/**
 * Link out to the posting itself.
 *
 * Shared rather than rewritten per screen: this is the one control that ends
 * the whole flow, so it should look and read identically wherever a posting
 * appears. Renders nothing when the provider gave no URL — a dead "Apply"
 * button is worse than no button.
 */
export function ApplyLink({ url, label = 'Apply', style, compact = false }) {
  if (!url) return null;

  if (compact) {
    return (
      <Pressable onPress={() => Linking.openURL(url)} style={style} hitSlop={8}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: colors.honeyDark }}>
          {label} ↗
        </Text>
      </Pressable>
    );
  }

  return (
    <Button title={`${label} ↗`} variant="ghost" onPress={() => Linking.openURL(url)} style={style} />
  );
}

export function Banner({ children, tone = 'info' }) {
  const toneStyle = tone === 'error'
    ? { backgroundColor: '#FDECEA', borderColor: '#F5C6C0' }
    : { backgroundColor: colors.honeyFaint, borderColor: '#F3DDB0' };
  return (
    <View style={[styles.banner, toneStyle]}>
      <Text style={[type.body, { fontSize: 14, color: colors.ink }]}>{children}</Text>
    </View>
  );
}

export function Empty({ title, body }) {
  return (
    <View style={{ padding: spacing.xl, alignItems: 'center' }}>
      <Text style={[type.h3, { marginBottom: spacing.xs }]}>{title}</Text>
      <Text style={[type.small, { textAlign: 'center' }]}>{body}</Text>
    </View>
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <View style={{ padding: spacing.xl, alignItems: 'center' }}>
      <ActivityIndicator color={colors.honeyDark} />
      <Text style={[type.small, { marginTop: spacing.sm }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow,
  },
  button: {
    paddingVertical: 13,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  buttonPrimary: { backgroundColor: colors.honeyDark },
  buttonGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.honeyDark },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  label: { fontSize: 13, fontWeight: '600', color: colors.slate, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  scoreBadge: {
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  track: {
    height: 8, backgroundColor: colors.line, borderRadius: radius.pill,
    marginTop: 6, overflow: 'hidden',
  },
  fill: { height: 8, borderRadius: radius.pill },
  chip: {
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill,
    borderWidth: 1, marginRight: spacing.xs, marginBottom: spacing.xs,
  },
  banner: {
    borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.md,
  },
});
