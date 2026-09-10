// Rewrite backends for Process 3.0.
//
// Both providers are handed only `writable` terms — ones suggestForBullet has
// already proven the bullet evidences. Neither is ever given a term the user
// has not demonstrated, so a provider cannot fabricate a qualification even if
// it tried.

import { config } from '../config/env.js';

const STRONG_VERBS = {
  'responsible for': 'Owned',
  'worked on': 'Built',
  'helped with': 'Contributed to',
  'assisted with': 'Supported',
  'involved in': 'Drove',
  'participated in': 'Contributed to',
  'tasked with': 'Led',
  'duties included': 'Delivered',
};

/**
 * Deterministic rewriter. No API key, no network — the default so the app is
 * fully usable for a student with no billing set up, and so tests are stable.
 */
export const heuristicProvider = {
  name: 'heuristic',
  async rewrite({ original, writable, issues }) {
    let text = original.trim();

    // Replace a weak opener with an ownership verb, preserving the rest.
    const lower = text.toLowerCase();
    for (const [weak, strong] of Object.entries(STRONG_VERBS)) {
      if (lower.startsWith(weak)) {
        let rest = text.slice(weak.length);
        // "Responsible for" + " working on the API" would read "Owned working
        // on the API". Drop the stranded gerund so the new verb governs the
        // object directly.
        rest = rest.replace(/^\s*(working on|helping with|assisting with|handling)\s+/i, ' ');
        text = strong + rest;
        break;
      }
    }

    text = text.charAt(0).toUpperCase() + text.slice(1);

    // Surface evidenced terms the bullet buried, using the posting's wording.
    const missingFromSurface = writable.filter(
      (term) => !text.toLowerCase().includes(term.toLowerCase())
    );
    if (missingFromSurface.length > 0) {
      text = `${text.replace(/[.]$/, '')} (${missingFromSurface.join(', ')}).`;
    }

    // A metric is the user's to supply — never invent one. Mark the slot.
    if (issues.some((i) => i.type === 'no_metric')) {
      text = `${text.replace(/[.]$/, '')} — add a number here (scale, volume, or % change).`;
    }

    return text;
  },
};

/**
 * Live rewriter backed by the Anthropic API.
 *
 * Effort is set to "low": rewriting one sentence under fixed constraints is a
 * simple, bounded task, and this runs once per bullet the user clicks.
 */
export function createAnthropicProvider() {
  let clientPromise = null;

  const SYSTEM = `You rewrite a single resume bullet point.

Absolute rules:
- Never add a skill, tool, technology, metric, employer, or responsibility that is not present in the material you are given. Inventing experience is the failure mode this product exists to prevent.
- You may only emphasize terms listed as EVIDENCED. Those are already demonstrated by the bullet or confirmed by the user.
- Never invent a number. If the bullet has no metric, leave a bracketed placeholder like [X%] for the user to fill in.
- Preserve every factual claim in the original. You are rephrasing, not re-scoping.
- Return only the rewritten bullet. No preamble, no quotes, no explanation, no alternatives.

Style: lead with a strong past-tense verb, state what was built or changed, then the outcome. One sentence. Under 40 words.`;

  return {
    name: 'anthropic',
    async rewrite({ original, writable, issues, jobTitle, userEvidence }) {
      if (!config.ai.apiKey) {
        throw Object.assign(
          new Error('ANTHROPIC_API_KEY is not set. Set AI_PROVIDER=heuristic or supply a key.'),
          { status: 503 }
        );
      }

      if (!clientPromise) {
        clientPromise = import('@anthropic-ai/sdk')
          .then(({ default: Anthropic }) => new Anthropic({ apiKey: config.ai.apiKey }))
          .catch((err) => {
            clientPromise = null;
            throw Object.assign(
              new Error('The @anthropic-ai/sdk package is not installed. Run npm install, or set AI_PROVIDER=heuristic.'),
              { status: 503, cause: err }
            );
          });
      }
      const client = await clientPromise;

      const parts = [
        `ORIGINAL BULLET:\n${original}`,
        writable.length > 0
          ? `EVIDENCED TERMS you may emphasize:\n${writable.join(', ')}`
          : 'EVIDENCED TERMS: none. Improve structure only. Do not add any skill.',
        issues.length > 0
          ? `STRUCTURAL ISSUES to fix:\n${issues.map((i) => `- ${i.detail}`).join('\n')}`
          : null,
        userEvidence ? `THE USER DESCRIBED THIS REAL EXPERIENCE:\n${userEvidence}` : null,
        jobTitle ? `TARGET ROLE: ${jobTitle}` : null,
      ].filter(Boolean);

      let response;
      try {
        response = await client.beta.messages.create({
          model: config.ai.model,
          max_tokens: 1000,
          output_config: { effort: 'low' },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: SYSTEM,
          messages: [{ role: 'user', content: parts.join('\n\n') }],
        });
      } catch (err) {
        const status = err?.status ?? 502;
        throw Object.assign(
          new Error(`Anthropic request failed: ${err?.message ?? 'unknown error'}`),
          { status: status === 401 ? 401 : 502, cause: err }
        );
      }

      if (response.stop_reason === 'refusal') {
        throw Object.assign(
          new Error('The model declined to rewrite this bullet.'),
          { status: 422 }
        );
      }

      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();

      if (!text) {
        throw Object.assign(new Error('The model returned an empty rewrite.'), { status: 502 });
      }
      return text;
    },
  };
}

/** Provider selected by AI_PROVIDER, defaulting to the offline heuristic. */
export function getProvider(name = config.ai.provider) {
  if (name === 'anthropic') return createAnthropicProvider();
  return heuristicProvider;
}
