import { completeJson } from "./llm.mjs";

/**
 * DML — Dialogue Map Language.
 *
 * A flow is a graph of `ask` nodes ending in a `close` node. After each answer
 * the router picks the outgoing branch whose `when` condition best matches what
 * the candidate actually said, so two candidates never get the same interview.
 */

export const MOTION_SLOTS = [
  { key: "greeting", label: "Greeting", hint: "Opens the interview" },
  { key: "probing", label: "Probing", hint: "Asking a pointed question" },
  { key: "listening", label: "Listening", hint: "Neutral talking gesture" },
  { key: "skeptical", label: "Skeptical", hint: "Answer was thin or vague" },
  { key: "thinking", label: "Thinking", hint: "Considering the answer" },
  { key: "impressed", label: "Impressed", hint: "Answer was strong" },
  { key: "approval", label: "Approval", hint: "Affirming the candidate" },
  { key: "farewell", label: "Farewell", hint: "Closing the interview" },
];

// Connect's EmotionCategory enum (docs/openapi.yaml). There is deliberately no
// "neutral" member — omitting emotion is what attaches no facial expression.
export const EMOTIONS = [
  "joy",
  "excitement",
  "admiration",
  "caring",
  "gratitude",
  "sadness",
  "disappointment",
  "annoyance",
  "embarrassment",
  "curiosity",
  "surprise",
  "realization",
  "confusion",
];
export const INTENSITIES = ["low", "neutral", "high"];

export const SCORING_DIMENSIONS = [
  { key: "technical_depth", label: "Technical depth" },
  { key: "communication", label: "Communication" },
  { key: "problem_solving", label: "Problem solving" },
  { key: "ownership", label: "Ownership & impact" },
  { key: "role_fit", label: "Role fit" },
];

/**
 * Hand-authored motions have precise names ("Right Hand Wave Greeting") and are
 * matched first. `intent:` tags are the fallback, and the only signal available
 * for the machine-named bulk of a catalog ("2026-07-W501-077 - Derived Motion"),
 * but they are broad enough that a bare `intent:greeting` can land on something
 * only loosely greeting-like. Both lists are ordered best-first.
 */
const SLOT_MATCHERS = {
  greeting: {
    intents: ["greeting"],
    names: ["wave greeting", "formal intro", "wavehand", "wave"],
  },
  probing: {
    intents: ["explaining", "offering_options", "elaboration", "emphasis"],
    names: ["questioning", "pointing", "presenting"],
  },
  listening: {
    intents: ["listening", "talking", "idle"],
    names: ["listen stand", "casual talking", "talk stand", "neutral idle"],
  },
  skeptical: {
    intents: ["disagreement", "refusal", "contrast"],
    names: ["shaking head no", "head scratch"],
  },
  thinking: {
    intents: ["uncertainty"],
    names: ["head scratch", "look around", "chest gesture"],
  },
  impressed: {
    intents: ["celebration", "cheering", "magnitude"],
    names: ["excited reaction", "claphand", "clap"],
  },
  approval: {
    intents: ["approval", "agreement", "positive_confirmation", "encouragement"],
    names: ["thumbup", "talking ok", "talk stand happy"],
  },
  farewell: {
    intents: ["greeting"],
    names: ["formal bow", "bow", "casual right hand wave", "wave"],
  },
};

export function autoMapMotions(catalog = []) {
  const byIntent = (intent) =>
    catalog.find((motion) => motion.tags?.includes(`intent:${intent}`));
  const byName = (word) =>
    catalog.find((motion) => motion.name?.toLowerCase().includes(word));

  const mapping = {};
  for (const { key } of MOTION_SLOTS) {
    const { intents, names } = SLOT_MATCHERS[key];
    const hit =
      names.map(byName).find(Boolean) ?? intents.map(byIntent).find(Boolean);
    if (hit) mapping[key] = hit.id;
  }

  // Greeting and farewell share a matcher list; a visibly different closing
  // beat is worth more than a marginally better match.
  if (mapping.farewell === mapping.greeting) {
    const alternative =
      byName("formal bow") ?? byName("casual right hand wave") ?? byName("bow");
    if (alternative && alternative.id !== mapping.greeting) {
      mapping.farewell = alternative.id;
    }
  }
  return mapping;
}

/** `{{org}}` / `{{role}}` / `{{interviewer}}` / `{{candidate}}` substitution. */
export function interpolate(text, vars = {}) {
  return String(text ?? "").replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key) =>
    vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : whole,
  );
}

/**
 * Motion markup must lead the line — playback is cut off with the speech, so a
 * cue at the end of a short sentence never animates.
 */
export function buildPresentation(node, flow, vars) {
  const motionId = flow.motions?.[node.motion];
  const spoken = interpolate(node.say, vars);
  return {
    text: motionId ? `[MOTION ${motionId}:1] ${spoken}` : spoken,
    caption: spoken,
    emotion: EMOTIONS.includes(node.emotion) ? node.emotion : null,
    intensity: INTENSITIES.includes(node.intensity) ? node.intensity : "neutral",
  };
}

