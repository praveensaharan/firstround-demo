import { api, el, shell, toast, fmtDate, scoreColor, recChip } from "./ui.js";

const main = document.getElementById("main");
document.getElementById("shell").prepend(shell("reviews"));

let summaries = (await api("/api/sessions")).items;
let selectedId = summaries[0]?.id ?? null;
let detail = null;

function candidateRow(summary) {
  const score = summary.report?.overall;
  return el(
    "button",
    {
      class: "cand",
      type: "button",
      "aria-pressed": String(summary.id === selectedId),
      onClick: () => {
        selectedId = summary.id;
        detail = null;
        render();
        load();
      },
    },
    el(
      "span",
      {
        class: "cand-score",
        style: {
          color: score === undefined ? "var(--muted)" : scoreColor(score),
        },
        text: score === undefined ? "—" : String(score),
      },
    ),
    el(
      "span",
      { class: "cand-main" },
      el("strong", { text: summary.candidate?.name ?? "Candidate" }),
      el("span", { text: `${summary.role} · ${fmtDate(summary.startedAt)}` }),
    ),
  );
}

function meter(dimension) {
  return el(
    "div",
    { class: "meter" },
    el(
      "div",
      { class: "meter-head" },
      el("span", { text: dimension.label }),
      el("b", { text: `${dimension.score}/10` }),
    ),
    el(
      "div",
      { class: "meter-track" },
      el("div", {
        class: "meter-fill",
        style: {
          width: `${dimension.score * 10}%`,
          background: scoreColor(dimension.score, 10),
        },
      }),
    ),
    el("div", { class: "meter-note", text: dimension.note }),
  );
}

function bulletCard(title, items, tone) {
  if (!items?.length) return null;
  return el(
    "div",
    { class: "card" },
    el(
      "div",
      { class: "card-head" },
      el("h3", { text: title }),
      tone ? el("span", { class: `chip chip-${tone}`, text: String(items.length) }) : null,
    ),
    el("ul", { class: "bullets" }, ...items.map((item) => el("li", { text: item }))),
  );
}

function reportView(session) {
  const report = session.report;

  if (!report) {
    return el(
      "div",
      { class: "card" },
      el("h2", { text: session.candidate?.name ?? "Candidate" }),
      el("p", {
        class: "card-sub",
        text:
          session.status === "in_progress"
            ? "This interview is still in progress."
            : "This interview finished but was never scored.",
      }),
      transcriptCard(session),
    );
  }

  return el(
    "div",
    { class: "stack" },
    el(
      "div",
      { class: "card" },
      el(
        "div",
        { class: "row", style: { gap: "22px", flexWrap: "nowrap", alignItems: "flex-start" } },
        el(
          "div",
          {
            class: "score-ring",
            style: {
              "--pct": String(report.overall),
              "--ring-color": scoreColor(report.overall),
            },
          },
          el(
            "div",
            { class: "score-ring-inner" },
            el("b", { text: String(report.overall) }),
            el("small", { text: "of 100" }),
          ),
        ),
        el(
          "div",
          { style: { flex: "1", minWidth: "0" } },
          el(
            "div",
            { class: "row", style: { marginBottom: "8px" } },
            el("h2", { text: session.candidate?.name ?? "Candidate" }),
            recChip(report.recommendation),
          ),
          el("p", { style: { fontSize: "15px", color: "var(--text-2)" }, text: report.headline }),
          el("p", {
            class: "hint",
            style: { marginTop: "10px" },
            text: `${session.role} · ${fmtDate(session.startedAt)} · ${session.candidate?.email || "no email given"}`,
          }),
        ),
      ),
    ),
    el(
      "div",
      { class: "card" },
      el("h3", { text: "Assessment" }),
      el(
        "div",
        { class: "stack", style: { marginTop: "14px", gap: "14px" } },
        ...report.dimensions.map(meter),
      ),
    ),
    el(
      "div",
      { class: "grid-2" },
      bulletCard("Strengths", report.strengths, "good"),
      bulletCard("Concerns", report.concerns, "warn"),
    ),
    bulletCard("Red flags", report.redFlags, "bad"),
    report.quotes?.length
      ? el(
          "div",
          { class: "card" },
          el("h3", { text: "In their own words" }),
          el(
            "div",
            { class: "stack", style: { marginTop: "14px" } },
            ...report.quotes.map((quote) =>
              el(
                "blockquote",
                { class: "quote" },
                el("p", { text: `"${quote.text}"` }),
                el("cite", { text: quote.why }),
              ),
            ),
          ),
        )
      : null,
    report.summary
      ? el(
          "div",
          { class: "card" },
          el("h3", { text: "Summary" }),
          el("p", {
            style: { marginTop: "10px", color: "var(--text-2)", fontSize: "14px" },
            text: report.summary,
          }),
        )
      : null,
    transcriptCard(session),
  );
}

function transcriptCard(session) {
  return el(
    "div",
    { class: "card" },
    el(
      "div",
      { class: "card-head" },
      el("h3", { text: "Full transcript" }),
      el("span", { class: "chip", text: `${session.turns.length} turns` }),
    ),
    el(
      "div",
      { class: "transcript" },
      ...session.turns.map((turn) =>
        el(
          "div",
          { class: `turn turn--${turn.role}` },
          el("div", {
            class: "turn-who",
            text: turn.role === "candidate" ? "Candidate" : "Interviewer",
          }),
          el("div", { class: "turn-text", text: turn.text }),
          turn.routeReason
            ? el("div", {
                class: "turn-route",
                text: `↳ routed to ${turn.routedTo ?? "end"} — ${turn.routeReason}`,
              })
            : null,
        ),
      ),
    ),
  );
}

async function load() {
  if (!selectedId) return;
  try {
    detail = await api(`/api/sessions/${selectedId}`);
    render();
  } catch (err) {
    toast(err.message, "bad");
  }
}

function render() {
  main.replaceChildren(
    el(
      "div",
      { class: "page-head" },
      el(
        "div",
        {},
        el("div", { class: "eyebrow", text: "Step 5" }),
        el("h1", { text: "Candidates" }),
        el("p", {
          text: "Every answer captured, scored against your must-haves, with the quotes behind each judgement.",
        }),
      ),
      el("button", {
        class: "btn btn-ghost btn-sm",
        text: "Refresh",
        onClick: async () => {
          summaries = (await api("/api/sessions")).items;
          toast("Up to date");
          render();
        },
      }),
    ),
    summaries.length
      ? el(
          "div",
          { class: "reviews" },
          el("div", { class: "cand-list" }, ...summaries.map(candidateRow)),
          detail
            ? reportView(detail)
            : el("div", { class: "card" }, el("div", { class: "skeleton", style: { height: "220px" } })),
        )
      : el(
          "div",
          { class: "empty" },
          el("strong", { text: "No interviews taken yet" }),
          "Share a candidate link and the reports will land here.",
          el(
            "div",
            { class: "row", style: { justifyContent: "center", marginTop: "16px" } },
            el("a", { class: "btn btn-primary btn-sm", href: "/org/", text: "Open console" }),
          ),
        ),
  );
}

render();
load();
