// Skill taxonomy backing two features the report calls out as differentiators:
// the transparent per-category score breakdown, and the grouped keyword gap.
//
// Terms are written here in plain English and stemmed at load time, so this
// list stays editable by the team without anyone hand-computing stems.

import { preprocess } from './tokenize.js';

export const CATEGORY_LABELS = {
  technical: 'Technical Skills',
  tools: 'Tools & Platforms',
  soft: 'Soft Skills',
  role: 'Role-Specific Terms',
};

const RAW_TERMS = {
  technical: `python java javascript typescript c++ c# ruby go rust php swift kotlin scala r matlab
    sql nosql html css sass graphql rest api algorithms data structures machine learning deep learning
    nlp natural language processing computer vision statistics regression classification clustering
    neural networks tensorflow pytorch scikit pandas numpy data analysis data science etl
    object oriented functional programming concurrency multithreading distributed systems
    microservices authentication authorization encryption cryptography networking operating systems
    databases indexing query optimization normalization schema migration caching
    unit testing integration testing debugging profiling optimization recursion`,

  tools: `aws azure gcp google cloud docker kubernetes terraform ansible jenkins circleci travis
    git github gitlab bitbucket jira confluence slack figma postman swagger
    react angular vue svelte next.js node.js express django flask spring rails laravel
    mongodb mysql postgresql redis elasticsearch kafka rabbitmq sqlite oracle
    linux unix bash powershell vim vscode intellij eclipse
    tableau power bi excel looker snowflake databricks airflow spark hadoop
    ci/cd webpack babel npm yarn maven gradle jupyter anaconda`,

  soft: `communication collaboration teamwork leadership mentoring coaching presentation writing
    documentation interpersonal negotiation persuasion empathy adaptability flexibility initiative
    proactive self-motivated independent ownership accountability curiosity
    problem solving critical thinking analytical detail oriented organized time management
    prioritization multitasking creativity innovation resilience`,

  role: `agile scrum kanban sprint standup retrospective backlog roadmap stakeholder requirements
    specification architecture design review code review pair programming refactoring
    deployment release production staging monitoring alerting incident postmortem on-call
    scalability reliability availability performance latency throughput
    cross-functional product manager designer client customer vendor compliance audit
    budget forecast reporting metrics kpi analytics dashboard`,
};

/** stem -> category name */
const STEM_TO_CATEGORY = new Map();

for (const [category, blob] of Object.entries(RAW_TERMS)) {
  const { tokens } = preprocess(blob);
  for (const token of tokens) {
    // First category to claim a stem keeps it, so the ordering above acts as
    // a precedence list (technical before tools before soft before role).
    if (!STEM_TO_CATEGORY.has(token)) STEM_TO_CATEGORY.set(token, category);
  }
}

export const CATEGORY_NAMES = Object.keys(RAW_TERMS);

/**
 * Classify a stemmed term. Anything not in the taxonomy is treated as
 * role-specific vocabulary — an unrecognized term drawn from a job posting is
 * far more often domain jargon than it is a soft skill.
 */
export function categorize(stemmedTerm) {
  return STEM_TO_CATEGORY.get(stemmedTerm) ?? 'role';
}

/** True when the term appears in the curated taxonomy at all. */
export function isKnownSkill(stemmedTerm) {
  return STEM_TO_CATEGORY.has(stemmedTerm);
}

export function taxonomySize() {
  return STEM_TO_CATEGORY.size;
}
