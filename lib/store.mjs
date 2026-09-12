import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

// One promise chain per file. Concurrent put()s on the same collection would
// otherwise read-modify-write the same snapshot and silently drop a document.
const writeQueues = new Map();
const cache = new Map();

const fileFor = (name) => join(DATA_DIR, `${name}.json`);

async function loadAll(name) {
  if (cache.has(name)) return cache.get(name);
  let docs = {};
  try {
    docs = JSON.parse(await readFile(fileFor(name), "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  cache.set(name, docs);
  return docs;
}

function enqueue(name, job) {
  const next = (writeQueues.get(name) ?? Promise.resolve()).then(job, job);
  writeQueues.set(
    name,
    next.catch(() => {}),
  );
  return next;
}

async function persist(name, docs) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(fileFor(name), JSON.stringify(docs, null, 2), "utf8");
  cache.set(name, docs);
}

export function id(prefix) {
  const stamp = Date.now().toString(36);
  const noise = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${stamp}${noise}`;
}

export function collection(name) {
  return {
    async all() {
      return Object.values(await loadAll(name));
    },
    async get(docId) {
      return (await loadAll(name))[docId] ?? null;
    },
    async find(predicate) {
      return (await this.all()).find(predicate) ?? null;
    },
    async filter(predicate) {
      return (await this.all()).filter(predicate);
    },
    put(doc) {
      return enqueue(name, async () => {
        const docs = { ...(await loadAll(name)) };
        const saved = { ...doc, updatedAt: new Date().toISOString() };
        docs[saved.id] = saved;
        await persist(name, docs);
        return saved;
      });
    },
    patch(docId, changes) {
      return enqueue(name, async () => {
        const docs = { ...(await loadAll(name)) };
        if (!docs[docId]) throw new Error(`${name}: no document ${docId}`);
        const saved = {
          ...docs[docId],
          ...changes,
          updatedAt: new Date().toISOString(),
        };
        docs[docId] = saved;
        await persist(name, docs);
        return saved;
      });
    },
    remove(docId) {
      return enqueue(name, async () => {
        const docs = { ...(await loadAll(name)) };
        delete docs[docId];
        await persist(name, docs);
      });
    },
  };
}

export const orgs = collection("orgs");
export const flows = collection("flows");
export const sessions = collection("sessions");
