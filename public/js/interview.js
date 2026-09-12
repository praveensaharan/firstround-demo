import { api, el, toast } from "./ui.js";
import { boot, unlock, say, whenFinished } from "./presenter.js";

const stageEl = document.getElementById("stage");
const layer = document.getElementById("layer");
const flowId = location.pathname.split("/").filter(Boolean).pop();

let flow;
try {
  flow = await api(`/api/flows/${flowId}`);
} catch {
  layer.append(
    el(
      "div",
      { class: "gate" },
      el("h1", { text: "This interview link is not active" }),
      el("p", { text: "Ask the team that invited you for a fresh link." }),
    ),
  );
  throw new Error("no flow");
}

const org = await api(`/api/orgs/${flow.orgId}`).catch(() => ({ name: "our team" }));

let presenter = null;
let session = null;
let questionsAsked = 0;
let speaking = false;
let ticker = null;
let recognition = null;
let listening = false;
// Latches once the interview is over. The answer bar is re-enabled after every
// send, so without this the closing line's 900ms grace window is long enough to
// fire one more answer at a session the server has already completed.
let over = false;

// ── Pre-flight ──────────────────────────────────────────────────────────────

function gate() {
  const name = el("input", { type: "text", placeholder: "Your full name" });
  const email = el("input", { type: "email", placeholder: "you@example.com" });

  layer.replaceChildren(
    el(
      "div",
      { class: "gate" },
      el("div", { class: "eyebrow", text: org.name }),
      el("h1", { text: "First-round screen" }),
      el("div", { class: "role", text: flow.role }),
      el("p", {
        text:
          `You'll speak with ${flow.persona?.name ?? "our interviewer"} for about ` +
          `${Math.round((flow.durationSec ?? 120) / 60)} minutes. Answer out loud or by ` +
          "typing — whichever you prefer. There are no trick questions.",
      }),
      el(
        "div",
        { class: "gate-facts" },
        el(
          "div",
          { class: "gate-fact" },
          el("b", { text: `${flow.durationSec ?? 120}s` }),
          el("span", { text: "Total time" }),
        ),
        el(
          "div",
          { class: "gate-fact" },
          el("b", { text: String(flow.maxAsks ?? 3) }),
          el("span", { text: "Questions" }),
        ),
        el(
          "div",
          { class: "gate-fact" },
          el("b", { text: "1" }),
          el("span", { text: "Attempt" }),
        ),
      ),
      el("div", { class: "field" }, el("label", { text: "Your name" }), name),
      el("div", { class: "field" }, el("label", { text: "Email" }), email),
      el("button", {
        class: "btn btn-primary btn-lg",
        style: { width: "100%", justifyContent: "center", marginTop: "10px" },
        text: "Begin interview",
        onClick: async (event) => {
          if (!name.value.trim()) return toast("Please enter your name", "bad");
          const button = event.currentTarget;
          button.disabled = true;
          button.replaceChildren(el("span", { class: "spinner" }), "Connecting…");
          try {
            await begin({ name: name.value, email: email.value });
          } catch (err) {
            toast(err.message, "bad");
            button.disabled = false;
            button.textContent = "Begin interview";
          }
        },
      }),
      el("p", {
        class: "hint",
        style: { marginTop: "14px" },
        text: "Your answers are recorded and reviewed by the hiring team.",
      }),
    ),
  );
}

// ── Live interview ──────────────────────────────────────────────────────────

async function begin(candidate) {
  // The presenter must exist before the session starts so the opening line has
  // somewhere to play — and this click is the gesture that unlocks audio.
  const element = document.createElement("sv-presenter");
  stageEl.prepend(element);
  await boot(element, flow.stage);
  await unlock(element);
  presenter = element;

  session = await api("/api/sessions", { body: { flowId: flow.id, candidate } });
  liveUi();
  startTimer(session.durationSec);
  await deliver(session.presentation, session.done);
}

