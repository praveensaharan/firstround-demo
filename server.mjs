import express from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as perxona from "./lib/perxona.mjs";
import * as llm from "./lib/llm.mjs";
import * as dml from "./lib/dml.mjs";
import { generateFlow } from "./lib/generate.mjs";
import { scoreSession } from "./lib/score.mjs";
import { orgs, flows, sessions, id as newId } from "./lib/store.mjs";
import { ROLE_PRESETS, MOTION_PRESETS, SAMPLE_ORG } from "./lib/presets.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8084;

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(
  express.static(join(HERE, "public"), {
    etag: false,
    // Actively-edited demo: without this a browser happily keeps serving a
    // module script from cache, and you debug code that is no longer on disk.
    setHeaders: (res) => res.set("Cache-Control", "no-store"),
  }),
);

/** Wraps a handler so a rejected promise becomes JSON, never a hung request. */
const route = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    console.error(`${req.method} ${req.path} — ${err.message}`);
    if (!res.headersSent) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  }
};

const fail = (status, message) =>
  Object.assign(new Error(message), { status });

// ── Config & catalog ────────────────────────────────────────────────────────

app.get(
  "/api/config",
  route(async (_req, res) => {
    res.json({
      presenterUrl: perxona.PRESENTER_URL,
      defaultStage: perxona.DEFAULT_STAGE,
      perxonaReady: perxona.configured(),
      llmReady: llm.configured(),
      motionSlots: dml.MOTION_SLOTS,
      emotions: dml.EMOTIONS,
      intensities: dml.INTENSITIES,
      dimensions: dml.SCORING_DIMENSIONS,
      rolePresets: ROLE_PRESETS,
      motionPresets: MOTION_PRESETS,
      sampleOrg: SAMPLE_ORG,
    });
  }),
);

app.get(
  "/api/connect-key",
  route(async (_req, res) => {
    res.set("Cache-Control", "no-store");
    if (!perxona.PUBLISHABLE_KEY) throw fail(501, "No publishable key configured.");
    res.json({ connect_key: perxona.PUBLISHABLE_KEY });
  }),
);

app.get(
  "/api/catalog/avatars",
  route(async (_req, res) => res.json({ items: await perxona.avatars() })),
);
app.get(
  "/api/catalog/scenes",
  route(async (_req, res) => res.json({ items: await perxona.scenes() })),
);
app.get(
  "/api/catalog/voices",
  route(async (_req, res) => res.json({ items: await perxona.voices() })),
);
app.get(
  "/api/catalog/avatars/:id/motions",
  route(async (req, res) => {
    const items = await perxona.avatarMotions(req.params.id);
    res.json({ items, suggested: dml.autoMapMotions(items) });
  }),
);

// ── Organizations ───────────────────────────────────────────────────────────

app.get(
  "/api/orgs",
  route(async (_req, res) => res.json({ items: await orgs.all() })),
);

app.get(
  "/api/orgs/:id",
  route(async (req, res) => {
    const org = await orgs.get(req.params.id);
    if (!org) throw fail(404, "Organization not found.");
    res.json(org);
  }),
);

app.post(
  "/api/orgs",
  route(async (req, res) => {
    const { name, knowledge = "", rules = "" } = req.body ?? {};
    if (!name?.trim()) throw fail(400, "An organization name is required.");
    res.status(201).json(
      await orgs.put({
        id: newId("org"),
        name: name.trim(),
        knowledge,
        rules,
        createdAt: new Date().toISOString(),
      }),
    );
  }),
);

app.patch(
  "/api/orgs/:id",
  route(async (req, res) => {
    const { name, knowledge, rules, stage, motions } = req.body ?? {};
    const changes = {};
    if (name !== undefined) changes.name = String(name).trim();
    if (knowledge !== undefined) changes.knowledge = String(knowledge);
    if (rules !== undefined) changes.rules = String(rules);
    // The organization's own interviewer identity. Every interview inherits it
    // at generation time unless it has deliberately overridden it.
    if (stage !== undefined) changes.stage = stage;
    if (motions !== undefined) changes.motions = motions;
    res.json(await orgs.patch(req.params.id, changes));
  }),
);

/** Pushes the organization's chosen face and gestures onto every interview. */
app.post(
  "/api/orgs/:id/apply-identity",
  route(async (req, res) => {
    const org = await orgs.get(req.params.id);
    if (!org) throw fail(404, "Organization not found.");
    if (!org.stage?.avatarId) {
      throw fail(409, "Choose an interviewer for this organization first.");
    }
    const owned = await flows.filter((flow) => flow.orgId === org.id);
    for (const flow of owned) {
      await flows.patch(flow.id, {
        stage: { ...org.stage },
        motions: { ...(org.motions ?? {}) },
      });
    }
    res.json({ updated: owned.length });
  }),
);

