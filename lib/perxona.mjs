const BASE = (process.env.PERXONA_API_BASE_URL ?? "").replace(/\/+$/, "");
const SECRET = process.env.PERXONA_CONNECT_SECRET_KEY;

export const PUBLISHABLE_KEY = process.env.PERXONA_CONNECT_PUBLISHABLE_KEY;
export const PRESENTER_URL =
  process.env.PRESENTER_URL ??
  "https://cdn.perxona.ai/prod/latest/widget/entry/presenter.js";

export const DEFAULT_STAGE = {
  avatarId: process.env.DEFAULT_AVATAR_ID || null,
  sceneId: process.env.DEFAULT_SCENE_ID || null,
  voiceId: process.env.DEFAULT_VOICE_ID || null,
};

async function call(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "X-Connect-Key": SECRET, Accept: "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = body.details ?? body.detail ?? res.statusText;
    const detail = typeof raw === "string" ? raw : JSON.stringify(raw);
    throw Object.assign(new Error(`Perxona ${res.status}: ${detail}`), {
      status: res.status,
      code: body.code,
    });
  }
  return body;
}

// Catalog rows arrive with the id under a resource-specific key.
const normalize = (items = []) =>
  items.map((item) => ({
    ...item,
    id: item.id ?? item.avatar_id ?? item.scene_id ?? item.voice_id,
  }));

export const avatars = async () =>
  normalize((await call("/api/v1/connect/assets/avatars?size=100")).items);

export const scenes = async () =>
  normalize((await call("/api/v1/connect/assets/scenes?size=100")).items);

export const voices = async () =>
  normalize((await call("/api/v1/connect/voices?size=100")).items);

export const avatarMotions = async (avatarId) =>
  normalize(
    (
      await call(
        `/api/v1/connect/assets/avatars/${encodeURIComponent(avatarId)}/motions?size=100`,
      )
    ).items,
  ).map((motion) => ({
    id: motion.id ?? motion.motion_id,
    name: motion.name ?? motion.motion_name ?? "Untitled motion",
    tags: motion.tags ?? [],
  }));

export const configured = () => Boolean(BASE && SECRET && PUBLISHABLE_KEY);