function liveUi() {
  layer.replaceChildren();

  document.body.append(
    el(
      "div",
      { class: "hud", id: "hud" },
      el(
        "div",
        { class: "hud-who" },
        el("span", { class: "live-dot" }),
        el(
          "div",
          {},
          el("b", { text: flow.persona?.name ?? "Interviewer" }),
          el("span", { text: `${org.name} · ${flow.role}` }),
        ),
      ),
      el("div", { class: "pips", id: "pips" }),
      el(
        "div",
        { class: "timer" },
        el(
          "div",
          { class: "timer-wrap" },
          el("div", { class: "timer-ring", id: "ring" }),
          el("span", { class: "timer-text", id: "clock", text: "2:00" }),
        ),
      ),
    ),
    el("div", { class: "caption-dock", id: "dock" }),
    answerBar(),
  );

  renderPips();
}

function renderPips() {
  const pips = document.getElementById("pips");
  if (!pips) return;
  pips.replaceChildren(
    ...Array.from({ length: flow.maxAsks ?? 3 }, (_, index) =>
      el("span", { class: `pip ${index < questionsAsked ? "is-done" : ""}` }),
    ),
  );
}

function answerBar() {
  const input = el("textarea", {
    placeholder: "Answer out loud, or type here…",
    rows: 1,
    onKeyDown: (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    },
    // Typing while the avatar is mid-sentence cuts it off, the way talking over
    // a real interviewer would.
    onInput: () => {
      if (speaking) bargeIn();
    },
  });

  const mic = el("button", {
    class: "mic-btn",
    id: "mic",
    title: "Answer by voice",
    text: "🎙",
    onClick: () => toggleMic(input),
  });

  const send = el("button", {
    class: "btn btn-primary send-btn",
    text: "Send",
    onClick: () => submit(),
  });

  async function submit() {
    const text = input.value.trim();
    if (!text) return toast("Say or type an answer first", "bad");
    if (listening) toggleMic(input);
    input.value = "";
    await answer(text);
  }

  return el(
    "div",
    { class: "answer-bar", id: "answer-bar" },
    el("div", { class: "answer-inner" }, mic, input, send),
    el("p", {
      class: "answer-note",
      text: "Press Enter to send. You can talk over the interviewer — it will stop and listen.",
    }),
  );
}

function bargeIn() {
  presenter?.interruptPresentation();
  speaking = false;
  presenter?.setListening?.(true);
}

function caption(who, text, mine = false) {
  const dock = document.getElementById("dock");
  if (!dock) return;
  dock.replaceChildren(
    el(
      "div",
      { class: `caption ${mine ? "caption--you" : ""}` },
      el("div", { class: "caption-who", text: who }),
      el("div", { text }),
    ),
  );
}

function thinking(on) {
  const dock = document.getElementById("dock");
  if (!dock) return;
  presenter?.setThinking?.(on);
  if (on) {
    dock.replaceChildren(
      el("div", { class: "thinking" }, el("i"), el("i"), el("i")),
    );
  }
}

async function deliver(presentation, done) {
  if (!presentation) return done ? finish() : undefined;

  questionsAsked += 1;
  renderPips();
  caption(flow.persona?.name ?? "Interviewer", presentation.caption);

  speaking = true;
  presenter?.setListening?.(false);
  const finished = whenFinished(presenter);
  await say(presenter, presentation.text, {
    emotion: presentation.emotion,
    intensity: presentation.intensity,
  });
  await finished;
  speaking = false;
  presenter?.setListening?.(true);

  if (done) {
    over = true;
    setBarDisabled(true);
    // Let the closing line land before the screen changes under them.
    setTimeout(finish, 900);
  }
}

