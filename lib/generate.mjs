import { completeJson, QUALITY_MODEL } from "./llm.mjs";
import { EMOTIONS, MOTION_SLOTS, SCORING_DIMENSIONS } from "./dml.mjs";

const SLOT_KEYS = MOTION_SLOTS.map((slot) => slot.key).join(" | ");
const EMOTION_KEYS = EMOTIONS.join(" | ");
const DIMENSION_KEYS = SCORING_DIMENSIONS.map((d) => d.key).join(" | ");

const SYSTEM = `You design branching first-round screening interviews that a speaking
avatar delivers out loud. You return ONLY JSON — no prose, no code fences.

Schema:
{
  "persona":  { "name": "<interviewer first name>", "tone": "<6 words>" },
  "entry":    "<node id>",
  "nodes": {
    "<node id>": {
      "kind":      "ask" | "close",
      "label":     "<3 words, shown in the editor>",
      "say":       "<the exact words spoken aloud>",
      "motion":    ${SLOT_KEYS},
      "emotion":   ${EMOTION_KEYS},
      "intensity": "low" | "neutral" | "high",
      "budgetSec": <seconds this beat should take>,
      "dimension": ${DIMENSION_KEYS},
      "branches":  [ { "when": "<condition describing the answer>", "to": "<node id>" } ],
      "fallback":  "<node id used when nothing matches>"
    }
  }
}

Hard rules:
- The interview is SPOKEN. Every "say" is one natural sentence or two, never more
  than 35 words, no lists, no markdown, no stage directions.
- EVERY path from entry to the close node passes through EXACTLY THREE "ask"
  nodes. A strong candidate gets three questions and so does a weak one — they
  just get different ones. No branch may reach the close node early, and no
  "ask" node at depth 1 or 2 may branch to the close node.
- Exactly one node has "kind":"close". It thanks the candidate, says the team will
  follow up, and asks nothing. It has no branches and no fallback, and its
  budgetSec is 10.
- The three "ask" budgetSec values must sum to the requested duration minus 10.
- Every other node has kind "ask", 2 or 3 branches, and a fallback.
- Branches must lead to DIFFERENT nodes so the interview genuinely forks: one path
  for a strong/specific answer, one for a thin/vague answer.
- "when" conditions describe what the candidate SAID, judged by a model reading the
  transcript. Make them concrete and mutually exclusive.
- Node ids are lowercase snake_case and must all exist in "nodes".
- Use the organization's own vocabulary, products and rules. If a rule forbids a
  topic, no node may ask about it.
- The first node greets using {{org}} and the interviewer's own name, then asks the
  opening question in the same breath.`;

export async function generateFlow({ org, role, durationSec = 120 }) {
  const flow = await completeJson(
    [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `ORGANIZATION: ${org.name}

WHAT THIS ORGANIZATION DOES (knowledge base):
${org.knowledge?.trim() || "(none supplied)"}

INTERVIEW RULES THIS ORGANIZATION REQUIRES:
${org.rules?.trim() || "(none supplied)"}

ROLE BEING SCREENED: ${role.title}
SENIORITY: ${role.seniority || "not specified"}
MUST-HAVES: ${role.mustHaves?.trim() || "(none supplied)"}

TOTAL INTERVIEW LENGTH: ${durationSec} seconds. This is a fast first-round screen —
be ruthless about what is worth asking in that time.

Return the JSON now.`,
      },
    ],
    { temperature: 0.5, maxTokens: 12000, model: QUALITY_MODEL },
  );

  return normalizeFlow(flow, durationSec);
}

/** The model gets the shape right but the details wrong often enough to repair. */
function normalizeFlow(flow, durationSec) {
  const nodes = {};
  for (const [nodeId, raw] of Object.entries(flow.nodes ?? {})) {
    const isClose = raw.kind === "close";
    nodes[nodeId] = {
      id: nodeId,
      kind: isClose ? "close" : "ask",
      label: raw.label ?? nodeId.replace(/_/g, " "),
      say: raw.say ?? "",
      motion: MOTION_SLOTS.some((slot) => slot.key === raw.motion)
        ? raw.motion
        : isClose
          ? "farewell"
          : "probing",
      emotion: EMOTIONS.includes(raw.emotion) ? raw.emotion : "curiosity",
      intensity: ["low", "neutral", "high"].includes(raw.intensity)
        ? raw.intensity
        : "neutral",
      budgetSec: Number(raw.budgetSec) || (isClose ? 15 : 35),
      dimension: SCORING_DIMENSIONS.some((d) => d.key === raw.dimension)
        ? raw.dimension
        : "role_fit",
      branches: isClose
        ? []
        : (raw.branches ?? [])
            .filter((branch) => branch?.when && branch?.to)
            .map((branch) => ({ when: branch.when, to: branch.to })),
      fallback: isClose ? null : (raw.fallback ?? null),
    };
  }

  // Drop dangling edges rather than shipping a flow that dead-ends mid-interview.
  const closeId =
    Object.keys(nodes).find((nodeId) => nodes[nodeId].kind === "close") ?? null;
  for (const node of Object.values(nodes)) {
    if (node.kind === "close") {
      node.fallback = null;
      continue;
    }
    node.branches = node.branches.filter((branch) => nodes[branch.to]);
    if (!nodes[node.fallback]) {
      node.fallback = node.branches[0]?.to ?? closeId;
    }
  }

  return {
    persona: {
      name: flow.persona?.name || "Maya",
      tone: flow.persona?.tone || "warm but rigorous",
    },
    entry: nodes[flow.entry] ? flow.entry : Object.keys(nodes)[0],
    durationSec,
    maxAsks: 3,
    nodes,
  };
}
