// src/ui/ai-chat.js
(() => {
  if (window.openAiChatModal) return; // idempotent

  // ---- small helpers ----
  const dbg = (...a) => { try { console.debug('[VG][AI]', ...a); } catch {} };

  function $(sel, root) { return (root || document).querySelector(sel); }

  function el(tag, css = '', text = '') {
    const n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text) n.textContent = text;
    return n;
  }

  function sendToBG(msg) {
    return new Promise((res) => {
      try { chrome.runtime.sendMessage(msg, (r) => res(r)); }
      catch { res({ ok:false, error:'bridge error' }); }
    });
  }

  async function ensureSignedIn() {
    try {
      const r = await sendToBG({ type: 'AUTH_STATUS' });
      if (r?.ok && r.signedIn) return true;
      await sendToBG({ type: 'VG_OPEN_SIGNIN_POPUP' });
      return false;
    } catch { return false; }
  }

  // --- tiny, safe scraper used for first-open "Summarize" ---
  async function collectLastMessages(n = 10) {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const take = [];
    try {
      const root = document;
      // prefer chat-like blocks near any composer
      const candSel = `
        [data-message-role],
        [data-testid="message"],
        .chat-message, .message, .msg, .bubble,
        article, .prose, [class*="prose"], [class*="markdown"]
      `;
      let nodes = Array.from(root.querySelectorAll(candSel));
      if (!nodes.length) nodes = Array.from(root.querySelectorAll('p,li,pre,blockquote'));

      for (const el of nodes.slice(-200)) {
        const txt = norm(el.innerText || el.textContent || '');
        if (!txt || txt.length < 16) continue;
        // naive role heuristic
        const roleAttr = (el.getAttribute?.('data-message-role') || '').toLowerCase();
        const role = roleAttr.includes('assistant') ? 'assistant' :
                     roleAttr.includes('user') ? 'user' :
                     (el.className || '').toLowerCase().includes('assistant') ? 'assistant' : 'user';
        take.push({ role, text: txt.slice(0, 4000) });
        if (take.length >= n) break;
      }
    } catch {}
    return take.slice(-n);
  }

  // ---- UI bits ----
  function addMessage(groupRoot, side /* 'user' | 'vg' */, text, opts = {}) {
    const { showMeta = true, minWidth = 0 } = opts;
    const wrap = document.createElement('div');
    wrap.className = 'msggroup ' + (side === 'user' ? 'right' : 'left');

    const meta = document.createElement('div');
    meta.className = 'meta';
    if (!showMeta) meta.style.display = 'none';

    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = (side === 'user') ? 'You' : 'Viberly';

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    meta.appendChild(who);
    meta.appendChild(time);

    const row = document.createElement('div');
    row.className = 'msg ' + (side === 'user' ? 'right' : 'left');

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (minWidth) bubble.style.minWidth = minWidth + 'px';
    bubble.textContent = text || '';

    row.appendChild(bubble);
    wrap.appendChild(meta);
    wrap.appendChild(row);
    groupRoot.appendChild(wrap);

    // header width = bubble width (for nice timestamp alignment)
    const sync = () => { const w = bubble.offsetWidth; if (w) meta.style.width = w + 'px'; };
    requestAnimationFrame(sync);
    window.addEventListener('resize', sync, { passive: true });

    const api = {
      setText(t) { bubble.textContent = t || ''; requestAnimationFrame(sync); },
      showMeta() { meta.style.display = ''; requestAnimationFrame(sync); }
    };
    groupRoot.scrollTop = groupRoot.scrollHeight;
    return api;
  }

  function buildModal() {
    const z = (window.__VG_CONSTS?.Z || 2147483600) + 10;

    const host = el('div', `
	  position:fixed; inset:0; z-index:${z};
	  display:flex; align-items:center; justify-content:center;
	  background:rgba(0,0,0,.55);
	`);
	host.id = 'vg-aichat-host';


    const box = el('div', `
      width:min(980px,94vw);
      height:86vh;
      display:flex; flex-direction:column; position:relative;
      background:#0f1116; color:#e5e7eb;
      border:1px solid #2a2a33; border-radius:16px;
      box-shadow:0 40px 100px rgba(0,0,0,.6); overflow:hidden;
      font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    `);

    box.innerHTML = `
      <style>
        .hdr{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;
             padding:14px 18px;background:#0f1116;border-bottom:1px solid #1f2230}
        .title{font-weight:600;font-size:14px}
        .row{display:flex;gap:8px;align-items:center}
        .btn{background:#7c3aed;color:#fff;border:0;border-radius:10px;height:32px;padding:0 10px;
             font:600 12px Inter, system-ui;cursor:pointer}
        .ghost{background:#1f1f26;color:#cbd5e1;border:1px solid #2a2a33}
        .close{width:28px;height:28px;border-radius:8px;background:#171a22;border:1px solid #2a2d39;color:#cbd5e1;cursor:pointer}
        .body{flex:1;overflow:auto;padding:16px 18px;display:flex;flex-direction:column;gap:12px;background:#0f1116}

        .msggroup{display:flex;flex-direction:column;gap:4px}
        .msggroup.left{align-items:flex-start}
        .msggroup.right{align-items:flex-end}
        .meta{display:flex;align-items:center;justify-content:space-between;width:auto;padding:0 2px;color:#9aa3b2;
              font:11px/1.2 Inter, system-ui}
        .meta .who{color:#e5e7eb;font-weight:600}
        .msggroup.right .meta{flex-direction:row-reverse}

        .msg{display:flex;gap:10px}
        .msg.left{justify-content:flex-start}
        .msg.right{justify-content:flex-end}
        .bubble{max-width:min(72ch,84%);padding:10px 12px;border-radius:12px;border:1px solid #242634;
                background:#0c0e13;color:#e5e7eb;white-space:pre-wrap;line-height:1.45}
        .msg.right .bubble{background:#12151d}

        .ftr{position:sticky;bottom:0;z-index:2;display:flex;gap:10px;align-items:flex-end;
             padding:12px 18px;background:#0f1116;border-top:1px solid #1f1f26}
        .input{flex:1;min-height:44px;max-height:160px;resize:vertical;background:#0f1116;color:#e5e7eb;
               border:1px solid #232634;border-radius:12px;padding:10px 12px;font:13px/1.4 Inter, system-ui}
        .send{background:#7c3aed;color:#fff;border:0;border-radius:10px;height:40px;padding:0 14px;
              font:600 13px Inter, system-ui;cursor:pointer}
        .send:disabled{opacity:.6;cursor:default}
      </style>

      <div class="hdr">
        <div class="row">
          <div class="title">AI Chat</div>
        </div>
        <div class="row">
	  <button id="ac-new" class="btn ghost" type="button">New</button>
          <button id="ac-summarize" class="btn ghost" type="button">Summarize</button>
          <button id="ac-close" class="close" type="button" aria-label="Close">✕</button>
        </div>
      </div>

      <div id="ac-body" class="body"></div>

      <div class="ftr">
        <textarea id="ac-input" class="input" placeholder="Type a message…"></textarea>
        <button id="ac-send" class="send" type="button" disabled>Send</button>
      </div>
    `;

    host.appendChild(box);
    document.body.appendChild(host);


    // Floating "Insert" pill for selected transcript text
    const insertBtn = el('button', `
      position:absolute; z-index:30; display:none; padding:6px 10px;
      font:600 12px Inter, system-ui; border-radius:10px; background:#7c3aed; color:#fff; border:0;
      box-shadow:0 8px 24px rgba(0,0,0,.45); cursor:pointer
    `, 'Insert');
    box.appendChild(insertBtn);

    return {
	  host,
	  box,
	  body: $('#ac-body', box),
	  input: $('#ac-input', box),
	  btnSend: $('#ac-send', box),
	  btnNew: $('#ac-new', box),
	  btnSummary: $('#ac-summarize', box),
	  btnClose: $('#ac-close', box),
	  insertBtn
	};
     } 


// Gate so send waits until we know whether we resumed or created a session
let __resumeResolve;
const __resumeReady = new Promise((r) => { __resumeResolve = r; });



  // ---- public opener ----
  window.openAiChatModal = async function openAiChatModal() {
  // Be modal right away so global capture listeners ignore clicks
  try { window.__VG_MODAL_ACTIVE = true; } catch {}

  // sign-in gate
  const ok = await ensureSignedIn();
  if (!ok) { try { window.__VG_MODAL_ACTIVE = false; } catch {}; return; }


    // singleton per open
    if (document.getElementById('vg-aichat-open-flag')) return;
    const flag = document.createElement('span');
    flag.id = 'vg-aichat-open-flag';
    flag.style.display = 'none';
    document.body.appendChild(flag);

    const ui = buildModal();
    let sessionId = null;
    const site = location.host;



// Helper: run first-open summary and create a session
async function runIntroSummaryInto(uiBody) {
  const intro = addMessage(uiBody, 'vg', 'Analyzing the last 10 messages…', { showMeta:false, minWidth:260 });
  try {
    const last10 = await collectLastMessages(10);
    const ans = await sendToBG({
      type: 'AI_CHAT:SUMMARIZE',
      site,
      messages: last10.length ? last10 : [{ role:'user', text:'(No messages found on page)'}]
    });
    console.debug('[AI_CHAT:SUMMARIZE] reply →', ans);
	const summary =
	  (typeof ans === 'string')
	    ? ans
	    : (ans?.summary || ans?.data?.summary || ans?.text || '');
	intro.setText(summary || 'I couldn’t get a summary just now. Want me to try again?');
	intro.showMeta();

    const mk = await sendToBG({
      type: 'AI_CHAT:CREATE_WITH_SUMMARY',
      site,
      summary_text: summary,
      title: `Chat – ${site}`
    });
    if (mk?.ok && mk.session_id) {
      return mk.session_id;
    }
  } catch {
    intro.setText('I couldn’t analyze the page messages. You can still tell me what you need.');
    intro.showMeta();
  }
  return null;
}

// “New session”: clear storage, clear UI, re-run intro summary & set sessionId
async function startNewSession() {
  try { await chrome.storage.local.remove('ai_chat_active_session_id'); } catch {}
  sessionId = null;

  try { ui.body.innerHTML = ''; } catch {}
  const sid = await runIntroSummaryInto(ui.body);
  if (sid) {
    sessionId = sid;
    chrome.storage.local.set({ ai_chat_active_session_id: sessionId });
  }
}


    // selection → insert logic
    let selSnippet = '';
    const hideInsert = () => { ui.insertBtn.style.display = 'none'; selSnippet = ''; };
    const showInsertForSelection = () => {
      const sel = window.getSelection?.(); if (!sel || sel.isCollapsed) return hideInsert();
      let range; try { range = sel.getRangeAt(0); } catch { return hideInsert(); }
      const text = (sel.toString() || '').trim();
      if (!text || text.length > 3500) return hideInsert();

      // keep inside transcript only
      const common = range.commonAncestorContainer;
      const nodeEl = common.nodeType === 1 ? common : common.parentElement;
      if (!ui.body.contains(nodeEl)) return hideInsert();

      const selRect = range.getBoundingClientRect();
      const boxRect = ui.box.getBoundingClientRect();
      const left = Math.min(Math.max(selRect.right - boxRect.left - ui.insertBtn.offsetWidth, 6),
                            ui.box.clientWidth - ui.insertBtn.offsetWidth - 6);
      const top  = Math.max(selRect.top - boxRect.top - ui.insertBtn.offsetHeight - 6, 6);

      ui.insertBtn.style.left = `${left}px`;
      ui.insertBtn.style.top  = `${top}px`;
      ui.insertBtn.style.display = 'inline-flex';
      selSnippet = text;
    };

    ui.body.addEventListener('mouseup', showInsertForSelection, true);
    ui.body.addEventListener('keyup', (e) => { if (e.key === 'Escape') hideInsert(); else showInsertForSelection(); }, true);
    ui.body.addEventListener('mousedown', () => setTimeout(() => {
      const sel = window.getSelection?.(); if (!sel || sel.isCollapsed) hideInsert();
    }, 0), true);

    ui.insertBtn.addEventListener('click', () => {
      const snippet = selSnippet.trim();
      if (!snippet) return hideInsert();
      try {
        if (typeof window.vgInsertPrompt === 'function') window.vgInsertPrompt(snippet);
        else if (typeof window.setComposerGuardAndCaret === 'function') window.setComposerGuardAndCaret(snippet, '');
      } catch {}
      hideInsert();
    });

    function scrollBottom() { ui.body.scrollTop = ui.body.scrollHeight; }


    // hydrate previous session if present; otherwise auto-summarize ONCE to start the session
	chrome.storage.local.get('ai_chat_active_session_id', async (r) => {
	  sessionId = r?.ai_chat_active_session_id || null;
	
	  try {
	    if (sessionId) {
	      // RESUME: load transcript, DO NOT summarize again
	      const m = await sendToBG({ type: 'AI_CHAT:GET_MESSAGES', session_id: sessionId, limit: 50 });
	      if (m?.ok && Array.isArray(m.messages)) {
	        for (const row of m.messages) {
	          const role = row.role === 'user' ? 'user' : 'vg';
	          addMessage(ui.body, role, row.content);
	        }
	        scrollBottom();
	      }
	      __resumeResolve?.();
	      return;
	    }

        // FIRST OPEN: use helper to create the session once
	    const sid = await runIntroSummaryInto(ui.body);
	    if (sid) {
	      sessionId = sid;
	      chrome.storage.local.set({ ai_chat_active_session_id: sessionId });
	    }
	    __resumeResolve?.();
	
	  } catch {
	    addMessage(ui.body, 'vg', 'Could not initialize chat.');
	    __resumeResolve?.();
	  }
	});



    // summarize action (optional, creates/updates session)
	ui.btnSummary.addEventListener('click', async () => {
	  const waiting = addMessage(ui.body, 'vg', 'Analyzing the last 10 messages…', { showMeta:false, minWidth:260 });
	  try {
	    const last10 = await collectLastMessages(10);
	    const ans = await sendToBG({ type: 'AI_CHAT:SUMMARIZE', site, messages: last10.length ? last10 : [{ role:'user', text:'(No messages found on page)'}] });
	    const summary = (typeof ans === 'string') ? ans : (ans?.summary || ans?.text || 'No summary.');
	    waiting.setText(summary); waiting.showMeta();

	    // create a session if needed and store the id
	    if (!sessionId) {
	      const mk = await sendToBG({ type: 'AI_CHAT:CREATE_WITH_SUMMARY', site, summary_text: summary, title: `Chat – ${site}` });
	      if (mk?.ok && mk.session_id) {
	        sessionId = mk.session_id;
	        chrome.storage.local.set({ ai_chat_active_session_id: sessionId });
	      }
	    }
	  } catch (e) {
	    waiting.setText('Could not analyze. You can still chat.');
	    waiting.showMeta();
	  }
	});


// NEW button → clear storage, clear UI, run intro summary, set new sessionId
ui.btnNew?.addEventListener('click', async (e) => {
  e.preventDefault(); e.stopPropagation();
  const was = ui.btnNew.disabled; ui.btnNew.disabled = true;
  try { await startNewSession(); } finally { ui.btnNew.disabled = was; }
});


    // send flow
    ui.input.addEventListener('input', () => { ui.btnSend.disabled = !(/\S/.test(ui.input.value || '')); });
    ui.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ui.btnSend.click(); }
    });

    ui.btnSend.addEventListener('click', async () => {
	  // Ensure we’ve either resumed a session or created one via autosummary
	  await __resumeReady;
	
	  const text = (ui.input.value || '').trim();
	  if (!text) return;
	  addMessage(ui.body, 'user', text, { minWidth: 220 });
	      ui.input.value = ''; ui.btnSend.disabled = true;

      try {
        // if no session yet, let backend create on first send
        const res = await sendToBG({ type: 'AI_CHAT:SEND', session_id: sessionId, site, user_text: text });
        if (!res?.ok) throw new Error(res?.error || 'Send failed');
        if (res.session_id && res.session_id !== sessionId) {
          sessionId = res.session_id;
          chrome.storage.local.set({ ai_chat_active_session_id: sessionId });
        }
        addMessage(ui.body, 'vg', res.assistant || '(no reply)');
      } catch (e) {
        addMessage(ui.body, 'vg', 'Error: ' + (e?.message || 'Could not send.'));
      } finally {
        ui.btnSend.disabled = false;
        ui.input.focus();
      }
    });

    // close logic
    const close = () => {
      try { document.getElementById('vg-aichat-open-flag')?.remove(); } catch {}
      try { ui.host.remove(); } catch {}
      try { window.__VG_MODAL_ACTIVE = false; } catch {}
    };
    ui.btnClose.addEventListener('click', close);
    ui.host.addEventListener('click', (e) => { if (e.target === ui.host) close(); });
    window.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { close(); window.removeEventListener('keydown', onEsc, true); }
    }, true);

    // mark “modal open” to pause other interceptors
    try { window.__VG_MODAL_ACTIVE = true; } catch {}
  };
})();
