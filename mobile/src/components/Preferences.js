// The "what do you want to see" dropdown.
//
// Built from the option list the API sends rather than from a copy kept here.
// A hardcoded list in the client is how an app starts offering a choice the
// server rejects, and the server is already the thing that validates.
//
// Saving is optimistic: the choice applies immediately and the request goes
// out behind it. A dropdown that waits for a round trip before the list
// re-renders feels broken, and the worst case is a preference that does not
// persist — which the error line says.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';

import { api } from '../api/client';
import { colors, spacing, type, radius } from '../theme';

/**
 * @param {object}   value     current preferences, or null while loading
 * @param {object[]} schema    the option list from the API
 * @param {function} onChange  called with the full new set, before it is saved
 */
export function PreferencesPanel({ value, schema, onChange, summary }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);

  const choose = useCallback(async (key, option) => {
    setError(null);
    const next = { ...value, [key]: option };
    onChange(next);
    try {
      await api.savePreferences({ [key]: option });
    } catch (err) {
      // The choice still applies for this session; only persistence failed.
      setError(`Not saved for next time: ${err.message}`);
    }
  }, [value, onChange]);

  if (!value || !schema?.length) return null;

  return (
    <View style={{ marginBottom: spacing.sm }}>
      <Pressable onPress={() => setOpen((v) => !v)}>
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
          paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
          backgroundColor: colors.surface,
        }}>
          <View style={{ flex: 1 }}>
            <Text style={type.h3}>What you see</Text>
            {summary ? <Text style={type.small} numberOfLines={1}>{summary}</Text> : null}
          </View>
          <Text style={[type.h3, { color: colors.honeyDark }]}>{open ? '▲' : '▼'}</Text>
        </View>
      </Pressable>

      {open ? (
        <View style={{
          marginTop: spacing.xs, borderWidth: 1, borderColor: colors.line,
          borderRadius: radius.md, backgroundColor: colors.surface, padding: spacing.md,
        }}>
          {schema.map((pref, index) => (
            <View key={pref.key} style={{ marginTop: index === 0 ? 0 : spacing.md }}>
              <Text style={type.h3}>{pref.label}</Text>
              {pref.help ? (
                <Text style={[type.small, { marginBottom: spacing.xs }]}>{pref.help}</Text>
              ) : null}

              {pref.options.map((option) => {
                const selected = value[pref.key] === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => choose(pref.key, option.value)}
                    style={{
                      flexDirection: 'row', alignItems: 'flex-start',
                      paddingVertical: spacing.xs,
                    }}
                  >
                    {/* A filled dot rather than a checkbox: these are one-of,
                        and a checkbox implies several can be on. */}
                    <View style={{
                      width: 18, height: 18, borderRadius: 9, marginTop: 2, marginRight: spacing.sm,
                      borderWidth: 2,
                      borderColor: selected ? colors.honeyDark : colors.line,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      {selected ? (
                        <View style={{
                          width: 8, height: 8, borderRadius: 4, backgroundColor: colors.honeyDark,
                        }} />
                      ) : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[type.body, selected && { color: colors.ink, fontWeight: '600' }]}>
                        {option.label}
                      </Text>
                      <Text style={type.small}>{option.help}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}

          {error ? (
            <Text style={[type.small, { color: colors.danger, marginTop: spacing.sm }]}>{error}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Preferences held for a screen, loaded once.
 *
 * The analysis response already carries the user's preferences, so this is for
 * screens that need them without running an analysis first — the job list.
 * Defaults are null until loaded rather than guessed, so nothing renders a
 * filtered list and then re-renders it differently a moment later.
 */
export function usePreferences() {
  const [value, setValue] = useState(null);
  const [schema, setSchema] = useState([]);

  useEffect(() => {
    let cancelled = false;
    api.getPreferences()
      .then((result) => {
        if (cancelled) return;
        setValue(result.preferences);
        setSchema(result.schema);
      })
      // A failure here is not worth interrupting the screen for: the list
      // renders unfiltered, which is the default anyway.
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return { value, schema, setValue };
}

/** One line naming the choices that are doing something. */
export function describePreferences(value, schema) {
  if (!value || !schema?.length) return null;

  const active = [];
  for (const pref of schema) {
    if (value[pref.key] === pref.default) continue;
    const option = pref.options.find((o) => o.value === value[pref.key]);
    if (option) active.push(option.label);
  }

  return active.length === 0 ? 'Showing everything' : active.join(' · ');
}
