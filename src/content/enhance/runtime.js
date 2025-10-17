// src/content/enhance/runtime.js
// Unified runtime messaging helpers for cross-browser support.

export function getRuntime() {
  if (typeof browser !== "undefined" && browser?.runtime?.sendMessage) {
    return browser.runtime;
  }
  if (typeof chrome !== "undefined" && chrome?.runtime?.sendMessage) {
    return chrome.runtime;
  }
  return null;
}

export function sendRuntimeMessage(message) {
  const runtime = getRuntime();
  if (!runtime || typeof runtime.sendMessage !== "function") {
    return Promise.resolve({
      ok: false,
      error: "BACKGROUND_UNAVAILABLE",
    });
  }

  const isBrowserRuntime =
    typeof browser !== "undefined" && runtime === browser.runtime;
  if (isBrowserRuntime) {
    return runtime
      .sendMessage(message)
      .then((resp) => resp ?? null)
      .catch((err) => ({
        ok: false,
        error: err?.message || "BACKGROUND_UNAVAILABLE",
      }));
  }

  return new Promise((resolve) => {
    try {
      runtime.sendMessage(message, (resp) => {
        const lastErr =
          (typeof chrome !== "undefined" &&
            chrome.runtime?.lastError?.message) ||
          null;
        if (lastErr) {
          resolve({
            ok: false,
            error: lastErr,
          });
        } else {
          resolve(resp ?? null);
        }
      });
    } catch (err) {
      resolve({
        ok: false,
        error: err?.message || "BACKGROUND_UNAVAILABLE",
      });
    }
  });
}
