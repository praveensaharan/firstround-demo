import { completeJson, QUALITY_MODEL } from "./llm.mjs";
import { SCORING_DIMENSIONS } from "./dml.mjs";

const DIMENSION_LIST = SCORING_DIMENSIONS.map(
  (d) => `  - ${d.key} (${d.label})`,
).join("\n");

const SYSTEM = `You are a hiring screener writing up a first-round interview. You judge
only what the candidate actually said. You return ONLY JSON — no prose, no code fences.

Schema:
{
  "overall": <0-100>,
  "recommendation": "ADVANCE" | "HOLD" | "REJECT",
  "headline": "<one sentence a hiring manager reads first>",
  "dimensions": [ { "key": "<dimension key>", "score": <0-10>, "note": "<12 words>" } ],
  "strengths":  [ "<specific, grounded in a quote>" ],
  "concerns":   [ "<specific, grounded in a quote>" ],
  "redFlags":   [ "<only genuine disqualifiers, usually empty>" ],
  "quotes":     [ { "text": "<verbatim from the candidate>", "why": "<why it mattered>" } ],
  "summary": "<3 sentences: what they claimed, how well they evidenced it, what to probe next round>"
}

Dimensions to score:
${DIMENSION_LIST}

How to judge:
- Specifics beat fluency. "Cut p99 from 800ms to 120ms by batching" outranks a
  polished paragraph with no numbers in it.
- A short answer that is concrete is stronger than a long answer that is generic.
- Do not reward confidence on its own, and do not punish accent, grammar or filler.
- This was a ${"${duration}"}-second screen. Judge against that, not a full loop —
  the bar is "worth a real interview", not "ready to hire".
- If the candidate barely spoke, say so plainly and score low on evidence, not on
  ability. Put that in concerns, not redFlags.
- redFlags means a genuine disqualifier: dishonesty, a hard must-have they clearly
  lack, hostility. Not "could have said more".
- Quote verbatim. Never invent a quote.`;

export async function scoreSession({ session, flow, role, org }) {
  const transcript = session.turns
    .map((turn) =>
      turn.role === "candidate"
        ? `CANDIDATE: ${turn.text}`
        : `INTERVIEWER: ${turn.text}`,
    )
    .join("\n");

  const answered = session.turns.filter((turn) => turn.role === "candidate");
  if (!answered.length) {
    return {
      overall: 0,
      recommendation: "REJECT",
      headline: "No answers were recorded for this session.",
      dimensions: SCORING_DIMENSIONS.map((d) => ({
        key: d.key,
        score: 0,
        note: "Nothing to assess",
      })),
      strengths: [],
      concerns: ["The candidate did not respond to any question."],
      redFlags: [],
      quotes: [],
      summary:
        "The interview produced no candidate speech, so there is nothing to evaluate. " +
        "This is usually a microphone or connection problem rather than a signal about " +
        "the candidate. Re-invite them before drawing any conclusion.",
      incomplete: true,
    };
  }

  const report = await completeJson(
    [
      {
        role: "system",
        content: SYSTEM.replace("${duration}", String(flow.durationSec ?? 120)),
      },
      {
        role: "user",
        content: `ROLE: ${role?.title ?? flow.role}
ORGANIZATION: ${org?.name ?? "the company"}
MUST-HAVES: ${role?.mustHaves?.trim() || "(none specified)"}
ORGANIZATION'S SCREENING RULES: ${org?.rules?.trim() || "(none specified)"}

TRANSCRIPT
──────────
${transcript}

Write the report now.`,
      },
    ],
    { temperature: 0.2, maxTokens: 10000, model: QUALITY_MODEL },
  );

  return normalizeReport(report);
}

function normalizeReport(report) {
  const clamp = (value, max) =>
    Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
  const list = (value) =>
    (Array.isArray(value) ? value : []).map(String).filter(Boolean).slice(0, 6);

  const scored = SCORING_DIMENSIONS.map((dimension) => {
    const match = (report.dimensions ?? []).find(
      (d) => d.key === dimension.key,
    );
    return {
      key: dimension.key,
      label: dimension.label,
      score: clamp(match?.score, 10),
      note: match?.note ? String(match.note) : "Not evidenced in this answer set",
    };
  });

  const recommendation = ["ADVANCE", "HOLD", "REJECT"].includes(
    report.recommendation,
  )
    ? report.recommendation
    : "HOLD";

  return {
    overall: clamp(report.overall, 100),
    recommendation,
    headline: String(report.headline ?? "Screening complete."),
    dimensions: scored,
    strengths: list(report.strengths),
    concerns: list(report.concerns),
    redFlags: list(report.redFlags),
    quotes: (Array.isArray(report.quotes) ? report.quotes : [])
      .filter((quote) => quote?.text)
      .slice(0, 4)
      .map((quote) => ({
        text: String(quote.text),
        why: String(quote.why ?? ""),
      })),
    summary: String(report.summary ?? ""),
  };
}