// ── Flows (Dialogue Maps) ───────────────────────────────────────────────────

app.get(
  "/api/flows",
  route(async (req, res) => {
    const all = await flows.all();
    const items = req.query.orgId
      ? all.filter((flow) => flow.orgId === req.query.orgId)
      : all;
    res.json({ items });
  }),
);

app.get(
  "/api/flows/:id",
  route(async (req, res) => {
    const flow = await flows.get(req.params.id);
    if (!flow) throw fail(404, "Interview not found.");
    res.json(flow);
  }),
);

/** Generates a Dialogue Map from the org's own knowledge and rules. */
app.post(
  "/api/flows/generate",
  route(async (req, res) => {
    if (!llm.configured()) throw fail(501, "LLM_API_KEY is not configured.");
    const { orgId, role, durationSec = 120, stage, motions } = req.body ?? {};
    const org = await orgs.get(orgId);
    if (!org) throw fail(404, "Organization not found.");
    if (!role?.title?.trim()) throw fail(400, "A role title is required.");

    const generated = await generateFlow({ org, role, durationSec });
    // .env is only the seed for an organization that has never chosen a face.
    // Once it has, every new interview inherits it.
    const resolvedStage = {
      ...perxona.DEFAULT_STAGE,
      ...(org.stage ?? {}),
      ...(stage ?? {}),
    };
    // Gesture ids belong to one avatar's catalog, so the org's mapping is only
    // reusable when the avatar actually matches — otherwise re-match from scratch.
    const inheritedMotions =
      org.stage?.avatarId === resolvedStage.avatarId ? org.motions : null;
    const resolvedMotions =
      motions ??
      inheritedMotions ??
      (resolvedStage.avatarId
        ? dml.autoMapMotions(
            await perxona.avatarMotions(resolvedStage.avatarId).catch(() => []),
          )
        : {});

    const flow = await flows.put({
      id: newId("flow"),
      orgId,
      role: role.title.trim(),
      seniority: role.seniority ?? "",
      mustHaves: role.mustHaves ?? "",
      durationSec,
      maxAsks: generated.maxAsks,
      stage: resolvedStage,
      motions: resolvedMotions,
      persona: generated.persona,
      entry: generated.entry,
      nodes: generated.nodes,
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ flow, errors: dml.validate(flow) });
  }),
);

app.patch(
  "/api/flows/:id",
  route(async (req, res) => {
    const existing = await flows.get(req.params.id);
    if (!existing) throw fail(404, "Interview not found.");
    const allowed = [
      "role",
      "seniority",
      "mustHaves",
      "durationSec",
      "maxAsks",
      "stage",
      "motions",
      "persona",
      "entry",
      "nodes",
    ];
    const changes = Object.fromEntries(
      Object.entries(req.body ?? {}).filter(([key]) => allowed.includes(key)),
    );
    const saved = await flows.patch(req.params.id, changes);
    res.json({ flow: saved, errors: dml.validate(saved) });
  }),
);

app.delete(
  "/api/flows/:id",
  route(async (req, res) => {
    await flows.remove(req.params.id);
    res.status(204).end();
  }),
);

// ── Live interview ──────────────────────────────────────────────────────────

const elapsedSeconds = (session) =>
  (Date.now() - new Date(session.startedAt).getTime()) / 1000;

function speak(flow, node, session) {
  const presentation = dml.buildPresentation(node, flow, {
    org: session.orgName,
    role: flow.role,
    interviewer: flow.persona?.name ?? "your interviewer",
    candidate: session.candidate?.name ?? "there",
  });
  return { ...presentation, nodeId: node.id, label: node.label };
}

app.post(
  "/api/sessions",
  route(async (req, res) => {
    const { flowId, candidate } = req.body ?? {};
    const flow = await flows.get(flowId);
    if (!flow) throw fail(404, "Interview not found.");
    const entry = flow.nodes[flow.entry];
    if (!entry) throw fail(409, "This interview has no opening question yet.");

    const org = await orgs.get(flow.orgId);
    const session = await sessions.put({
      id: newId("ses"),
      flowId,
      orgId: flow.orgId,
      orgName: org?.name ?? "our team",
      role: flow.role,
      candidate: {
        name: candidate?.name?.trim() || "Candidate",
        email: candidate?.email?.trim() || "",
      },
      status: "in_progress",
      startedAt: new Date().toISOString(),
      endedAt: null,
      currentNodeId: flow.entry,
      turns: [],
      report: null,
    });

    const presentation = speak(flow, entry, session);
    await sessions.patch(session.id, {
      turns: [
        {
          at: new Date().toISOString(),
          role: "interviewer",
          nodeId: entry.id,
          text: presentation.caption,
        },
      ],
    });

    res.status(201).json({
      sessionId: session.id,
      durationSec: flow.durationSec ?? 120,
      maxAsks: flow.maxAsks ?? 3,
      persona: flow.persona,
      stage: flow.stage,
      presentation,
      done: entry.kind === "close",
    });
  }),
);

