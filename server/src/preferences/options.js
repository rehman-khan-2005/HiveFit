// What the user can change about what they see, defined once.
//
// The list is the single source of truth: the API validates against it, the
// API advertises it, and the interface builds its dropdown from it. A hardcoded
// option list in the client is how a server starts rejecting a choice the UI
// still offers.
//
// Stored as VARCHAR rather than ENUM. An ENUM puts the option list in the
// schema, which means a migration every time a choice is added or reworded,
// and two places that have to agree about what is valid.

export const PREFERENCES = [
  {
    key: 'scoreDisplay',
    column: 'score_display',
    label: 'Match strength',
    help: 'A percentage reads as a grade. It is not one — see the note on the analysis page.',
    default: 'band',
    options: [
      {
        value: 'band',
        label: 'Colour only',
        help: 'Green, amber or grey, and where each posting ranks in the set.',
      },
      {
        value: 'percentage',
        label: 'Colour and number',
        help: 'Adds the raw coverage figure. Useful for the report, misleading on its own.',
      },
    ],
  },
  {
    key: 'hideBelow',
    column: 'hide_below',
    label: 'Hide weak matches',
    help: 'Trims the list rather than making you read all of it.',
    default: 'nothing',
    options: [
      { value: 'nothing', label: 'Show everything', help: 'Every posting you compared.' },
      { value: 'far', label: 'Hide the weakest', help: 'Drops the grey band.' },
      { value: 'near', label: 'Closest only', help: 'Green band only.' },
    ],
  },
  {
    key: 'locationScope',
    column: 'location_scope',
    label: 'Where you will work',
    help: 'Applies to the job pool and to results.',
    default: 'any',
    options: [
      { value: 'any', label: 'Anywhere', help: 'No location filtering.' },
      { value: 'domestic', label: 'United States only', help: 'Drops postings located elsewhere.' },
      { value: 'remote', label: 'Remote only', help: 'Only postings that say remote.' },
    ],
  },
  {
    key: 'detailLevel',
    column: 'detail_level',
    label: 'How much detail',
    help: 'The full analysis is long. Summary keeps the parts you act on.',
    default: 'full',
    options: [
      { value: 'full', label: 'Everything', help: 'Every section of the breakdown.' },
      {
        value: 'summary',
        label: 'Just what to do',
        help: 'The tailoring steps and the skills you already have. Hides the measurement sections.',
      },
    ],
  },
];

export const DEFAULTS = Object.fromEntries(
  PREFERENCES.map((pref) => [pref.key, pref.default])
);

/** The option list as the API advertises it, without the column names. */
export function preferenceSchema() {
  return PREFERENCES.map(({ key, label, help, default: fallback, options }) => ({
    key, label, help, default: fallback, options,
  }));
}

/**
 * Keep only recognized keys with recognized values.
 *
 * A rejected value is dropped rather than erroring the request: a client built
 * against an older option list should still be able to save the choices it does
 * understand, and the response says what was stored.
 */
export function sanitize(input = {}) {
  const clean = {};
  for (const pref of PREFERENCES) {
    const value = input[pref.key];
    if (value === undefined) continue;
    if (pref.options.some((option) => option.value === value)) clean[pref.key] = value;
  }
  return clean;
}
