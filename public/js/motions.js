import { api, el, shell, toast, param, withBusy } from "./ui.js";
import { boot, unlock, say } from "./presenter.js";

const main = document.getElementById("main");
document.getElementById("shell").prepend(shell("motions"));

const config = await api("/api/config");
const flowId = param("flow");

const allFlows = await api("/api/flows")
  .then((result) => result.items)
  .catch(() => []);

let flow = flowId
  ? await api(`/api/flows/${flowId}`).catch(() => null)
  : null;
if (!flow) flow = allFlows[0] ?? null;

let org = null;
if (flow) org = await api(`/api/orgs/${flow.orgId}`).catch(() => null);
if (!org) org = (await api("/api/orgs").catch(() => ({ items: [] }))).items[0] ?? null;

if (!org) {
  main.append(
    el(
      "div",
      { class: "empty" },
      el("strong", { text: "No organization yet" }),
      "Create one in the console, then choose the face your candidates will meet.",
      el(
        "div",
        { class: "row", style: { justifyContent: "center", marginTop: "16px" } },
        el("a", { class: "btn btn-primary btn-sm", href: "/org/", text: "Go to console" }),
      ),
    ),
  );
  throw new Error("no org");
}

const [avatars, scenes, voices] = await Promise.all([
  api("/api/catalog/avatars").then((r) => r.items),
  api("/api/catalog/scenes").then((r) => r.items),
  api("/api/catalog/voices").then((r) => r.items),
]);

// "org" edits the identity every interview inherits; "flow" overrides one.
let scope = "org";
let stage = {};
let motions = {};
let catalog = [];
let suggested = {};
let presenter = null;
let dirty = false;

function loadScope() {
  const source = scope === "org" ? org : flow;
  stage = { ...config.defaultStage, ...(source?.stage ?? {}) };
  motions = { ...(source?.motions ?? {}) };
  dirty = false;
}

async function loadCatalog() {
  if (!stage.avatarId) return ((catalog = []), (suggested = {}));
  try {
    const result = await api(`/api/catalog/avatars/${stage.avatarId}/motions`);
    catalog = result.items;
    suggested = result.suggested ?? {};
  } catch (err) {
    catalog = [];
    suggested = {};
    toast(`Could not load gestures: ${err.message}`, "bad");
  }
}

const autoMatch = () => ({ ...suggested });

const avatarThumb = (avatar) =>
  avatar.thumbnail_urls?.head ?? avatar.thumbnail_urls?.upper_body ?? "";
const sceneThumb = (scene) =>
  scene.thumbnail_urls?.default ?? scene.thumbnail_urls?.high_res ?? "";

const nameOf = (list, id, fallback) =>
  list.find((item) => item.id === id)?.name ?? fallback;

/** How many interviews currently differ from the organization's identity. */
function driftCount() {
  if (!org.stage?.avatarId) return 0;
  return allFlows.filter(
    (item) =>
      item.orgId === org.id &&
      (item.stage?.avatarId !== org.stage.avatarId ||
        item.stage?.sceneId !== org.stage.sceneId ||
        item.stage?.voiceId !== org.stage.voiceId),
  ).length;
}

// ── Scope ───────────────────────────────────────────────────────────────────

