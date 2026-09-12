import { api, el, shell, toast, param, withBusy } from "./ui.js";

const main = document.getElementById("main");
document.getElementById("shell").prepend(shell("flow"));

const config = await api("/api/config");
const flowId = param("flow");

// The sidebar links here with no ?flow=, and an empty id makes GET /api/flows/
// match the LIST route — a 200 whose body has no `nodes`, so nothing throws
// until the first render reads flow.nodes[flow.entry]. Resolve a real flow
// first, falling back the way the motion editor does.
const allFlows = await api("/api/flows")
  .then((result) => result.items)
  .catch(() => []);

let flow = flowId
  ? await api(`/api/flows/${flowId}`).catch(() => null)
  : null;
if (!flow) flow = allFlows[0] ?? null;

if (!flow) {
  main.append(
    el(
      "div",
      { class: "empty" },
      el("strong", { text: "No interview to edit yet" }),
      "Generate a Dialogue Map in the console, then come back to shape it.",
      el(
        "div",
        { class: "row", style: { justifyContent: "center", marginTop: "16px" } },
        el("a", { class: "btn btn-primary btn-sm", href: "/org/", text: "Go to console" }),
      ),
    ),
  );
  throw new Error("no flow to edit");
}

let selectedId = flow.entry;
let dirty = false;

/** Breadth-first ranking — each rank becomes one row on the canvas. */
function levelize() {
  const levels = [];
  const seen = new Set();
  let frontier = [flow.entry];

  while (frontier.length) {
    const row = frontier.filter((id) => flow.nodes[id] && !seen.has(id));
    if (!row.length) break;
    row.forEach((id) => seen.add(id));
    levels.push(row);

    const next = [];
    for (const id of row) {
      const targets = [
        ...(flow.nodes[id].branches ?? []).map((branch) => branch.to),
        flow.nodes[id].fallback,
      ];
      for (const target of targets) {
        if (target && flow.nodes[target] && !seen.has(target) && !next.includes(target)) {
          next.push(target);
        }
      }
    }
    frontier = next;
  }

  const orphans = Object.keys(flow.nodes).filter((id) => !seen.has(id));
  if (orphans.length) levels.push(orphans);
  return levels;
}

function nodeCard(nodeId) {
  const node = flow.nodes[nodeId];
  const classes = [
    "flow-node",
    nodeId === selectedId ? "is-selected" : "",
    nodeId === flow.entry ? "is-entry" : "",
    node.kind === "close" ? "is-close" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return el(
    "button",
    {
      class: classes,
      type: "button",
      "data-node": nodeId,
      onClick: () => {
        selectedId = nodeId;
        render();
      },
    },
    el(
      "div",
      { class: "flow-node-top" },
      el("span", { class: "flow-node-label", text: node.label ?? nodeId }),
      nodeId === flow.entry
        ? el("span", { class: "chip chip-good", text: "START" })
        : node.kind === "close"
          ? el("span", { class: "chip chip-warn", text: "END" })
          : null,
    ),
    el("div", { class: "flow-node-say", text: node.say || "— no line written —" }),
    el(
      "div",
      { class: "flow-node-foot" },
      el("span", { class: "flow-tag", text: node.motion }),
      el("span", { class: "flow-tag", text: node.emotion }),
      el("span", { class: "flow-tag", text: `${node.budgetSec}s` }),
      node.kind !== "close"
        ? el("span", { class: "flow-tag", text: `${(node.branches ?? []).length} branches` })
        : null,
    ),
  );
}

function drawEdges(stage, svg) {
  const box = stage.getBoundingClientRect();
  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
  svg.setAttribute("width", box.width);
  svg.setAttribute("height", box.height);

  const anchorOf = (nodeId) => {
    const card = stage.querySelector(`[data-node="${CSS.escape(nodeId)}"]`);
    if (!card) return null;
    const rect = card.getBoundingClientRect();
    return {
      top: { x: rect.left - box.left + rect.width / 2, y: rect.top - box.top },
      bottom: {
        x: rect.left - box.left + rect.width / 2,
        y: rect.bottom - box.top,
      },
    };
  };

  const ns = "http://www.w3.org/2000/svg";
  for (const [nodeId, node] of Object.entries(flow.nodes)) {
    const from = anchorOf(nodeId);
    if (!from) continue;
    const edges = (node.branches ?? []).map((branch) => ({
      to: branch.to,
      label: branch.when,
    }));

    edges.forEach((edge, index) => {
      const to = anchorOf(edge.to);
      if (!to) return;
      const path = document.createElementNS(ns, "path");
      const midY = (from.bottom.y + to.top.y) / 2;
      path.setAttribute(
        "d",
        `M ${from.bottom.x} ${from.bottom.y} C ${from.bottom.x} ${midY}, ${to.top.x} ${midY}, ${to.top.x} ${to.top.y}`,
      );
      path.setAttribute(
        "class",
        `flow-edge ${nodeId === selectedId ? "is-hot" : ""}`,
      );
      svg.append(path);

      if (nodeId === selectedId && edge.label) {
        const text = document.createElementNS(ns, "text");
        text.setAttribute("x", (from.bottom.x + to.top.x) / 2);
        text.setAttribute("y", midY + (index % 2 ? 13 : -4));
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("class", "flow-edge-label");
        text.textContent =
          edge.label.length > 42 ? `${edge.label.slice(0, 40)}…` : edge.label;
        svg.append(text);
      }
    });
  }
}

function canvas() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "flow-links");

  const levels = el(
    "div",
    { class: "flow-levels" },
    ...levelize().map((row) =>
      el("div", { class: "flow-level" }, ...row.map(nodeCard)),
    ),
  );

  const stage = el("div", { class: "flow-stage" }, svg, levels);
  requestAnimationFrame(() => drawEdges(stage, svg));
  addEventListener("resize", () => drawEdges(stage, svg), { once: true });
  return stage;
}

