\// src/probe_v0.js
(() => {
  console.log("[VG probe] content script injected on v0.app ✅", location.href);
  window.__VG_PROBE_V0__ = true;
})();
