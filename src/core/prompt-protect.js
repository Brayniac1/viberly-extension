// src/core/prompt-protect.js
(() => {
  const NS = (window.VG = window.VG || {});
  const PROTECT = (NS.protect = NS.protect || {});
  const PENDING = new Map(); // messageUid -> { targetElRef?: WeakRef<Element> }

  // --- helpers ---
  function isEditable(el) { return !!el && (('value' in el) || el.isContentEditable); }
  function getText(el)    { return ('value' in el) ? (el.value ?? '') : (el.isContentEditable ? el.innerText : ''); }
  function setText(el, v) { if ('value' in el) el.value = v; else if (el.isContentEditable) el.innerText = v; }
  function fireInput(el){ try { el.dispatchEvent(new Event('input', { bubbles:true })); } catch {} }
  function badge(el,msg="Protected prompt"){ try {
    // no-op UI hook; wire to your HUD if you want a lock chip
  } catch{} }

  function addInvisibleSignature(el, messageUid) {
    // zero-width watermark, helps network rewrite match payloads
    const sig = `\u200B\u2060[vg:${messageUid}]\u2060\u200B`;
    setText(el, getText(el) + sig);
    fireInput(el);
  }

  // --- public: free insert ---
  PROTECT.insertFreePrompt = function(targetEl, template) {
    if (!isEditable(targetEl)) return;
    setText(targetEl, template);
    fireInput(targetEl);
  };

  // --- public: paid insert (description in DOM, real text stays in BG) ---
  PROTECT.insertPaidPrompt = function(targetEl, { promptId, description, vars }) {
    if (!isEditable(targetEl)) return;
    chrome.runtime.sendMessage({ type: 'VG_COMPOSE', promptId, vars }, (resp = {}) => {
      const { ok, messageUid, err } = resp;
      if (!ok || !messageUid) { console.warn('VG_COMPOSE failed', err); return; }
      setText(targetEl, description);
      fireInput(targetEl);
      targetEl.dataset.vgMsgid = messageUid;
      addInvisibleSignature(targetEl, messageUid); // harmless in free text, invisible
      PENDING.set(messageUid, { targetElRef: new WeakRef(targetEl), at: Date.now() });
      badge(targetEl);
    });
  };

  // --- called right before *your* final send (countdown zero / button click) ---
  PROTECT.prepareSend = function(editorEl, strategy = 'swap') {
    try {
      const messageUid = editorEl?.dataset?.vgMsgid;
      if (!messageUid) return false;

      if (strategy === 'rewrite') {
        // DOM remains as description; network patch will swap payload in-flight
        return true; // we handled it
      }

      // strategy === 'swap' (default)
      const before = getText(editorEl);
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'VG_GET_REAL', messageUid }, (resp = {}) => {
          const { ok, realText } = resp;
          if (!ok || !realText) return resolve(false);

          setText(editorEl, realText);
          fireInput(editorEl);

          // Let the host grab the value this tick, then restore
          setTimeout(() => {
            setText(editorEl, before);
            fireInput(editorEl);
            resolve(true);
          }, 0);
        });
      });
    } catch { return false; }
  };

  // --- optional: set up listeners once per page (key down / send button hooks) ---
  PROTECT.wireSendGuards = function({ editorEl, sendBtn, strategy = 'swap' } = {}) {
    if (editorEl) {
      editorEl.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          const handled = await PROTECT.prepareSend(editorEl, strategy);
          if (handled) {
            e.preventDefault();
            // Your existing “submit” trigger (countdown path) will run next
          }
        }
      });
    }
    if (sendBtn) {
      sendBtn.addEventListener('click', async (e) => {
        const handled = await PROTECT.prepareSend(editorEl, strategy);
        if (handled) e.preventDefault();
      });
    }
  };
})();