function scopeCard() {
  const drift = driftCount();
  return el(
    "div",
    { class: "card" },
    el(
      "div",
      { class: "card-head" },
      el(
        "div",
        {},
        el("h2", { text: "What are you styling?" }),
        el("p", {
          class: "card-sub",
          text: "Set the face once for the whole organization, or override it for a single interview.",
        }),
      ),
    ),
    el(
      "div",
      { class: "tiles" },
      el(
        "button",
        {
          class: "tile",
          type: "button",
          "aria-pressed": String(scope === "org"),
          onClick: async () => {
            if (scope === "org") return;
            scope = "org";
            loadScope();
            await loadCatalog();
            resetPreview();
            render();
          },
        },
        el("strong", { text: `${org.name} — everyone` }),
        el("span", {
          text: org.stage?.avatarId
            ? `Currently ${nameOf(avatars, org.stage.avatarId, "an avatar")}. Every new interview inherits this.`
            : "Not set yet — interviews fall back to the server default.",
        }),
      ),
      el(
        "button",
        {
          class: "tile",
          type: "button",
          "aria-pressed": String(scope === "flow"),
          disabled: !flow,
          onClick: async () => {
            if (scope === "flow" || !flow) return;
            scope = "flow";
            loadScope();
            await loadCatalog();
            resetPreview();
            render();
          },
        },
        el("strong", { text: flow ? `Only "${flow.role}"` : "No interview yet" }),
        el("span", {
          text: flow
            ? `Overrides the organization for this one interview.`
            : "Generate an interview first.",
        }),
      ),
    ),
    drift && scope === "org"
      ? el(
          "div",
          {
            class: "row",
            style: {
              marginTop: "14px",
              padding: "12px 14px",
              borderRadius: "10px",
              background: "rgba(245,181,68,.08)",
              border: "1px solid rgba(245,181,68,.3)",
            },
          },
          el("span", {
            class: "hint",
            style: { color: "var(--warn)", flex: "1" },
            text: `${drift} interview${drift > 1 ? "s" : ""} still use a different face. They were created before this was set.`,
          }),
          el("button", {
            class: "btn btn-ghost btn-sm",
            text: "Apply to all",
            onClick: (event) =>
              withBusy(event.currentTarget, "Applying…", async () => {
                const { updated } = await api(`/api/orgs/${org.id}/apply-identity`, {
                  body: {},
                });
                toast(`Updated ${updated} interview${updated === 1 ? "" : "s"}`, "good");
                location.reload();
              }),
          }),
        )
      : null,
  );
}

// ── Pickers ─────────────────────────────────────────────────────────────────

function avatarPicker() {
  return el(
    "div",
    { class: "card" },
    el(
      "div",
      { class: "card-head" },
      el(
        "div",
        {},
        el("h2", { text: "The interviewer" }),
        el("p", {
          class: "card-sub",
          text: "Who the candidate meets. Changing this re-matches every gesture below.",
        }),
      ),
      el("span", {
        class: "chip chip-accent",
        text: nameOf(avatars, stage.avatarId, "none selected"),
      }),
    ),
    el(
      "div",
      { class: "avatar-tiles" },
      ...avatars.map((avatar) =>
        el(
          "button",
          {
            class: "avatar-tile",
            type: "button",
            "aria-pressed": String(avatar.id === stage.avatarId),
            title: avatar.description || avatar.name,
            onClick: async () => {
              stage = { ...stage, avatarId: avatar.id };
              dirty = true;
              await loadCatalog();
              motions = autoMatch();
              resetPreview();
              render();
            },
          },
          avatarThumb(avatar)
            ? el("img", { src: avatarThumb(avatar), alt: "", loading: "lazy" })
            : el("div", { class: "skeleton", style: { width: "100%", aspectRatio: "1" } }),
          el("span", { text: avatar.name }),
        ),
      ),
    ),
  );
}

function scenePicker() {
  return el(
    "div",
    { class: "card" },
    el(
      "div",
      { class: "card-head" },
      el(
        "div",
        {},
        el("h2", { text: "The background" }),
        el("p", {
          class: "card-sub",
          text: "The room the interview happens in. A transparent scene shows your own page behind the avatar.",
        }),
      ),
      el("span", {
        class: "chip chip-accent",
        text: nameOf(scenes, stage.sceneId, "none selected"),
      }),
    ),
    el(
      "div",
      { class: "scene-tiles" },
      ...scenes.map((scene) =>
        el(
          "button",
          {
            class: "scene-tile",
            type: "button",
            "aria-pressed": String(scene.id === stage.sceneId),
            title: scene.description || scene.name,
            onClick: () => {
              stage = { ...stage, sceneId: scene.id };
              dirty = true;
              resetPreview();
              render();
            },
          },
          sceneThumb(scene)
            ? el("img", { src: sceneThumb(scene), alt: "", loading: "lazy" })
            : el("div", { class: "skeleton", style: { width: "100%", aspectRatio: "16/10" } }),
          el("span", { text: scene.name.replace(/_/g, " ") }),
        ),
      ),
    ),
  );
}

