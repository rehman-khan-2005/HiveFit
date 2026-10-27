// Role families, for grouping and filtering a job list.
//
// Providers disagree about categories — Adzuna has its own taxonomy and The
// Muse has a noisy one — so neither is usable as a shared grouping. This
// derives one from the title, which every provider gets right because it is
// the thing a human wrote.
//
// Title first, description only as a fallback: a backend posting that mentions
// React once in a "nice to have" line is still a backend posting, and matching
// on description alone gets that wrong constantly.

const FAMILIES = [
  ['ml', 'Machine Learning', /\b(machine learning|\bml\b|\bai\b|deep learning|data scien|nlp|computer vision|research scientist)\b/i],
  ['data', 'Data', /\b(data analyst|data engineer|analytics|business intelligence|\bbi\b|data warehouse|etl)\b/i],
  ['devops', 'DevOps & Cloud', /\b(devops|sre|site reliability|platform engineer|infrastructure|cloud engineer|systems engineer|sysadmin)\b/i],
  ['security', 'Security', /\b(security|infosec|appsec|penetration|soc analyst|cyber)\b/i],
  ['mobile', 'Mobile', /\b(ios|android|mobile (developer|engineer)|react native|flutter|swift)\b/i],
  ['fullstack', 'Full Stack', /\b(full.?stack)\b/i],
  ['frontend', 'Frontend', /\b(front.?end|\bui engineer|web developer|react developer)\b/i],
  ['backend', 'Backend', /\b(back.?end|server.?side|api engineer|distributed systems)\b/i],
  ['qa', 'QA & Test', /\b(\bqa\b|quality assurance|test engineer|sdet|automation engineer)\b/i],
  ['embedded', 'Embedded', /\b(embedded|firmware|hardware engineer|robotics)\b/i],
  ['design', 'Design', /\b(designer|\bux\b|\bui\/ux|product design)\b/i],
  ['product', 'Product & PM', /\b(product manager|product owner|program manager|project manager|scrum master)\b/i],
  ['it', 'IT & Support', /\b(help ?desk|support (specialist|engineer|technician)|it (specialist|support|technician)|desktop support)\b/i],
  // Deliberately last: almost every posting above also says "engineer".
  ['swe', 'Software Engineering', /\b(software|developer|engineer|programmer)\b/i],
];

export const ROLE_FAMILIES = FAMILIES.map(([id, label]) => ({ id, label }));

/**
 * Best-guess role family for one posting.
 * @returns {{id: string, label: string}}
 */
export function classifyRole({ title = '', description = '' } = {}) {
  for (const [id, label, pattern] of FAMILIES) {
    if (pattern.test(title)) return { id, label };
  }
  // Nothing in the title. Try the description before giving up, but only for
  // the specific families — "engineer" appears in every posting ever written.
  for (const [id, label, pattern] of FAMILIES.slice(0, -1)) {
    if (pattern.test(description)) return { id, label };
  }
  return { id: 'other', label: 'Other' };
}

