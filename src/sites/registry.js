// src/sites/registry.js
(() => {
  const NS = (window.VG = window.VG || {});
  const REG = (NS.sites = NS.sites || {});

  // Per-domain overrides. Only list sites that need special handling.
  const MAP = {
    "replit.com": { strategy: "rewrite" }, // payload rewrite preferred here
    // 'lovable.dev': { strategy: 'swap' }, // default anyway
    // 'bolt.new':    { strategy: 'swap' },
    // 'cursor.sh':   { strategy: 'swap' },
  };

  REG.getStrategyForHost = function (hostname) {
    const h = String(hostname || location.hostname || "").toLowerCase();
    return MAP[h]?.strategy || "swap";
  };
})();
