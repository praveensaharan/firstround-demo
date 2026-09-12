import {
  api,
  el,
  shell,
  toast,
  activeOrg,
  fmtDate,
  withBusy,
} from "./ui.js";

const main = document.getElementById("main");
document.getElementById("shell").prepend(shell("org"));

const config = await api("/api/config");
let orgList = (await api("/api/orgs")).items;
let org = orgList.find((item) => item.id === activeOrg.get()) ?? orgList[0] ?? null;
let rolePreset = config.rolePresets[0];

function render() {
  main.replaceChildren(
    el(
      "div",
      { class: "page-head" },
      el(
        "div",
        {},
        el("div", { class: "eyebrow", text: "Step 1" }),
        el("h1", { text: "Your organization" }),
        el("p", {
          text:
            "Everything the interviewer knows and every rule it obeys comes from this " +
            "page. Nothing here is a generic template — the avatar only ever speaks from " +
            "what you write below.",
        }),
      ),
      orgList.length > 1 ? orgSwitcher() : null,
    ),
    org ? orgEditor() : orgCreate(),
    org ? interviewBuilder() : null,
    org ? interviewList() : null,
  );
}

function orgSwitcher() {
  return el(
    "select",
    {
      style: { width: "220px" },
      onChange: (event) => {
        org = orgList.find((item) => item.id === event.target.value);
        activeOrg.set(org.id);
        render();
      },
    },
    ...orgList.map((item) =>
      el("option", { value: item.id, selected: item.id === org?.id, text: item.name }),
    ),
  );
}

function orgCreate() {
  const name = el("input", { type: "text", placeholder: "Acme Robotics" });
  return el(
    "div",
    { class: "card" },
    el("h2", { text: "Create your organization" }),
    el("p", {
      class: "card-sub",
      text: "One workspace holds your knowledge base, your rules and every interview you publish.",
    }),
    el("div", { class: "field", style: { marginTop: "18px" } }, el("label", { text: "Organization name" }), name),
    el(
      "div",
      { class: "row", style: { marginTop: "18px" } },
      el("button", {
        class: "btn btn-primary",
        text: "Create workspace",
        onClick: (event) =>
          withBusy(event.currentTarget, "Creating…", async () => {
            if (!name.value.trim()) return toast("Give it a name first", "bad");
            org = await api("/api/orgs", { body: { name: name.value } });
            orgList.push(org);
            activeOrg.set(org.id);
            render();
          }),
      }),
      el("button", {
        class: "btn btn-ghost",
        text: "Use the sample organization",
        onClick: (event) =>
          withBusy(event.currentTarget, "Loading…", async () => {
            org = await api("/api/orgs", { body: config.sampleOrg });
            orgList.push(org);
            activeOrg.set(org.id);
            toast("Sample organization loaded", "good");
            render();
          }),
      }),
    ),
  );
}

function orgEditor() {
  const name = el("input", { type: "text", value: org.name });
  const knowledge = el("textarea", {
    class: "tall",
    value: org.knowledge ?? "",
    placeholder:
      "What do you build? What is the stack? How does the team work? The interviewer " +
      "speaks from this, so write it the way you would brief a new recruiter.",
  });
  const rules = el("textarea", {
    class: "tall",
    value: org.rules ?? "",
    placeholder:
      "One rule per line. What must always be probed? What must never be asked?\n" +
      "e.g. Never ask about salary or notice period.\n" +
      "e.g. Always make them name a specific system they personally built.",
  });

  return el(
    "div",
    { class: "card" },
    el(
      "div",
      { class: "card-head" },
      el(
        "div",
        {},
        el("h2", { text: "Knowledge & rules" }),
        el("p", {
          class: "card-sub",
          text: "This is the interviewer's entire world view. Be specific — vagueness here becomes vagueness on the call.",
        }),
      ),
      el("span", { class: "chip", text: `Updated ${fmtDate(org.updatedAt)}` }),
    ),
    el("div", { class: "field" }, el("label", { text: "Organization name" }), name),
    el(
      "div",
      { class: "field" },
      el("label", { text: "Knowledge base" }),
      el("div", {
        class: "hint",
        text: "What the interviewer knows about you. Products, stack, scale, how the team works.",
      }),
      knowledge,
    ),
    el(
      "div",
      { class: "field" },
      el("label", { text: "Interview rules" }),
      el("div", {
        class: "hint",
        text: "Hard constraints. These are enforced when the Dialogue Map is generated and again when the transcript is scored.",
      }),
      rules,
    ),
    el(
      "div",
      { class: "row", style: { marginTop: "20px" } },
      el("button", {
        class: "btn btn-primary",
        text: "Save",
        onClick: (event) =>
          withBusy(event.currentTarget, "Saving…", async () => {
            org = await api(`/api/orgs/${org.id}`, {
              method: "PATCH",
              body: {
                name: name.value,
                knowledge: knowledge.value,
                rules: rules.value,
              },
            });
            orgList = orgList.map((item) => (item.id === org.id ? org : item));
            toast("Saved", "good");
            render();
          }),
      }),
      !org.knowledge
        ? el("button", {
            class: "btn btn-ghost",
            text: "Fill with sample content",
            onClick: () => {
              knowledge.value = config.sampleOrg.knowledge;
              rules.value = config.sampleOrg.rules;
              toast("Sample content filled in — review it, then save");
            },
          })
        : null,
    ),
  );
}

