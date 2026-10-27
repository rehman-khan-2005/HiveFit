// Broad field, above the role family.
//
// A job board asked for "software engineer" will still hand back nurses,
// occupational therapists and delivery drivers — Adzuna's relevance is loose
// and its pool is everything. The role families in roles.js are tech-shaped,
// so everything outside tech collapsed into one "Other" bucket, which is no
// use to someone who wants to exclude a whole industry rather than pick a
// specialty.
//
// So this is the coarse cut: what industry is this job even in. Two levels,
// because they answer different questions — "is this my field at all" comes
// first, and "which kind of engineer" only makes sense after it.
//
// Title first. Titles are written by a human to be read by a human and are
// reliable; descriptions are not. A software role at a hospital mentions
// patients constantly, and a nursing post mentions the software it is charted
// in, so description text is consulted only when the title says nothing and
// never for the broadest fields.

// Occupation beats industry.
//
// "Healthcare Software Engineer" is a software job at a hospital, not a
// clinical role, and a student filtering to Technology wants to see it. The
// field rules below match on whichever industry word appears first, so these
// unambiguous occupation titles are checked ahead of them. Only titles that
// name the job itself belong here — "IT" or "cloud" on their own are domain
// words that show up in every field's postings.
const TECH_OCCUPATIONS = /\b(software (engineer|developer|architect)|web developer|mobile developer|front.?end (engineer|developer)|back.?end (engineer|developer)|full.?stack (engineer|developer)|data (engineer|scientist|analyst)|machine learning (engineer|developer|scientist)|devops engineer|site reliability engineer|platform engineer|programmer|qa engineer|\bsdet\b|security engineer|network engineer|database administrator|systems administrator|solutions architect|cloud (engineer|architect))\b/i;

const FIELD_RULES = [
  // Distinctive vocabularies first. Each of these owns words no other field
  // uses, so they can be matched confidently before the generic ones.
  ['healthcare', 'Healthcare & Medicine',
    /\b(nurs(e|ing)|\brn\b|\blpn\b|\blvn\b|\bcna\b|physician|surgeon|dentist|dental|hygienist|pharmac(y|ist)|therapist|therapy|clinical|patient|medical assistant|radiolog|sonograph|phlebotom|hospice|caregiver|paramedic|\bemt\b|veterinar|midwife|optometr|psychiatr|psycholog|respiratory|patholog|medical coder|healthcare|health aide|physical therap|occupational therap)\b/i],

  ['legal', 'Legal',
    /\b(attorney|lawyer|paralegal|legal counsel|general counsel|litigation|law clerk|legal assistant|contracts? (manager|administrator))\b/i],

  ['finance', 'Finance & Accounting',
    /\b(accountant|accounting|bookkeep(er|ing)|\bcpa\b|auditor|internal audit|tax (analyst|accountant|manager|preparer)|financial (analyst|advisor|planner)|finance manager|bank teller|underwrit(er|ing)|actuar(y|ial)|loan officer|mortgage|treasury|portfolio manager|investment (analyst|banking)|equity research|payroll|billing specialist|credit analyst)\b/i],

  ['education', 'Education',
    /\b(teacher|professor|lecturer|instructor|tutor|principal|curriculum|teaching assistant|school counselor|educator|faculty|admissions counselor|paraeducator|substitute teach)\b/i],

  ['hr', 'HR & Recruiting',
    /\b(recruiter|recruiting|talent acquisition|human resources|\bhr\b|people operations|benefits (administrator|specialist)|compensation analyst|staffing (coordinator|specialist))\b/i],

  // Technology sits above the other engineering disciplines so "Software
  // Engineer" is not read as mechanical engineering. Note the absence of a
  // bare "engineer" — that word belongs to half a dozen fields and matching it
  // here would swallow all of them.
  ['technology', 'Technology',
    /\b(software|developer|programmer|\bit\b|information technology|data scien(ce|tist)|data analyst|data engineer|machine learning|\bai\b|\bml\b|artificial intelligence|devops|\bsre\b|site reliability|cloud (engineer|architect)|cyber|security engineer|network engineer|database administrator|\bdba\b|qa engineer|\bsdet\b|web develop|mobile develop|\bios\b|android|front.?end|back.?end|full.?stack|systems (administrator|engineer)|help ?desk|technical support|solutions architect|platform engineer|computer|\bapi\b|salesforce|sharepoint)\b/i],

  ['design', 'Design & Creative',
    /\b(graphic design|\bux\b|\bui\/ux\b|product design|industrial design|interior design|creative director|art director|copywriter|illustrator|animator|video editor|photographer|visual design)\b/i],

  // Trades before engineering: an electrician is not an electrical engineer,
  // and "electrician" contains no word the engineering rule below would miss.
  ['trades', 'Construction & Trades',
    /\b(electrician|plumber|carpenter|welder|hvac|superintendent|foreman|construction|roofer|mason|pipefitter|millwright|heavy equipment|laborer|sheet metal|lineman|glazier)\b/i],

  ['engineering', 'Engineering (non-software)',
    /\b(mechanical|electrical|civil|structural|aerospace|chemical engineer|industrial engineer|manufacturing engineer|process engineer|controls engineer|quality engineer|design engineer|project engineer|field engineer|metallurg|drafter|surveyor|petroleum|nuclear|\bcad\b)\b/i],

  ['science', 'Science & Research',
    /\b(biolog|chemist|chemistry|physicist|laboratory|lab technician|research (scientist|associate)|microbiolog|geolog|bioinformatic|scientist|toxicolog)\b/i],

  ['sales', 'Sales & Marketing',
    /\b(sales|account executive|account manager|business development|marketing|\bseo\b|brand manager|merchandis(er|ing)|customer success|telemarket|retail associate|cashier)\b/i],

  ['hospitality', 'Hospitality & Food',
    /\b(chef|line cook|\bcook\b|server|waiter|waitress|bartender|barista|housekeep(er|ing)|hotel|restaurant|host(ess)?|dishwasher|food service|janitor|custodian)\b/i],

  ['operations', 'Operations & Logistics',
    /\b(warehouse|supply chain|logistics|driver|\bcdl\b|dispatcher|inventory|forklift|production associate|assembler|packer|shipping|courier|delivery|operations manager|plant manager|machine operator|material handler|picker)\b/i],

  ['admin', 'Admin & Support',
    /\b(administrative assistant|receptionist|office manager|data entry|\bclerk\b|secretary|scheduler|front desk|executive assistant)\b/i],

  ['government', 'Government & Public',
    /\b(police officer|firefighter|correctional|public sector|federal government|city of|county of|deputy sheriff)\b/i],
];