/**
 * One candidate answer in, the next thing the avatar says out. The branch is
 * chosen from what they actually said, so the path differs per candidate.
 */
app.post(
  "/api/sessions/:id/answer",
  route(async (req, res) => {
    const session = await sessions.get(req.params.id);
    if (!session) throw fail(404, "Session not found.");
    if (session.status !== "in_progress") {
      throw fail(409, "This interview is already finished.");
    }
    const answer = String(req.body?.text ?? "").trim();
    if (!answer) throw fail(400, "An answer is required.");

    const flow = await flows.get(session.flowId);
    const node = flow.nodes[session.currentNodeId];
    const elapsed = elapsedSeconds(session);

    const turns = [
      ...session.turns,
      {
        at: new Date().toISOString(),
        role: "candidate",
        nodeId: node.id,
        text: answer,
        atSec: Math.round(elapsed),
      },
    ];

    const asksAnswered = turns.filter((turn) => turn.role === "candidate").length;
    const [{ to, reason }, reaction] = await Promise.all([
      dml.route(flow, node, answer, { elapsedSec: elapsed, asksAnswered }),
      // A bare next-question with no acknowledgement reads as a kiosk, not a person.
      node.kind === "close" ? null : dml.reactionFor(answer, node),
    ]);

    turns[turns.length - 1].routedTo = to;
    turns[turns.length - 1].routeReason = reason;

    if (!to) {
      await sessions.patch(session.id, {
        turns,
        status: "completed",
        endedAt: new Date().toISOString(),
      });
      res.json({ done: true, presentation: null });
      return;
    }

    const nextNode = flow.nodes[to];
    const presentation = speak(flow, nextNode, session);

    // The reaction rides on the same utterance — two present() calls would let
    // the candidate start talking into the gap between them.
    let text = presentation.text;
    let caption = presentation.caption;
    if (reaction) {
      const motionId = flow.motions?.[reaction.slot];
      const lead = motionId
        ? `[MOTION ${motionId}:1] ${reaction.say}`
        : reaction.say;
      text = `${lead} ${presentation.caption}`;
      caption = `${reaction.say} ${presentation.caption}`;
    }

    turns.push({
      at: new Date().toISOString(),
      role: "interviewer",
      nodeId: nextNode.id,
      text: caption,
    });

    await sessions.patch(session.id, { turns, currentNodeId: nextNode.id });

    res.json({
      done: nextNode.kind === "close",
      routeReason: reason,
      presentation: { ...presentation, text, caption },
      elapsedSec: Math.round(elapsed),
    });
  }),
);

app.post(
  "/api/sessions/:id/finish",
  route(async (req, res) => {
    const session = await sessions.get(req.params.id);
    if (!session) throw fail(404, "Session not found.");
    if (session.report) {
      res.json({ session });
      return;
    }

    const flow = await flows.get(session.flowId);
    const org = await orgs.get(session.orgId);
    const ended = session.endedAt ?? new Date().toISOString();

    let report = null;
    let status = "completed";
    try {
      report = await scoreSession({
        session,
        flow,
        org,
        role: { title: flow.role, mustHaves: flow.mustHaves },
      });
      status = "scored";
    } catch (err) {
      console.error(`Scoring failed for ${session.id}: ${err.message}`);
    }

    res.json({
      session: await sessions.patch(session.id, { status, endedAt: ended, report }),
    });
  }),
);

app.get(
  "/api/sessions",
  route(async (req, res) => {
    const all = await sessions.all();
    const items = all
      .filter((session) =>
        req.query.flowId ? session.flowId === req.query.flowId : true,
      )
      .filter((session) =>
        req.query.orgId ? session.orgId === req.query.orgId : true,
      )
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
      .map(({ turns, ...rest }) => ({ ...rest, turnCount: turns.length }));
    res.json({ items });
  }),
);

app.get(
  "/api/sessions/:id",
  route(async (req, res) => {
    const session = await sessions.get(req.params.id);
    if (!session) throw fail(404, "Session not found.");
    res.json(session);
  }),
);

// ── Pages ───────────────────────────────────────────────────────────────────

// Shareable candidate link: /i/<flowId>
app.get("/i/:flowId", (_req, res) =>
  res.sendFile(join(HERE, "public", "interview", "index.html")),
);

app.listen(PORT, () => {
  console.log(`\n  FirstRound  →  http://localhost:${PORT}\n`);
  if (!perxona.configured()) {
    console.warn("  ! Perxona keys missing — the avatar will not load.");
  }
  if (!llm.configured()) {
    console.warn("  ! LLM_API_KEY missing — generation, routing and scoring are off.");
  }
});
