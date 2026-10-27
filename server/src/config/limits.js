// Limits shared between the API and anything that has to respect them.
//
// The comparison cap lives here rather than inline in the analyses route
// because the posting picker has to honour it too: a "select all" that hands
// the server more than it accepts is worse than no button at all, and two
// copies of the number drift the moment one is tuned.

/**
 * Postings one analysis may compare at once.
 *
 * Each posting means its own TF-IDF transform, gap analysis, highlight pass
 * and ats_analyses row, so this is a real cost ceiling rather than an
 * arbitrary round number.
 */
export const MAX_POSTINGS_PER_ANALYSIS = 20;
