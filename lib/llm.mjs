const BASE = (
  process.env.LLM_BASE_URL ?? "https://api.deepseek.com/v1"
).replace(/\/+$/, "");
const MODEL = process.env.LLM_MODEL ?? "deepseek-flash";
const KEY = process.env.LLM_API_KEY;

/**
 * A stronger model for the two calls that sit OFF the interview's critical path
 * — map generation and post-interview scoring. Live branch routing must never
 * use this: it blocks the avatar's next line, where latency is the whole
 * experience. Unset means everything uses LLM_MODEL.
 */
export const QUALITY_MODEL = process.env.LLM_MODEL_QUALITY || MODEL;

export const configured = () => Boolean(KEY);

/**
 * deepseek-flash is a reasoning model, and reasoning_content is billed against
 * max_tokens before a single visible character is emitted — a schema-heavy
 * prompt will happily spend 12k tokens thinking and return empty `content`.
 * `reasoning_effort: "none"` turns that off, which is what every call here
 * wants: the prompts already specify the exact output shape.
 */
export async function complete(
  messages,
  {
    temperature = 0.4,
    maxTokens = 6000,
    reasoning = "none",
    json = false,
    model = MODEL,
  } = {},
) {
  if (!KEY) throw new Error("LLM_API_KEY is not set");
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      ...(reasoning ? { reasoning_effort: reasoning } : {}),
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `LLM ${res.status}: ${body.error?.message ?? res.statusText}`,
    );
  }
  const choice = body.choices?.[0];
  const text = choice?.message?.content;
  if (!text) {
    throw new Error(
      `LLM returned no content (finish_reason: ${choice?.finish_reason ?? "unknown"}, ` +
        `reasoning tokens: ${body.usage?.completion_tokens_details?.reasoning_tokens ?? 0}). ` +
        "Raise maxTokens.",
    );
  }
  return text;
}

/**
 * Models routinely wrap JSON in prose or ``` fences even when told not to, so
 * take the outermost brace/bracket span rather than trusting the raw string.
 */
export function parseJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
    if (start === -1 || end <= start) {
      throw new Error(`LLM did not return JSON: ${candidate.slice(0, 200)}`);
    }
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

export async function completeJson(messages, options) {
  return parseJson(await complete(messages, { json: true, ...options }));
}