function voicePicker() {
  const current = voices.find((voice) => voice.id === stage.voiceId);
  return el(
    "div",
    { class: "card" },
    el(
      "div",
      { class: "card-head" },
      el(
        "div",
        {},
        el("h2", { text: "The voice" }),
        el("p", {
          class: "card-sub",
          text: "Changing the voice reloads the preview, because it is resolved when the avatar boots.",
        }),
      ),
      current?.languages?.length
        ? el("span", { class: "chip", text: `${current.languages.length} languages` })
        : null,
    ),
    el(
      "div",
      { class: "row", style: { flexWrap: "nowrap" } },
      el(
        "select",
        {
          style: { flex: "1", minWidth: "0" },
          onChange: (event) => {
            stage = { ...stage, voiceId: event.target.value };
            dirty = true;
            resetPreview();
            render();
          },
        },
        ...voices.map((voice) =>
          el("option", {
            value: voice.id,
            selected: voice.id === stage.voiceId,
            text: voice.name,
          }),
        ),
      ),
      el("button", {
        class: "btn btn-ghost btn-sm",
        text: "Hear it",
        disabled: !presenter,
        title: presenter ? "Speak a sample line" : "Load the preview first",
        onClick: () =>
          say(
            presenter,
            `Hello — I'm ${flow?.persona?.name ?? "your interviewer"}, and I'll be running your screen today.`,
            { emotion: "joy", intensity: "neutral" },
          ),
      }),
    ),
  );
}

function presetRow() {
  return el(
    "div",
    { class: "card" },
    el(
      "div",
      {},
      el("h2", { text: "Gesture personality" }),
      el("p", {
        class: "card-sub",
        text: "A starting point for how the interviewer carries itself. Fine-tune any single gesture below.",
      }),
    ),
    el(
      "div",
      { class: "tiles", style: { marginTop: "16px" } },
      ...config.motionPresets.map((preset) =>
        el(
          "button",
          {
            class: "tile",
            type: "button",
            onClick: () => {
              // Preset ids belong to the default HR avatar — drop anything the
              // selected avatar cannot actually perform.
              const usable = Object.fromEntries(
                Object.entries(preset.motions).filter(([, motionId]) =>
                  catalog.some((motion) => motion.id === motionId),
                ),
              );
              motions = { ...autoMatch(), ...usable };
              dirty = true;
              toast(`${preset.label} applied`, "good");
              render();
            },
          },
          el("strong", { text: preset.label }),
          el("span", { text: preset.blurb }),
        ),
      ),
    ),
  );
}

function slotGrid() {
  return el(
    "div",
    { class: "card" },
    el(
      "div",
      { class: "card-head" },
      el(
        "div",
        {},
        el("h2", { text: "Gestures" }),
        el("p", {
          class: "card-sub",
          text: "The Dialogue Map refers to these by name, so swapping one changes every question that uses it.",
        }),
      ),
      el("button", {
        class: "btn btn-ghost btn-sm",
        text: "Auto-match",
        onClick: () => {
          motions = autoMatch();
          dirty = true;
          toast("Matched from this avatar's catalog", "good");
          render();
        },
      }),
    ),
    catalog.length
      ? el(
          "div",
          { class: "motion-grid" },
          ...config.motionSlots.map((slot) =>
            el(
              "div",
              { class: "motion-slot" },
              el(
                "div",
                { class: "motion-slot-head" },
                el("strong", { text: slot.label }),
                el("span", { text: slot.hint }),
              ),
              el(
                "div",
                { class: "row", style: { flexWrap: "nowrap" } },
                el(
                  "select",
                  {
                    style: { flex: "1", minWidth: "0" },
                    onChange: (event) => {
                      motions[slot.key] = event.target.value;
                      dirty = true;
                    },
                  },
                  el("option", { value: "", text: "— none —" }),
                  ...catalog.map((motion) =>
                    el("option", {
                      value: motion.id,
                      selected: motion.id === motions[slot.key],
                      text: motion.name,
                    }),
                  ),
                ),
                el("button", {
                  class: "btn btn-ghost btn-sm",
                  text: "▶",
                  title: "Play this gesture",
                  onClick: async (event) => {
                    const select = event.currentTarget.previousElementSibling;
                    if (!select.value) return toast("Pick a gesture first", "bad");
                    if (!presenter) return toast("Load the preview first", "bad");
                    const result = await presenter.playMotion(select.value);
                    if (!result?.success) toast("That gesture did not play", "bad");
                  },
                }),
              ),
            ),
          ),
        )
      : el(
          "div",
          { class: "empty" },
          el("strong", { text: "No gestures for this avatar" }),
          "Pick a different avatar, or check the Connect key.",
        ),
  );
}

// ── Preview ─────────────────────────────────────────────────────────────────

/**
 * Built once and never re-created. Re-appending <sv-presenter> to a fresh parent
 * fires its disconnectedCallback and tears down the render context, so a
 * full-page re-render would blank the avatar the instant it finished loading.
 */