export function validate(flow) {
  const errors = [];
  const nodes = flow?.nodes ?? {};
  const ids = Object.keys(nodes);
  if (!ids.length) errors.push("Flow has no nodes.");
  if (!nodes[flow?.entry]) errors.push(`Entry node "${flow?.entry}" is missing.`);
  if (!ids.some((nodeId) => nodes[nodeId].kind === "close")) {
    errors.push("Flow has no closing node.");
  }
  for (const nodeId of ids) {
    const node = nodes[nodeId];
    if (!node.say?.trim()) errors.push(`"${nodeId}" has no line to speak.`);
    for (const branch of node.branches ?? []) {
      if (!nodes[branch.to]) {
        errors.push(`"${nodeId}" branches to missing node "${branch.to}".`);
      }
    }
    if (node.kind !== "close" && node.fallback && !nodes[node.fallback]) {
      errors.push(`"${nodeId}" falls back to missing node "${node.fallback}".`);
    }
  }
  return errors;
}

export function closingNodeId(flow) {
  return (
    Object.keys(flow.nodes).find((nodeId) => flow.nodes[nodeId].kind === "close") ??
    null
  );
}

/**
 * Picks the next node from what the candidate actually said. Any failure —
 * unreachable model, unparseable reply, hallucinated node id — degrades to the
 * node's own fallback rather than stalling a live interview.
 */
export async function route(
  flow,
  node,
  answer,
  { elapsedSec = 0, asksAnswered = 0 } = {},
) {
  const branches = node.branches ?? [];
  const fallback = node.fallback ?? branches[0]?.to ?? closingNodeId(flow);

  // Out of time: skip straight to the close so the interview always lands.
  // The floor matters — the clock is wall-clock, and a candidate typing rather
  // than speaking can spend the whole budget on one answer. Ending there leaves
  // a transcript with nothing in it to score, so the clock is never allowed to
  // cut the interview shorter than two answers.
  const reserve = flow.nodes[closingNodeId(flow)]?.budgetSec ?? 15;
  const outOfTime = elapsedSec >= (flow.durationSec ?? 120) - reserve;
  if (outOfTime && asksAnswered >= 2) {
    return { to: closingNodeId(flow), reason: "time budget reached" };
  }
  // Generated graphs have uneven path depths — a heavily-probed candidate can be
  // five questions deep while another is three. The cap is what actually makes
  // every candidate's interview the same length, not the graph's shape.
  if (asksAnswered >= (flow.maxAsks ?? 3)) {
    return { to: closingNodeId(flow), reason: "question limit reached" };
  }
  if (node.kind === "close") return { to: null, reason: "interview complete" };
  if (branches.length <= 1) {
    return { to: fallback, reason: "single path" };
  }
  // Every branch leading to the same node is still one path — don't pay for a
  // routing call to discover that.
  if (new Set(branches.map((branch) => branch.to)).size === 1) {
    return { to: branches[0].to, reason: "single destination" };
  }

  const options = branches
    .map((branch, index) => `${index}. ${branch.when}`)
    .join("\n");
  try {
    const verdict = await completeJson(
      [
        {
          role: "system",
          content:
            "You route a live interview. Given a candidate's answer and numbered " +
            "conditions, return the index of the single best-matching condition. " +
            'Reply with JSON only: {"choice": <number>, "why": "<8 words>"}',
        },
        {
          role: "user",
          content: `QUESTION ASKED:\n${node.say}\n\nCANDIDATE ANSWER:\n${answer}\n\nCONDITIONS:\n${options}`,
        },
      ],
      { temperature: 0, maxTokens: 3000 },
    );
    const chosen = branches[Number(verdict.choice)];
    if (chosen && flow.nodes[chosen.to]) {
      return { to: chosen.to, reason: verdict.why ?? chosen.when };
    }
  } catch (err) {
    console.error(`DML: routing fell back — ${err.message}`);
  }
  return { to: fallback, reason: "no condition matched" };
}

/** A reaction beat the avatar plays before the next question — keeps it human. */
export async function reactionFor(answer, node) {
  try {
    const verdict = await completeJson(
      [
        {
          role: "system",
          content:
            "You are an interviewer reacting out loud. Given the candidate's answer, " +
            "return a SHORT natural acknowledgement (3-8 words, spoken, no question) " +
            "and the emotional register. Reply with JSON only: " +
            '{"say": "...", "slot": "impressed|approval|skeptical|thinking|listening"}',
        },
        { role: "user", content: `QUESTION: ${node.say}\nANSWER: ${answer}` },
      ],
      { temperature: 0.6, maxTokens: 2500 },
    );
    if (!verdict.say) return null;
    return {
      say: String(verdict.say).slice(0, 120),
      slot: MOTION_SLOTS.some((slot) => slot.key === verdict.slot)
        ? verdict.slot
        : "listening",
    };
  } catch {
    return null;
  }
}