async function answer(text) {
  if (speaking) bargeIn();
  caption("You", text, true);
  setBarDisabled(true);

  try {
    // Deliberate beat — a reply that lands instantly reads as a lookup, not a
    // person considering what was just said.
    thinking(true);
    const result = await api(`/api/sessions/${session.sessionId}/answer`, {
      body: { text },
    });
    thinking(false);
    await deliver(result.presentation, result.done);
  } catch (err) {
    thinking(false);
    // The session is gone or already closed — there is nothing to recover, and
    // an error toast would strand the candidate on a dead screen.
    if (/not found|already finished/i.test(err.message)) {
      over = true;
      await finish();
      return;
    }
    toast(err.message, "bad");
    // Their words are not lost — put them back so they can retry.
    const input = document.querySelector("#answer-bar textarea");
    if (input && !input.value) input.value = text;
  } finally {
    if (!over) setBarDisabled(false);
  }
}

function setBarDisabled(disabled) {
  const bar = document.getElementById("answer-bar");
  if (!bar) return;
  bar.querySelectorAll("textarea, button").forEach((node) => {
    node.disabled = disabled;
  });
  if (!disabled) bar.querySelector("textarea")?.focus();
}

// ── Voice input ─────────────────────────────────────────────────────────────

function toggleMic(input) {
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!Recognition) {
    return toast("This browser can't do voice input — please type instead", "bad");
  }
  const mic = document.getElementById("mic");

  if (listening) {
    recognition?.stop();
    return;
  }

  recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  let settled = "";
  recognition.onresult = (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const chunk = event.results[index];
      if (chunk.isFinal) settled += chunk[0].transcript;
      else interim += chunk[0].transcript;
    }
    input.value = (settled + interim).trim();
    if (speaking) bargeIn();
  };
  recognition.onerror = (event) => {
    if (event.error !== "aborted") toast(`Microphone: ${event.error}`, "bad");
  };
  recognition.onend = () => {
    listening = false;
    mic?.classList.remove("is-live");
  };

  recognition.start();
  listening = true;
  mic?.classList.add("is-live");
}

// ── Timer ───────────────────────────────────────────────────────────────────

function startTimer(totalSec) {
  const started = Date.now();
  const ring = document.getElementById("ring");
  const clock = document.getElementById("clock");

  ticker = setInterval(() => {
    const spent = (Date.now() - started) / 1000;
    const left = Math.max(0, totalSec - spent);
    const pct = (left / totalSec) * 100;
    if (ring) {
      ring.style.setProperty("--pct", pct.toFixed(1));
      ring.style.setProperty(
        "--timer-color",
        pct > 40 ? "var(--accent)" : pct > 15 ? "var(--warn)" : "var(--bad)",
      );
    }
    if (clock) {
      clock.textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")}`;
    }
    // Hitting zero does not end the interview — the server decides that on the
    // next answer, so someone still mid-sentence is not cut off. This is only a
    // backstop for a tab left open with nobody in front of it.
    if (spent >= totalSec * 2) {
      over = true;
      finish();
    }
  }, 500);
}

// ── Wrap-up ─────────────────────────────────────────────────────────────────

let finishing = false;

async function finish() {
  if (finishing) return;
  finishing = true;
  over = true;
  clearInterval(ticker);
  recognition?.stop();
  presenter?.interruptPresentation();

  document.getElementById("hud")?.remove();
  document.getElementById("answer-bar")?.remove();
  document.getElementById("dock")?.remove();

  layer.replaceChildren(
    el(
      "div",
      { class: "done-card" },
      el("div", { class: "tick", text: "✓" }),
      el("h1", { text: "That's everything" }),
      el("p", {
        text: `Thanks for your time. ${org.name} will review your answers and be in touch.`,
      }),
      el("div", { class: "row", style: { justifyContent: "center", marginTop: "20px" } },
        el("span", { class: "spinner" }),
        el("span", { class: "hint", text: "Writing up your report…" })),
    ),
  );

  try {
    await api(`/api/sessions/${session.sessionId}/finish`, { body: {} });
    layer.querySelector(".row")?.replaceChildren(
      el("span", { class: "chip chip-good", text: "Report delivered to the hiring team" }),
    );
  } catch (err) {
    layer.querySelector(".row")?.replaceChildren(
      el("span", { class: "hint", text: "Your answers were saved." }),
    );
    console.error(err);
  }
}

gate();