const stageHolder = el("div", { class: "preview-stage" });
const previewButtons = el("div", { class: "row" });

function mountIdle() {
  stageHolder.replaceChildren(
    el(
      "div",
      { class: "preview-idle" },
      el(
        "div",
        {},
        el("p", {
          class: "u-muted",
          text: "Load the interviewer to preview the background, voice and gestures.",
        }),
      ),
      el("button", {
        class: "btn btn-primary",
        text: "Load interviewer",
        onClick: (event) =>
          withBusy(event.currentTarget, "Loading…", async () => {
            const element = document.createElement("sv-presenter");
            stageHolder.replaceChildren(element);
            try {
              await boot(element, stage);
              await unlock(element);
              presenter = element;
              toast("Interviewer ready", "good");
            } catch (err) {
              presenter = null;
              toast(err.message, "bad");
              mountIdle();
            }
            refreshPreviewButtons();
            render();
          }),
      }),
    ),
  );
}

function refreshPreviewButtons() {
  previewButtons.replaceChildren(
    el("button", {
      class: "btn btn-ghost btn-sm",
      text: "Say a test line",
      disabled: !presenter,
      onClick: async () => {
        const motionId = motions.greeting;
        const line = `Hi, I'm ${flow?.persona?.name ?? "your interviewer"}. Thanks for making the time — shall we get started?`;
        await say(presenter, motionId ? `[MOTION ${motionId}:1] ${line}` : line, {
          emotion: "joy",
          intensity: "neutral",
        });
      },
    }),
    el("button", {
      class: "btn btn-ghost btn-sm",
      text: "Stop",
      disabled: !presenter,
      onClick: () => presenter?.interruptPresentation(),
    }),
  );
}

/** Avatar, scene and voice are all resolved at boot, so any change needs a reboot. */
function resetPreview() {
  presenter = null;
  mountIdle();
  refreshPreviewButtons();
}

const previewEl = el(
  "div",
  { class: "card preview-card" },
  stageHolder,
  el(
    "div",
    { class: "preview-foot" },
    previewButtons,
    el("p", {
      class: "hint",
      style: { marginTop: "10px" },
      text: "Gestures cue at the start of a line — a cue at the end never plays, because motion stops with the speech.",
    }),
  ),
);

// ── Shell ───────────────────────────────────────────────────────────────────

const headEl = el("div", { class: "page-head" });
const leftCol = el("div", { class: "stack" });
main.append(headEl, el("div", { class: "motion-layout" }, leftCol, previewEl));

async function save() {
  if (scope === "org") {
    org = await api(`/api/orgs/${org.id}`, {
      method: "PATCH",
      body: { stage, motions },
    });
  } else {
    const { flow: saved } = await api(`/api/flows/${flow.id}`, {
      method: "PATCH",
      body: { stage, motions },
    });
    flow = saved;
    const index = allFlows.findIndex((item) => item.id === saved.id);
    if (index !== -1) allFlows[index] = saved;
  }
  dirty = false;
}

function render() {
  headEl.replaceChildren(
    el(
      "div",
      {},
      el("div", { class: "eyebrow", text: "Step 4 · Presence" }),
      el("h1", { text: "Interviewer identity" }),
      el("p", {
        text: "The face, the room, the voice and the gestures. Everything here is previewable before a candidate ever sees it.",
      }),
    ),
    el(
      "div",
      { class: "row" },
      dirty ? el("span", { class: "chip chip-warn", text: "Unsaved" }) : null,
      flow
        ? el("a", {
            class: "btn btn-ghost btn-sm",
            href: `/org/flow.html?flow=${flow.id}`,
            text: "Dialogue Map",
          })
        : null,
      el("button", {
        class: "btn btn-primary btn-sm",
        text: scope === "org" ? "Save for organization" : "Save for this interview",
        onClick: (event) =>
          withBusy(event.currentTarget, "Saving…", async () => {
            await save();
            toast(
              scope === "org"
                ? "Saved. New interviews will inherit this."
                : `Saved for "${flow.role}".`,
              "good",
            );
            render();
          }),
      }),
    ),
  );

  leftCol.replaceChildren(
    scopeCard(),
    avatarPicker(),
    scenePicker(),
    voicePicker(),
    presetRow(),
    slotGrid(),
  );
}

loadScope();
await loadCatalog();
if (!Object.keys(motions).length) motions = autoMatch();
mountIdle();
refreshPreviewButtons();
render();