// Fields confident enough to guess from description text when the title is
// silent. The broad commercial ones are excluded: almost every posting
// mentions sales, operations or administration somewhere.
const DESCRIPTION_SAFE = new Set([
  'healthcare', 'legal', 'finance', 'education', 'technology', 'engineering', 'trades', 'science',
]);

// What to ask the board for when the user has picked a field but typed no
// query of their own.
//
// Filtering after the fact can only ever sieve what came back, and a blank
// Adzuna query comes back almost entirely healthcare and logistics — asking
// for Technology and getting five results is not a filter working, it is a
// filter with nothing to work on. The board's own keyword search is the only
// lever that changes what arrives, so a chosen field drives it.
const FIELD_QUERIES = {
  healthcare: 'nurse medical clinical',
  legal: 'attorney paralegal legal',
  finance: 'accountant financial analyst',
  education: 'teacher instructor education',
  hr: 'recruiter human resources',
  technology: 'software engineer developer',
  design: 'designer ux creative',
  trades: 'electrician plumber construction',
  engineering: 'mechanical electrical civil engineer',
  science: 'research scientist laboratory',
  sales: 'sales account marketing',
  hospitality: 'restaurant hotel food service',
  operations: 'warehouse logistics driver',
  admin: 'administrative assistant office',
  government: 'government public sector',
};

/** Seed query for a field, when the user supplied none. */
export function fieldQuery(id) {
  return FIELD_QUERIES[id] ?? '';
}

export const FIELDS = [
  ...FIELD_RULES.map(([id, label]) => ({ id, label })),
  { id: 'other', label: 'Other' },
];

const FIELD_LABELS = Object.fromEntries(FIELDS.map((f) => [f.id, f.label]));

/** Which field a posting belongs to. */
export function classifyField({ title = '', description = '' } = {}) {
  if (TECH_OCCUPATIONS.test(title)) {
    return { id: 'technology', label: FIELD_LABELS.technology };
  }

  for (const [id, label, pattern] of FIELD_RULES) {
    if (pattern.test(title)) return { id, label };
  }
  for (const [id, label, pattern] of FIELD_RULES) {
    if (DESCRIPTION_SAFE.has(id) && pattern.test(description)) return { id, label };
  }
  return { id: 'other', label: FIELD_LABELS.other };
}

/** Human label for a field id, for echoing a filter back to the user. */
export function fieldLabel(id) {
  return FIELD_LABELS[id] ?? null;
}
