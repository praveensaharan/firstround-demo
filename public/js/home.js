import { api, el, fmtDate, toast } from "./ui.js";

const mount = document.getElementById("live-list");

try {
  const { items: interviews } = await api("/api/flows");
  if (!interviews.length) {
    mount.append(
      el(
        "div",
        { class: "empty" },
        el("strong", { text: "No interviews published yet" }),
        "Open the console and generate your first Dialogue Map.",
      ),
    );
  } else {
    const orgNames = Object.fromEntries(
      (await api("/api/orgs")).items.map((org) => [org.id, org.name]),
    );
    mount.append(
      el(
        "div",
        { class: "card-head" },
        el("h2", { text: "Live interviews" }),
        el("a", { class: "btn btn-ghost btn-sm", href: "/org/", text: "Console" }),
      ),
      el(
        "div",
        { class: "list" },
        ...interviews.map((flow) =>
          el(
            "div",
            { class: "list-item" },
            el(
              "div",
              { class: "list-item-main" },
              el("strong", { text: flow.role }),
              el("span", {
                text: `${orgNames[flow.orgId] ?? "Unknown org"} · ${
                  Object.keys(flow.nodes ?? {}).length
                } nodes · ${flow.durationSec}s · ${fmtDate(flow.createdAt)}`,
              }),
            ),
            el(
              "div",
              { class: "row" },
              el("button", {
                class: "btn btn-ghost btn-sm",
                text: "Copy link",
                onClick: async () => {
                  const url = `${location.origin}/i/${flow.id}`;
                  await navigator.clipboard.writeText(url);
                  toast("Candidate link copied", "good");
                },
              }),
              el("a", {
                class: "btn btn-primary btn-sm",
                href: `/i/${flow.id}`,
                text: "Start interview",
              }),
            ),
          ),
        ),
      ),
    );
  }
} catch (err) {
  toast(err.message, "bad");
}
