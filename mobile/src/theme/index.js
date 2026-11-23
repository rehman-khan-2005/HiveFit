// HiveFit visual language — a hive palette (amber on charcoal) with a
// score-band scale reused everywhere a number is shown, so a colour always
// means the same thing to the user.

export const colors = {
  honey: '#F5A623',
  honeyDark: '#D48806',
  honeyFaint: '#FFF4E0',

  ink: '#1C1B1A',
  slate: '#4A4643',
  muted: '#8A8580',
  line: '#E6E1DA',
  surface: '#FFFFFF',
  canvas: '#FAF8F5',

  strong: '#2E7D32',
  moderate: '#F5A623',
  weak: '#E8710A',
  poor: '#C62828',

  danger: '#C62828',
};

/** Colour for a verdict band returned by the API. */
export function bandColor(band) {
  return colors[band] ?? colors.muted;
}

/**
 * Colour for a relative fit tone from the API.
 *
 * This is the primary scale now. The absolute one below is kept for the
 * breakdown page, where the raw figure is shown on purpose, but it is not what
 * a list of postings is coloured by: measured against real listings, every one
 * of them lands in the bottom absolute band, so an absolute scale paints the
 * whole screen red and tells the user nothing.
 */
export function fitColor(tone) {
  if (tone === 'green') return colors.strong;
  if (tone === 'amber') return colors.moderate;
  return colors.muted;
}

/**
 * Colour for a raw 0-100 score, matching the API's band thresholds.
 *
 * Only for places that deliberately show the absolute number. See fitColor
 * for why a list is not coloured this way.
 */
export function scoreColor(score) {
  // Thresholds match verdictFor() in server/src/nlp/analyze.js. If those move,
  // these move with them, or a colour stops meaning what the band says.
  if (score >= 80) return colors.strong;
  if (score >= 60) return colors.moderate;
  if (score >= 40) return colors.weak;
  return colors.poor;
}

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

export const type = {
  h1: { fontSize: 28, fontWeight: '700', color: colors.ink },
  h2: { fontSize: 20, fontWeight: '700', color: colors.ink },
  h3: { fontSize: 16, fontWeight: '600', color: colors.ink },
  body: { fontSize: 15, color: colors.slate, lineHeight: 22 },
  small: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  mono: { fontSize: 13, fontVariant: ['tabular-nums'], color: colors.slate },
};

export const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
};
