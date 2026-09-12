/** Shared browser helpers. Plain ESM, no build step. */

export async function api(path, { method, body } = {}) {
  const res = await fetch(path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key === "style" && typeof value === "object")
      Object.assign(node.style, value);
    else if (key.startsWith("on") && typeof value === "function")
      node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in node && key !== "list") node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

export function toast(message, kind = "") {
  let dock = document.querySelector(".toasts");
  if (!dock) {
    dock = el("div", { class: "toasts" });
    document.body.append(dock);
  }
  const item = el("div", { class: `toast ${kind ? `toast--${kind}` : ""}`, text: message });
  dock.append(item);
  setTimeout(() => {
    item.style.opacity = "0";
    item.style.transition = "opacity .3s";
    setTimeout(() => item.remove(), 320);
  }, kind === "bad" ? 6000 : 3400);
}

export const param = (name) =>
  new URLSearchParams(location.search).get(name) ?? "";

export const fmtDate = (iso) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

/** Remembers which organization the console is working on across pages. */
export const activeOrg = {
  get: () => localStorage.getItem("fr.orgId") ?? "",
  set: (orgId) => localStorage.setItem("fr.orgId", orgId),
};

const NAV = [
  { key: "org", href: "/org/", label: "Organization", icon: "◉" },
  { key: "flow", href: "/org/flow.html", label: "Dialogue Map", icon: "⎇" },
  { key: "motions", href: "/org/motions.html", label: "Avatar & motion", icon: "✦" },
  { key: "reviews", href: "/org/reviews.html", label: "Candidates", icon: "▤" },
];

export function shell(activeKey) {
  return el(
    "aside",
    { class: "sidebar" },
    el(
      "a",
      { class: "brand", href: "/" },
      el("span", { class: "brand-mark", text: "F" }),
      "FirstRound",
    ),
    el(
      "nav",
      { class: "nav" },
      el("div", { class: "nav-label", text: "Console" }),
      ...NAV.map((item) =>
        el(
          "a",
          {
            href: item.href,
            class: item.key === activeKey ? "is-active" : "",
          },
          el("span", { text: item.icon }),
          item.label,
        ),
      ),
    ),
    el(
      "div",
      { style: { marginTop: "auto", fontSize: "11.5px", color: "var(--muted)" } },
      "Powered by Perxona",
    ),
  );
}

/** Swaps a button into a spinner for the duration of an async action. */
export async function withBusy(button, label, work) {
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = "";
  button.append(el("span", { class: "spinner" }), label);
  try {
    return await work();
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}

export function scoreColor(value, max = 100) {
  const pct = (value / max) * 100;
  if (pct >= 70) return "var(--good)";
  if (pct >= 45) return "var(--warn)";
  return "var(--bad)";
}

export function recChip(recommendation) {
  const tone =
    recommendation === "ADVANCE"
      ? "good"
      : recommendation === "REJECT"
        ? "bad"
        : "warn";
  return el("span", { class: `chip chip-${tone}`, text: recommendation });
}