function nodeOptions(currentValue) {
  return Object.entries(flow.nodes).map(([nodeId, node]) =>
    el("option", {
      value: nodeId,
      selected: nodeId === currentValue,
      text: `${node.label ?? nodeId}${node.kind === "close" ? " (end)" : ""}`,
    }),
  );
}

function change(patch) {
  Object.assign(flow.nodes[selectedId], patch);
  dirty = true;
  render();
}

function inspector() {
  const node = flow.nodes[selectedId];
  const isClose = node.kind === "close";

  const branchRows = (node.branches ?? []).map((branch, index) =>
    el(
      "div",
      { class: "branch-row" },
      el("input", {
        type: "text",
        value: branch.when,
        placeholder: "If the candidate…",
        onChange: (event) => {
          node.branches[index].when = event.target.value;
          dirty = true;
        },
      }),
      el(
        "select",
        {
          onChange: (event) => {
            node.branches[index].to = event.target.value;
            change({});
          },
        },
        ...nodeOptions(branch.to),
      ),
      el("button", {
        class: "icon-btn",
        type: "button",
        title: "Remove branch",
        text: "×",
        onClick: () => {
          node.branches.splice(index, 1);
          change({});
        },
      }),
    ),
  );

  return el(
    "div",
    { class: "card inspector" },
    el(
      "div",
      { class: "card-head" },
      el("h3", { text: "Node" }),
      el("span", { class: "u-mono u-muted", text: selectedId }),
    ),
    el(
      "div",
      { class: "field" },
      el("label", { text: "Label" }),
      el("input", {
        type: "text",
        value: node.label ?? "",
        onChange: (event) => change({ label: event.target.value }),
      }),
    ),
    el(
      "div",
      { class: "field" },
      el("label", { text: "What the avatar says" }),
      el("div", {
        class: "hint",
        text: "Spoken aloud. One or two sentences. {{org}}, {{role}} and {{candidate}} are filled in live.",
      }),
      el("textarea", {
        value: node.say ?? "",
        onChange: (event) => change({ say: event.target.value }),
      }),
    ),
    el(
      "div",
      { class: "grid-2" },
      el(
        "div",
        { class: "field" },
        el("label", { text: "Gesture" }),
        el(
          "select",
          { onChange: (event) => change({ motion: event.target.value }) },
          ...config.motionSlots.map((slot) =>
            el("option", {
              value: slot.key,
              selected: slot.key === node.motion,
              text: slot.label,
            }),
          ),
        ),
      ),
      el(
        "div",
        { class: "field" },
        el("label", { text: "Expression" }),
        el(
          "select",
          { onChange: (event) => change({ emotion: event.target.value }) },
          ...config.emotions.map((emotion) =>
            el("option", {
              value: emotion,
              selected: emotion === node.emotion,
              text: emotion,
            }),
          ),
        ),
      ),
    ),
    el(
      "div",
      { class: "grid-2" },
      el(
        "div",
        { class: "field" },
        el("label", { text: "Intensity" }),
        el(
          "select",
          { onChange: (event) => change({ intensity: event.target.value }) },
          ...config.intensities.map((level) =>
            el("option", {
              value: level,
              selected: level === node.intensity,
              text: level,
            }),
          ),
        ),
      ),
      el(
        "div",
        { class: "field" },
        el("label", { text: "Time budget" }),
        el("input", {
          type: "number",
          value: node.budgetSec,
          min: 5,
          max: 120,
          onChange: (event) => change({ budgetSec: Number(event.target.value) }),
        }),
      ),
    ),
    isClose
      ? null
      : el(
          "div",
          { class: "field" },
          el("label", { text: "Scores toward" }),
          el(
            "select",
            { onChange: (event) => change({ dimension: event.target.value }) },
            ...config.dimensions.map((dimension) =>
              el("option", {
                value: dimension.key,
                selected: dimension.key === node.dimension,
                text: dimension.label,
              }),
            ),
          ),
        ),
    isClose
      ? el("p", {
          class: "hint",
          style: { marginTop: "14px" },
          text: "This is the closing node. It asks nothing and ends the interview.",
        })
      : el(
          "div",
          { style: { marginTop: "20px" } },
          el("label", { text: "Branches" }),
          el("div", {
            class: "hint",
            style: { marginBottom: "10px" },
            text: "After the answer, whichever condition matches decides where the interview goes next.",
          }),
          ...branchRows,
          el(
            "div",
            { class: "row" },
            el("button", {
              class: "btn btn-ghost btn-sm",
              type: "button",
              text: "+ Add branch",
              onClick: () => {
                node.branches = node.branches ?? [];
                node.branches.push({
                  when: "",
                  to: node.fallback ?? Object.keys(flow.nodes)[0],
                });
                change({});
              },
            }),
          ),
          el(
            "div",
            { class: "field", style: { marginTop: "16px" } },
            el("label", { text: "If nothing matches" }),
            el(
              "select",
              { onChange: (event) => change({ fallback: event.target.value }) },
              ...nodeOptions(node.fallback),
            ),
          ),
        ),
  );
}