function interviewBuilder() {
  const title = el("input", { type: "text", value: rolePreset.title });
  const seniority = el("input", { type: "text", value: rolePreset.seniority });
  const mustHaves = el("textarea", { value: rolePreset.mustHaves });
  const duration = el(
    "select",
    {},
    ...[
      [90, "90 seconds — lightning screen"],
      [120, "2 minutes — recommended"],
      [180, "3 minutes — deeper screen"],
      [300, "5 minutes — full first round"],
    ].map(([value, label]) =>
      el("option", { value, selected: value === 120, text: label }),
    ),
  );

  const tiles = el(
    "div",
    { class: "tiles" },
    ...config.rolePresets.map((preset) =>
      el(
        "button",
        {
          class: "tile",
          type: "button",
          "aria-pressed": String(preset.key === rolePreset.key),
          onClick: () => {
            rolePreset = preset;
            title.value = preset.title;
            seniority.value = preset.seniority;
            mustHaves.value = preset.mustHaves;
            tiles.querySelectorAll(".tile").forEach((tile) =>
              tile.setAttribute(
                "aria-pressed",
                String(tile.dataset.key === preset.key),
              ),
            );
          },
          "data-key": preset.key,
        },
        el("strong", { text: preset.title }),
        el("span", { text: preset.seniority }),
      ),
    ),
  );

  return el(
    "div",
    { class: "card" },
    el(
      "div",
      {},
      el("div", { class: "eyebrow", text: "Step 2" }),
      el("h2", { text: "Generate an interview" }),
      el("p", {
        class: "card-sub",
        text: "Pick a role, then DeepSeek writes a branching Dialogue Map from your knowledge and rules. You edit it next.",
      }),
    ),
    el("div", { style: { marginTop: "18px" } }, tiles),
    el(
      "div",
      { class: "grid-2", style: { marginTop: "20px" } },
      el("div", { class: "field" }, el("label", { text: "Role title" }), title),
      el("div", { class: "field" }, el("label", { text: "Seniority" }), seniority),
    ),
    el(
      "div",
      { class: "field" },
      el("label", { text: "Must-haves" }),
      el("div", {
        class: "hint",
        text: "What a candidate has to evidence to be worth a real interview. Drives both the questions and the scoring.",
      }),
      mustHaves,
    ),
    el("div", { class: "field" }, el("label", { text: "Interview length" }), duration),
    el(
      "div",
      { class: "row", style: { marginTop: "20px" } },
      el("button", {
        class: "btn btn-primary",
        text: "Generate Dialogue Map",
        onClick: (event) =>
          withBusy(event.currentTarget, "Writing the interview…", async () => {
            if (!org.knowledge?.trim()) {
              return toast("Add a knowledge base first — save it, then generate", "bad");
            }
            const { flow, errors } = await api("/api/flows/generate", {
              body: {
                orgId: org.id,
                durationSec: Number(duration.value),
                role: {
                  title: title.value,
                  seniority: seniority.value,
                  mustHaves: mustHaves.value,
                },
              },
            });
            if (errors.length) toast(`Generated with ${errors.length} issue(s) to fix`, "bad");
            location.href = `/org/flow.html?flow=${flow.id}`;
          }),
      }),
      el("span", {
        class: "hint",
        text: config.llmReady ? "Takes about 10 seconds." : "LLM_API_KEY is not set.",
      }),
    ),
  );
}

function interviewList() {
  const holder = el("div", { class: "card" });
  holder.append(
    el("div", { class: "card-head" }, el("h2", { text: "Published interviews" })),
    el("div", { class: "list", id: "flow-list" }, el("div", { class: "skeleton", style: { height: "62px" } })),
  );
  api(`/api/flows?orgId=${org.id}`).then(({ items }) => {
    const list = holder.querySelector("#flow-list");
    list.replaceChildren(
      ...(items.length
        ? items.map((flow) =>
            el(
              "div",
              { class: "list-item" },
              el(
                "div",
                { class: "list-item-main" },
                el("strong", { text: flow.role }),
                el("span", {
                  text: `${Object.keys(flow.nodes ?? {}).length} nodes · ${flow.durationSec}s · created ${fmtDate(flow.createdAt)}`,
                }),
              ),
              el(
                "div",
                { class: "row" },
                el("button", {
                  class: "btn btn-ghost btn-sm",
                  text: "Copy candidate link",
                  onClick: async () => {
                    await navigator.clipboard.writeText(`${location.origin}/i/${flow.id}`);
                    toast("Link copied", "good");
                  },
                }),
                el("a", {
                  class: "btn btn-ghost btn-sm",
                  href: `/org/flow.html?flow=${flow.id}`,
                  text: "Edit map",
                }),
                el("a", {
                  class: "btn btn-primary btn-sm",
                  href: `/i/${flow.id}`,
                  text: "Preview",
                }),
              ),
            ),
          )
        : [
            el(
              "div",
              { class: "empty" },
              el("strong", { text: "Nothing published yet" }),
              "Generate your first Dialogue Map above.",
            ),
          ]),
    );
  });
  return holder;
}

render();
