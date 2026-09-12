import { api } from "./ui.js";

let enginePromise = null;

function loadEngine(url) {
  enginePromise ??= new Promise((resolve, reject) => {
    const script = Object.assign(document.createElement("script"), {
      type: "module",
      src: url,
      onload: resolve,
      onerror: () => reject(new Error("The avatar engine failed to load.")),
    });
    document.head.append(script);
  });
  return enginePromise;
}

/**
 * Boots <sv-presenter> against a stage. PRESENTER_STATUS:Ready is an event with
 * no readable equivalent, so the listener has to be attached before init.
 */
export async function boot(element, stage, { timeoutMs = 45000 } = {}) {
  if (!stage?.avatarId || !stage?.sceneId) {
    throw new Error("This interview has no avatar and scene selected yet.");
  }
  const config = await api("/api/config");
  // Ready never arrives for a target the account cannot resolve, and there is no
  // failure event to pair with it — without this the caller waits forever.
  const ready = new Promise((resolve, reject) => {
    element.addEventListener("PRESENTER_STATUS", (event) => {
      if (event.detail?.status === "Ready") resolve();
    });
    setTimeout(
      () =>
        reject(
          new Error(
            "The avatar did not finish loading. Check the avatar/scene/voice ids and that PERXONA_API_BASE_URL and PRESENTER_URL name the same region.",
          ),
        ),
      timeoutMs,
    );
  });
  await loadEngine(config.presenterUrl);
  const { connect_key: key } = await api("/api/connect-key");
  await element.initializeWithConnectKey(key, {
    avatarId: stage.avatarId,
    sceneId: stage.sceneId,
    ...(stage.voiceId ? { voiceId: stage.voiceId } : {}),
  });
  await ready;
  return element;
}

let unlocked = false;

/** Autoplay policy: this has to run inside a real user gesture, once. */
export async function unlock(presenter) {
  if (unlocked) return;
  await presenter.resumeAudioPlayback?.();
  unlocked = true;
}

/**
 * present() resolves when the line is QUEUED, not when it has been spoken, and
 * reports failure by resolving {success:false} rather than throwing.
 */
export async function say(presenter, text, { emotion, intensity } = {}) {
  const options = {};
  if (emotion) options.emotion = emotion;
  if (intensity) options.intensity = intensity;
  const result = await presenter.present(text, options);
  if (!result?.success) {
    console.error(`present() failed (${result?.code}): ${result?.message ?? ""}`);
  }
  return result;
}

export function whenFinished(presenter) {
  return new Promise((resolve) => {
    presenter.addEventListener("ALL_PERFORMANCE_FINISHED", resolve, {
      once: true,
    });
  });
}