function issues() {
  const problems = [];
  if (!flow.nodes[flow.entry]) problems.push("The entry node is missing.");
  for (const [nodeId, node] of Object.entries(flow.nodes)) {
    if (!node.say?.trim()) problems.push(`"${node.label ?? nodeId}" has no line to speak.`);
    for (const branch of node.branches ?? []) {
      if (!flow.nodes[branch.to]) problems.push(`"${node.label ?? nodeId}" branches nowhere.`);
      if (!branch.when?.trim()) problems.push(`"${node.label ?? nodeId}" has an unlabelled branch.`);
    }
  }
  if (!Object.values(flow.nodes).some((node) => node.kind === "close")) {
    problems.push("There is no closing node.");
  }
  return problems;
}

function render() {
  const problems = issues();

  main.replaceChildren(
    el(
      "div",
      { class: "page-head" },
      el(
        "div",
        {},
        el("div", { class: "eyebrow", text: "Step 3 · Dialogue Map" }),
        el("h1", { text: flow.role }),
        el("p", {
          text:
            "Each box is something the avatar says. Each line is a decision it makes " +
            "from the candidate's answer. Click a box to edit it.",
        }),
      ),
      el(
        "div",
        { class: "row" },
        allFlows.length > 1
          ? el(
              "select",
              {
                style: { width: "auto", minWidth: "190px" },
                onChange: (event) => {
                  if (dirty && !confirm("You have unsaved changes. Leave anyway?")) {
                    event.target.value = flow.id;
                    return;
                  }
                  location.href = `/org/flow.html?flow=${event.target.value}`;
                },
              },
              ...allFlows.map((item) =>
                el("option", {
                  value: item.id,
                  selected: item.id === flow.id,
                  text: item.role,
                }),
              ),
            )
          : null,
        dirty ? el("span", { class: "chip chip-warn", text: "Unsaved" }) : null,
        el("a", {
          class: "btn btn-ghost btn-sm",
          href: `/org/motions.html?flow=${flow.id}`,
          text: "Avatar & motion",
        }),
        el("button", {
          class: "btn btn-primary btn-sm",
          text: "Save map",
          onClick: (event) =>
            withBusy(event.currentTarget, "Saving…", async () => {
              const { errors } = await api(`/api/flows/${flow.id}`, {
                method: "PATCH",
                body: { nodes: flow.nodes, entry: flow.entry },
              });
              dirty = false;
              toast(
                errors.length ? `Saved — ${errors.length} issue(s) remain` : "Saved",
                errors.length ? "bad" : "good",
              );
              render();
            }),
        }),
        el("a", {
          class: "btn btn-ghost btn-sm",
          href: `/i/${flow.id}`,
          text: "Preview ↗",
        }),
      ),
    ),
    problems.length
      ? el(
          "div",
          {
            class: "card",
            style: {
              borderColor: "rgba(245,181,68,.35)",
              background: "rgba(245,181,68,.06)",
              marginBottom: "16px",
            },
          },
          el("h3", { text: `${problems.length} thing${problems.length > 1 ? "s" : ""} to fix` }),
          el(
            "ul",
            { class: "bullets", style: { marginTop: "8px" } },
            ...problems.slice(0, 6).map((problem) => el("li", { text: problem })),
          ),
        )
      : null,
    el(
      "div",
      { class: "editor" },
      el("div", { class: "card", style: { padding: "8px" } }, canvas()),
      inspector(),
    ),
  );
}

render();
