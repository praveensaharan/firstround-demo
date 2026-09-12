/**
 * Motion ids below are `cc007_female_hr`'s own catalog. A motion id that is not
 * in the selected avatar's catalog is silently dropped rather than erroring, so
 * the console falls back to keyword auto-mapping whenever the avatar changes.
 */
const HR = {
  wave: "01KZD8C3PH4YGK56WKYEA3CFXH", // Right Hand Wave Greeting
  questioning: "01M2838R2DBQM1RXVW8SWM7HE0", // Questioning Gesture
  casual: "01M2834CB839DY5R9RS6FPZBB8", // Casual Talking Gestures
  headNo: "01K4M966TXRHH1GD1019WK8J0N", // Female Shaking Head No
  scratch: "01KZD8BA45JPF4SVF5M1A3F3J8", // Casual Head Scratch
  excited: "01KZD8DC4MXM491S0J5GM8C05K", // Sudden Excited Reaction
  thumbUp: "01K4M9AQJEPKVX3HDKWWY4BH43", // Female Thumbup Stand
};

export const MOTION_PRESETS = [
  {
    key: "warm",
    label: "Warm",
    blurb: "Encouraging. Nods candidates along and rarely pushes back.",
    motions: {
      greeting: HR.wave,
      probing: HR.questioning,
      listening: HR.casual,
      skeptical: HR.scratch,
      thinking: HR.scratch,
      impressed: HR.excited,
      approval: HR.thumbUp,
      farewell: HR.wave,
    },
    emotions: { open: "joy", probe: "caring", close: "gratitude" },
  },
  {
    key: "balanced",
    label: "Balanced",
    blurb: "Professional and curious. The default screening register.",
    motions: {
      greeting: HR.wave,
      probing: HR.questioning,
      listening: HR.casual,
      skeptical: HR.casual,
      thinking: HR.scratch,
      impressed: HR.excited,
      approval: HR.thumbUp,
      farewell: HR.wave,
    },
    emotions: { open: "joy", probe: "curiosity", close: "gratitude" },
  },
  {
    key: "rigorous",
    label: "Rigorous",
    blurb: "Cool and exacting. Visibly unconvinced by a thin answer.",
    motions: {
      greeting: HR.casual,
      probing: HR.questioning,
      listening: HR.casual,
      skeptical: HR.headNo,
      thinking: HR.scratch,
      impressed: HR.thumbUp,
      approval: HR.thumbUp,
      farewell: HR.casual,
    },
    emotions: { open: "curiosity", probe: "realization", close: "gratitude" },
  },
];

export const ROLE_PRESETS = [
  {
    key: "ai-engineer",
    title: "AI Engineer",
    seniority: "Mid-level (2-5 years)",
    mustHaves: `- Has shipped an LLM or ML feature to real users, not just notebooks
- Can explain retrieval, evaluation and prompt/model iteration in their own words
- Has debugged a model that worked in testing and failed in production
- Comfortable with Python and at least one serving/orchestration stack`,
    rules: `- Always make them name a specific model, dataset or metric. Reject generalities.
- One follow-up on evaluation: how did they know it actually got better?
- Do not ask about salary or notice period in this round.
- Coursework and tutorials do not count as shipped work — probe until it is clear which it was.`,
  },
  {
    key: "sde",
    title: "Software Development Engineer",
    seniority: "Mid-level (2-5 years)",
    mustHaves: `- Owns features end to end: design, implementation, tests, rollout
- Can walk through a real production incident they helped resolve
- Solid on data structures and API design in conversation, not just on a whiteboard
- Has worked in a codebase they did not write`,
    rules: `- Ask for one concrete system they built and keep drilling into their own contribution.
- Listen for "we" vs "I" — make them state what they personally did.
- Do not ask trivia or puzzle questions. This round is about ownership and judgement.
- Do not ask about salary or notice period in this round.`,
  },
];

export const SAMPLE_ORG = {
  name: "Northwind Labs",
  knowledge: `Northwind Labs builds Atlas, a document-intelligence platform used by
insurance and legal teams to extract structured data from unstructured filings. We
process about 4 million documents a month for 60 enterprise customers.

The stack is Python and TypeScript. Retrieval runs on Postgres with pgvector, serving
is FastAPI behind a queue, and the front end is React. We self-host open-weight models
for extraction and call frontier APIs only for the hardest tier.

The engineering team is 34 people across Bangalore and Berlin. We ship daily, run a
weekly incident review, and every engineer is on call one week in six. We care more
about people who can explain a tradeoff than people who can recite an algorithm.`,
  rules: `- Every claim must be backed by a specific example. Push back once on any vague answer.
- Never ask about salary, notice period, visa status or current compensation.
- Never ask about age, family, health or anything outside the candidate's work.
- If a candidate says "we built X", ask what they personally owned.
- Be direct but never dismissive. Candidates should leave feeling fairly heard.`,
};
