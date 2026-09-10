// Standard English stop words, plus terms that appear in nearly every job
// posting and resume. Boilerplate like "responsibilities" or "candidate"
// carries no signal about fit, so leaving it in would inflate similarity
// between any two documents.

const ENGLISH = `a about above after again against all am an and any are aren't as at be because been
before being below between both but by can't cannot could couldn't did didn't do does doesn't doing
don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll
he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't
it it's its itself let's me more most mustn't my myself no nor not of off on once only or other
ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some
such than that that's the their theirs them themselves then there there's these they they'd they'll
they're they've this those through to too under until up very was wasn't we we'd we'll we're we've
were weren't what what's when when's where where's which while who who's whom why why's with won't
would wouldn't you you'd you'll you're you've your yours yourself yourselves`;

const RESUME_BOILERPLATE = `ability able applicant application apply candidate career company
description duties employer employment experience including job knowledge level looking must
opportunity organization plus position preferred qualifications required requirement requirements
responsibilities responsible role skill skills strong team work working years year etc via
please resume cv applicants seeking join looking ideal successful

// Auxiliaries and generic verbs that saturate both resumes and postings. Left
// in, they surface as "critical gaps" ("you will build", "participate in") and
// crowd out the real skills the report is supposed to point at.
will shall may might must would should need needs want wants get gets got
make makes made use uses used using help helps provide provides ensure ensures
include includes included also well across within upon per plus various new
participate familiarity plus day daily weekly monthly`;

export const STOP_WORDS = new Set(
  `${ENGLISH} ${RESUME_BOILERPLATE}`.split(/\s+/).filter(Boolean)
);

export function isStopWord(token) {
  return STOP_WORDS.has(token);
}
