/**
 * Seeds the sample organization and one interview per role preset, by driving
 * the running server's own API — so anything that breaks here is a real bug in
 * the endpoints, not in a parallel code path.
 *
 *   npm run dev      (in one terminal)
 *   npm run seed     (in another)
 */

const BASE = `http://localhost:${process.env.PORT || 8084}`;

async function call(path, body, method) {
  const res = await fetch(`${BASE}${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → ${res.status} ${data.error ?? ""}`);
  return data;
}

const config = await call("/api/config");
if (!config.llmReady) {
  console.error("LLM_API_KEY is not set — generation would fail. Aborting.");
  process.exit(1);
}

const existing = await call("/api/orgs");
let org = existing.items.find((item) => item.name === config.sampleOrg.name);
if (org) {
  console.log(`• Reusing organization "${org.name}"`);
} else {
  org = await call("/api/orgs", config.sampleOrg);
  console.log(`• Created organization "${org.name}"`);
}

for (const preset of config.rolePresets) {
  process.stdout.write(`• Generating "${preset.title}" … `);
  const started = Date.now();
  const { flow, errors } = await call("/api/flows/generate", {
    orgId: org.id,
    durationSec: 120,
    role: {
      title: preset.title,
      seniority: preset.seniority,
      mustHaves: preset.mustHaves,
    },
  });
  const paths = Object.values(flow.nodes).reduce(
    (total, node) => total + (node.branches?.length ?? 0),
    0,
  );
  console.log(
    `${Object.keys(flow.nodes).length} nodes, ${paths} branches, ` +
      `${((Date.now() - started) / 1000).toFixed(1)}s` +
      (errors.length ? `  ⚠ ${errors.length} issue(s)` : ""),
  );
  for (const problem of errors) console.log(`    ⚠ ${problem}`);
  console.log(`    ${BASE}/i/${flow.id}`);
}

console.log(`\nConsole: ${BASE}/org/\n`);
