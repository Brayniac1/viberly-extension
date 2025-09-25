// ==== prereqs: Supabase client + BG SoT helpers + minimal logout ====

/* 0) Supabase client (popup context) */
const SUPABASE_URL = 'https://auudkltdkakpnmpmddaj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1dWRrbHRka2FrcG5tcG1kZGFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU3MDA3NTYsImV4cCI6MjA3MTI3Njc1Nn0.ukDpH6EXksctzWHMSdakhNaWbgFZ61UqrpvzwTy03ho';

// Use chrome.storage.local for Supabase auth storage so all contexts share it
const storage = {
  getItem: (k) => new Promise(res => chrome.storage.local.get([k], out => res(out[k] ?? null))),
  setItem: (k, v) => new Promise(res => chrome.storage.local.set({ [k]: v }, res)),
  removeItem: (k) => new Promise(res => chrome.storage.local.remove([k], res)),
};

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
});
window.db = db; // so you can test via popup DevTools


// --- OAuth session fingerprint (dedupe identical events)
let __vgLastAuthFP = null;
const __fp = (s) => (s?.access_token
  ? (s.access_token.slice(0,12) + '.' + (s.refresh_token||'').slice(0,12) + '.' + (s.expires_at||s.expires_in||''))
  : ''
);


/* 1) Background SoT access */
function __vgValidSess(s){
  return !!(s && s.access_token && s.refresh_token && Number.isFinite(s.expires_at));
}
async function __vgReadBGSoT(){
  return await new Promise(res => chrome.storage.local.get('VG_SESSION', r => {
    const s = r?.VG_SESSION || null;
    res(__vgValidSess(s) ? s : null);
  }));
}

/* 2) Hydrate popup Supabase client from SoT (tokens) */
async function __vgHydrateFromSOT(sot, { tries = 8, delayMs = 75 } = {}) {
  if (!__vgValidSess(sot)) return false;
  try {
    await db.auth.setSession({
      access_token:  sot.access_token,
      refresh_token: sot.refresh_token,
    });
  } catch {}
  for (let i = 0; i < tries; i++) {
    try {
      const { data:{ session } } = await db.auth.getSession();
      if (session?.user?.id) return true;
    } catch {}
    await new Promise(r => setTimeout(r, delayMs));
  }
  return false;
}

/* 3) Ask BG for billing summary (no popup-side RLS) */
async function getBillingSummary() {
  try {
    const res = await new Promise(resolve => {
      try { chrome.runtime.sendMessage({ type: 'VG_ACCOUNT_SUMMARY' }, r => resolve(r || null)); }
      catch { resolve(null); }
      setTimeout(() => resolve(null), 1000);
    });
    if (res && res.ok && res.summary) return res.summary;
  } catch {}
  return { tier: 'free', used: 0, limit: 1, status: 'inactive' };
}

/* 4) Push popup’s session to BG SoT (de-duped) */
let __lastPushFP = null;
async function pushSessionToBackground() {
  try {
    const { data: { session } } = await db.auth.getSession();
    const at = session?.access_token, rt = session?.refresh_token, exp = session?.expires_at;
    const uid = session?.user?.id || null;
    const mail= session?.user?.email || null;
    if (!at || !rt || !Number.isFinite(exp)) return;
    const fp = at.slice(0,12) + '.' + rt.slice(0,12) + '.' + exp;
    if (fp === __lastPushFP) return;
    __lastPushFP = fp;
await new Promise(r => setTimeout(r, 20));
chrome.runtime.sendMessage(
  { type: 'SET_SESSION', access_token: at, refresh_token: rt, expires_at: exp, userId: uid, email: mail },
  (r) => console.log('[popup→bg] SET_SESSION →', r)
);

  } catch (e) {
    console.warn('[popup→bg] SET_SESSION failed', e);
  }
}

/* 5) Minimal logout (no DOM writes here; your painter handles UI) */
function wireLogout() {
  const btn = document.getElementById('logout');
  if (!btn || btn.__wired) return;
  btn.__wired = true;
  btn.addEventListener('click', async () => {
    try { await db.auth.signOut(); } catch {}
    try { chrome.runtime.sendMessage({ type: 'SIGN_OUT' }, () => {}); } catch {}
    try {
      chrome.storage.local.get(null, (all) => {
        const keys = Object.keys(all).filter(k => k.startsWith('sb-'));
        if (keys.length) chrome.storage.local.remove(keys);
      });
      chrome.storage.local.remove('VG_SESSION');
    } catch {}
    // schedule a repaint via your existing scheduler
    try { schedulePaint?.('logout'); } catch {}
  });
}

/* 6) Optional auto-close (kept lightweight) */
const __AUTO_CLOSE__ = (() => {
  try { return new URLSearchParams(location.search).get('auto') === '1'; }
  catch { return false; }
})();
let __didAutoClose = false;
async function __maybeAutoClose() {
  if (!__AUTO_CLOSE__ || __didAutoClose) return;
  try {
    const { data: { session } } = await db.auth.getSession();
    if (!session?.user) return;
    __didAutoClose = true;
    try { window.close(); } catch {}
    try { chrome.windows.getCurrent(w => { if (w?.id) chrome.windows.remove(w.id); }); } catch {}
  } catch {}
}


/* 7) Keep BG in sync on any auth change (no DOM writes here) */
try {
  db.auth.onAuthStateChange((_event, session) => {
    try {
      const at = session?.access_token;
      const rt = session?.refresh_token;
      const exp = session?.expires_at;
      const uid = session?.user?.id || null;
      const mail= session?.user?.email || null;
      if (!at || !rt || !Number.isFinite(exp)) return;

      const fp = __fp(session);
      if (fp === __vgLastAuthFP) return;   // ← dedupe identical tokens
      __vgLastAuthFP = fp;

      chrome.runtime.sendMessage(
        { type: 'SET_SESSION', access_token: at, refresh_token: rt, expires_at: exp, userId: uid, email: mail },
        (r) => console.log('[popup→bg] onAuthStateChange → SET_SESSION', r)
      );
    } catch {}
  });
} catch {}



// ==== popup.js — single-source paint (scheduler + guarded painter) ====

// --- tiny DOM helpers (safe no-ops if you already have your own) ---
function setText(id, v) {
  try {
    const el = document.getElementById(id);
    if (el) el.textContent = v ?? '';
  } catch {}
}
function setHTMLState(signedIn) {
  try {
    const html = document.documentElement;
    html.classList.toggle('signed-in',  !!signedIn);
    html.classList.toggle('signed-out', !signedIn);
  } catch {}
}

/* === Phase 2: active tab → host (read-only) === */
function getActiveHost(cb) {
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      let host = null;
      try { host = new URL(tabs?.[0]?.url || '').host || null; } catch {}
      cb(host);
    });
  } catch { cb(null); }
}


// --- global paint sequencer (last schedule wins) ---
let paintSeq = 0;
function schedulePaint(reason = '') {
  const mySeq = ++paintSeq;                     // bump global
  Promise.resolve().then(() => {                // microtask queue
    paintIfCurrent(mySeq, reason).catch(err => {
      console.warn('[popup] paint error:', err);
    });
  });
}

// --- the *only* painter ---
async function paintIfCurrent(seq, reason = '') {
  if (seq !== paintSeq) return;

  // 1) Adopt background SoT and prove what we got
  const sot = await __vgReadBGSoT().catch(() => null);
  console.log('[popup] paint start', { reason, seq, sot_has_tokens: !!(sot?.access_token), sot });
  if (seq !== paintSeq) return;

  const signedIn = __vgValidSess(sot) || !!(sot?.session?.user);
  setHTMLState(!!signedIn);


if (signedIn) {
  // Hydrate local client from tokens, then verify local session exists
  await __vgHydrateFromSOT(sot).catch(() => {});
  if (seq !== paintSeq) return;

  let email = '';
  try {
    const { data: { session } } = await db.auth.getSession();
    const { data: { user } }     = await db.auth.getUser();
    console.log('[popup] after hydrate → local session?', !!session, session);
    email = user?.email || user?.user_metadata?.email || '';
  } catch {}
  if (!email) email = sot?.email || '';

  setHTMLState(true); // hard flip (defensive if CSS didn’t update yet)
  setText('acctEmail', email || '—');

} else {
  setText('acctEmail', '—');
  setText('acctPlan', '—');
  setText('acctUsage', '—');
  return;
}


  // 2) Fetch account summary from background (no popup-side RLS)
  const summary = await getBillingSummary().catch(() => null);
  if (seq !== paintSeq) return;

  // 3) Normalize and write
  const tier  = summary?.tier  ?? summary?.plan  ?? '—';
  // tolerate either casing: limit / Limit
  const used  = Number.isFinite(summary?.used)  ? summary.used  : null;
  const limit = Number.isFinite(summary?.limit) ? summary.limit
             : Number.isFinite(summary?.Limit) ? summary.Limit
             : null;


  setText('acctPlan', String(tier || '—'));

  if (used != null && limit != null) {
    setText('acctUsage', `${used} / ${limit}`);
  } else {
    setText('acctUsage', '—');
  }



/* === Phase 6: clickable slider → no-op SET_SITE_ACCESS, then re-read truth === */
if (seq === paintSeq) {
  try {
    chrome.runtime.sendMessage({ type: 'GET_SITE_ACCESS' }, (res) => {
      try {

const host = res?.host || null;
const path = res?.path || '/';

// Prefer BG-provided tri-state; fall back to enabled if older BG
const tri  = (typeof res?.state === 'string') ? res.state : (res?.enabled ? 'on' : 'off');
const isOn = (tri === 'on');
const isNA = (tri === 'na');

setText('saHost', host || '—');
setText('saState', isNA ? 'N/A' : (isOn ? 'ON' : 'OFF'));

// Show hint only when ON (supported + enabled)
const hint = document.getElementById('saHint');
if (hint) hint.style.display = isOn ? '' : 'none';

        const t = document.getElementById('saToggle');
        if (t) {
          t.checked = isOn;

          // Disable the toggle when N/A (host not supported at all)
          if (isNA) {
            t.disabled = true;
            t.setAttribute('aria-disabled', 'true');
          } else {
            t.disabled = false;
            t.removeAttribute('aria-disabled');
          }

          if (!t.__wired) {
            t.__wired = true;
            t.addEventListener('change', () => {
              // If disabled (N/A), ignore defensively
              if (t.disabled) { t.checked = false; return; }

              const wantOn = t.checked;
              const state  = wantOn ? 'inherit' : 'off';

              chrome.runtime.sendMessage(
                { type: 'SET_SITE_ACCESS', host, path, state },
                () => {
                  // Re-read truth from BG and snap UI to it

chrome.runtime.sendMessage({ type: 'GET_SITE_ACCESS', host, path }, (truth) => {
  const tri2 = (typeof truth?.state === 'string') ? truth.state : (truth?.enabled ? 'on' : 'off');
  const on2  = (tri2 === 'on');
  const na2  = (tri2 === 'na');

  setText('saState', na2 ? 'N/A' : (on2 ? 'ON' : 'OFF'));
  t.checked = on2;

  const hint = document.getElementById('saHint');
  if (hint) hint.style.display = on2 ? '' : 'none';

  if (na2) {
    t.disabled = true;
    t.setAttribute('aria-disabled', 'true');
  } else {
    t.disabled = false;
    t.removeAttribute('aria-disabled');
  }
});

                }
              );
            });
          }
        }
      } catch {}
    });
  } catch {}
}


  // final guard (prevents a late write from older paints)
  if (seq !== paintSeq) return;

  // (Optional) you can log once for diagnostics:
  // console.log('[popup] painted', { reason, seq });
}


// --- boot: the only time we schedule immediately ---
(async function bootPopup() {
  try {
    // ensure logout button is wired, stripe helpers ready, etc.
    wireLogout?.();

    // (optional) push page session to BG in case popup holds a fresher token;
    // harmless if already in sync due to your reconcile step
    pushSessionToBackground?.().catch(() => {});

    // first and only boot paint
    schedulePaint('boot');

    // BG auth push → schedule a repaint (no direct DOM writes)
    chrome?.runtime?.onMessage?.addListener?.((msg) => {
      if (msg?.type === 'AUTH_STATUS_PUSH') {
        schedulePaint('auth-push');
      }
    });

    // Optional: auto-close logic you already had
    __maybeAutoClose?.();

  } catch (err) {
    console.warn('[popup] boot error:', err);
  }
})();


// ===== dev helpers (optional) =====
window.schedulePaint = schedulePaint;

// ===== minimal login wiring (email/password) =====

// safe UI helpers (no-ops if #authMsg is missing)
function authMsg(text, type='err'){ 
  const m = document.getElementById('authMsg');
  if (!m) return;
  m.textContent = text || '';
  m.classList.remove('ok','err');
  m.classList.add(type === 'ok' ? 'ok' : 'err');
  m.hidden = !text;
}
function authMsgClear(){ const m = document.getElementById('authMsg'); if (m) m.hidden = true; }
function lock(el, on=true){ if (el) { el.disabled = !!on; el.style.opacity = on ? '0.7' : '1'; } }

// fields + button
const fieldEmail   = document.getElementById('email');
const fieldPassword= document.getElementById('password');
const btnLogin     = document.getElementById('signin');

// allow Enter to submit
[fieldEmail, fieldPassword].forEach(el => {
  el?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); btnLogin?.click(); }
  });
  el?.addEventListener('input', authMsgClear);
});


// click → Supabase sign-in → push EXACT session to BG → hydrate popup → single paint
btnLogin?.addEventListener('click', async () => {
  authMsgClear();
  const email    = (fieldEmail?.value || '').trim();
  const password = fieldPassword?.value || '';
  if (!email || !password) { authMsg('Enter email and password'); return; }

  lock(btnLogin, true);
  try {
    const { data, error } = await window.db.auth.signInWithPassword({ email, password });
    if (error) { authMsg(error.message || 'Sign in failed'); return; }

    // 1) Use the EXACT session we just got (avoids storage timing races)
    const s = data?.session;
    if (!s?.access_token || !s?.refresh_token || !Number.isFinite(s?.expires_at)) {
      authMsg('Signed in but no session tokens; try again'); 
      return;
    }

    // 2) Immediately hydrate this popup client from the same tokens (local truth)
    try {
      await window.db.auth.setSession({
        access_token:  s.access_token,
        refresh_token: s.refresh_token,
      });
    } catch {}

   
 // 3) Push those same tokens to BG SoT (global truth)
    try {
      await new Promise(r => setTimeout(r, 20)); // tiny wake-up for MV3 SW
      chrome.runtime.sendMessage(
        {
          type: 'SET_SESSION',
          access_token: s.access_token,
          refresh_token: s.refresh_token,
          expires_at:   s.expires_at,
          userId:       s.user?.id || null,
          email:        s.user?.email || null
        },
        (r) => console.log('[popup→bg] SET_SESSION (login) →', r)
      );
    } catch (e) {
      console.warn('[popup→bg] SET_SESSION (login) failed', e);
    }


// 4) Immediately check the gate; if blocked (team OR individual), show card and DO NOT auto-close
try {
  const gateResp = await new Promise(res => chrome.runtime.sendMessage({ type: 'ACCESS_RECHECK' }, res));
  const snap = gateResp?.access || {};

  const teamBlocked  = (snap.blocked === true && snap.team === true);
  const indivBlocked = (snap.blocked === true && snap.team === false &&
                        (snap.indiv_status === 'past_due' || snap.indiv_status === 'canceled'));

  if (teamBlocked) {
    if (typeof window.__vgPopupShowBlocked === 'function') {
      window.__vgPopupShowBlocked(snap);
    } else if (typeof window.__vgPopupRecheck === 'function') {
      window.__vgPopupRecheck();
    }
    return;
  }

  if (indivBlocked) {
    if (typeof window.__vgPopupShowIndividualBlocked === 'function') {
      window.__vgPopupShowIndividualBlocked(snap);
    } else if (typeof window.__vgPopupRecheck === 'function') {
      window.__vgPopupRecheck();
    }
    return;
  }
} catch {}


    // 5) Allowed → deterministic paint + gentle auto-close
    window.schedulePaint?.('login');
    authMsg('Signed in', 'ok');
    setTimeout(() => closePopupSafely(), 120);


  } catch (e) {
    authMsg(e?.message || 'Unexpected error');
  } finally {
    lock(btnLogin, false);
  }
});


// === Magic Link (passwordless) ===
const magicBtn = document.getElementById('magic');

magicBtn?.addEventListener('click', async () => {
  authMsgClear();
  const email = (fieldEmail?.value || '').trim();
  if (!email) { authMsg('Enter your email, then press button'); return; }

  lock(magicBtn, true);
  try {
    // Send OTP that redirects to the bridge page on your site
    const { error } = await db.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: 'https://viberly.ai/extension-bridge'
      }
    });
    if (error) { authMsg(error.message || 'Failed to send link'); return; }
    authMsg('Check your email for a login link', 'ok');
  } catch (e) {
    authMsg(e?.message || 'Unexpected error');
  } finally {
    lock(magicBtn, false);
  }
});


// === Forgot Password (with BG fallback + clear feedback) ===
const forgotBtn = document.getElementById('forgot');

forgotBtn?.addEventListener('click', async (e) => {
  e.preventDefault();
  authMsgClear();

  const email = (fieldEmail?.value || '').trim();
  if (!email) {
    authMsg('Enter your email first, then click Forgot Password');
    fieldEmail?.focus();
    return;
  }

  lock(forgotBtn, true);
  try {
    // Try popup-side Supabase first
    const { error } = await db.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://viberly.ai/reset-password'
    });
    if (error) throw error;

    authMsg('Reset link sent. Check your inbox.', 'ok');
  } catch (err1) {
    console.warn('[popup] reset via popup failed, trying BG fallback:', err1);
    try {
      const resp = await new Promise(res =>
        chrome.runtime.sendMessage(
          { type: 'AUTH_RESET_PASSWORD', email, redirectTo: 'https://viberly.ai/reset-password' },
          res
        )
      );
      if (resp?.ok) authMsg('Reset link sent. Check your inbox.', 'ok');
      else authMsg(resp?.error || 'Failed to send reset email');
    } catch (err2) {
      authMsg(err2?.message || 'Failed to send reset email');
    }
  } finally {
    lock(forgotBtn, false);
  }
});



// ==== signup launcher → web app (returns to extension) ====
const EXT_ID = chrome.runtime.id;

function buildSignupURL(mode = 'signup') {
  const redirect = `chrome-extension://${EXT_ID}/auth.html${DEBUG_OAUTH ? '?debug=1' : ''}`;
  const state = crypto.randomUUID();
  chrome.storage.local.set({ __vg_auth_state: state });
  const u = new URL('https://viberly.ai/signup'); // your signup page
  u.searchParams.set('source', 'chrome');
  u.searchParams.set('mode', mode);
  u.searchParams.set('redirect_uri', redirect);
  u.searchParams.set('state', state);
  return u.toString();
}


function launchSignup(mode = 'signup') {
  const url = buildSignupURL(mode);

  // Remember where the user came from (tabId + url) so we can return/focus later
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const t = tabs && tabs[0];
    const returnTo = t ? { tabId: t.id, url: t.url || null, ts: Date.now() } : null;
    if (returnTo) {
      chrome.storage.local.set({ __vg_return_to: returnTo }, () => {
        chrome.tabs.create({ url });
      });
    } else {
      chrome.tabs.create({ url });
    }
  });
}


document.getElementById('signup')?.addEventListener('click', (e) => {
  e.preventDefault();
  const url = 'https://viberly.ai/signup';
  try {
    chrome.tabs.create({ url });            // open in a new tab (best for extensions)
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer'); // fallback
  }
});



// Echo BG auth broadcasts in popup console (helps confirm repaint triggers)
chrome.runtime.onMessage.addListener((m) => {
  if (m?.type === 'AUTH_STATUS_PUSH') {
    console.log('[popup] AUTH_STATUS_PUSH', m);
  }
});

window.getBillingSummary = getBillingSummary;




// --- close the popup window safely (works for action popups or separate windows)
// Close ONLY the action popup. Never close the whole Chrome window.
// If you *intentionally* open a separate auth window, pass ?auto=1 in its URL
// and we'll close that window only in that special case.
function closePopupSafely() {
  // Always try to close the small action popup first.
  try { window.close(); } catch {}

  // Only close a separate extension window if this page was opened with ?auto=1
  // (e.g., an OAuth callback window you explicitly created via chrome.windows.create)
  try {
    const params = new URLSearchParams(location.search);
    const canCloseWindow = params.get('auto') === '1';
    if (!canCloseWindow) return;               // don't touch the main browser window
    chrome.windows.getCurrent(w => {
      // Extra safety: only remove if this *is* a popup window with a single tab on our extension URL
      if (!w?.id) return;
      chrome.tabs.query({ windowId: w.id }, (tabs) => {
        const isSingleExtTab = tabs?.length === 1 && tabs[0]?.url?.startsWith('chrome-extension://');
        if (isSingleExtTab && w.type === 'popup') {
          chrome.windows.remove(w.id);
        }
      });
    });
  } catch {}
}


// ---------- Team Access Gate (popup side) ----------
(function () {
  const bg = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));
  const $  = (id) => document.getElementById(id);


  function hideAllExceptBlocked() {
    const blocked = $('blocked');
    if (!blocked) return; // safety: never hide everything unless the blocked section exists

    // Ensure the blocked section lives inside the standard popup wrapper for proper sizing
    const wrap = document.querySelector('.wrap');
    if (wrap && blocked.parentElement !== wrap) {
      wrap.appendChild(blocked);
    }

    // Hide only siblings within the same container (wrapper if present; otherwise body)
    const container = wrap || document.body;

    // Make sure container is visible
    if (container.style.display === 'none') container.style.display = '';

    const siblings = Array.from(container.children);
    for (const el of siblings) {
      if (el === blocked) continue;
      if (!el.hasAttribute('data-prev-display')) {
        el.setAttribute('data-prev-display', el.style.display || '');
      }
      el.style.display = 'none';
    }

    // Show the blocked card
    blocked.style.display = 'block';
    blocked.setAttribute('aria-hidden', 'false');

    // If we're not inside .wrap, give a sane width so the popup doesn't collapse
    if (!wrap) {
      blocked.style.width = blocked.style.width || '360px';
      blocked.style.maxWidth = '100%';
    }

    // Neutralize signed-in/out classes so global CSS can't collapse the card
    try {
      document.documentElement.classList.remove('signed-in', 'signed-out');
    } catch {}
  }


  function restoreAll() {
    const blocked = $('blocked');
    const wrap = document.querySelector('.wrap');
    const container = wrap || document.body;

    const siblings = Array.from(container.children);
    for (const el of siblings) {
      if (el === blocked) continue;
      if (el.hasAttribute('data-prev-display')) {
        el.style.display = el.getAttribute('data-prev-display') || '';
        el.removeAttribute('data-prev-display');
      } else {
        el.style.display = '';
      }
    }

    if (blocked) {
      blocked.style.display = 'none';
      blocked.setAttribute('aria-hidden', 'true');
    }
  }


function fillBlockedUI(snap) {
  const status     = String(snap?.team_status || '').toLowerCase();
  const teamName   = snap?.team_name || 'your team';
  const adminName  = snap?.admin?.name || 'Team Admin';
  const adminEmail = (snap?.admin?.email && String(snap.admin.email).trim()) || '';
  const isAdmin    = snap?.admin_is_me === true;

  const copies = {
    past_due:       { title: 'Payment issue',        body: 'Your team’s payment method needs attention. To re-subscribe, check out our latest pricing.' },
    canceled:       { title: 'Subscription canceled', body: 'Your team’s subscription is canceled. To re-subscribe, check out our latest pricing.' },
    expired:        { title: 'Subscription expired',  body: 'Your team’s subscription has expired. To re-subscribe, check out our latest pricing.' },
    trial_expired:  { title: 'Your trial ended',      body: 'Your trial has now ended. To keep prompting like a rock star, start your subscription below.' },
    default:        { title: 'Access paused',         body: 'Your team’s subscription isn’t active right now.' }
  };
  const c = copies[status] || copies.default;

  if ($('blocked-title')) $('blocked-title').textContent = c.title;
  if ($('blocked-body'))  $('blocked-body').textContent  = c.body;

  if ($('blocked-team-name'))  $('blocked-team-name').textContent  = teamName;
  if ($('blocked-admin-name')) $('blocked-admin-name').textContent = adminName;

  const emailLink = $('blocked-admin-email');
  if (emailLink) {
    if (adminEmail) {
      emailLink.textContent = adminEmail;
      emailLink.href = `mailto:${adminEmail}`;
      emailLink.style.display = 'inline';
    } else {
      emailLink.removeAttribute('href');
      emailLink.style.display = 'none';
    }
  }


  // CTA: for trial_expired + ADMIN → Start now (checkout), else View pricing
  const cta = $('blocked-pricing-link');
  if (cta) {
    if (status === 'trial_expired' && isAdmin) {
      cta.textContent = 'Start now';
      cta.dataset.action = 'checkout';   // handled by click handler
      cta.href = '#';
    } else {
      cta.textContent = 'View pricing';
      cta.dataset.action = 'pricing';
      cta.href = 'https://viberly.ai/pricing';
    }
  }
}

/* === NEW: paint BLOCKED POPUP for individual users (past_due / canceled) === */
function fillIndividualBlockedUI(snap) {
  const s = String(snap?.indiv_status || '').toLowerCase();
  const title = (s === 'past_due') ? 'Payment issue' : (s === 'canceled' ? 'Subscription canceled' : 'Access paused');
  const body  = (s === 'past_due')
    ? 'Your payment method needs attention. Resolve billing to continue.'
    : (s === 'canceled'
        ? 'Your subscription is canceled. Reactivate to continue.'
        : 'Your subscription isn’t active right now.');

  // Title / copy
  const t = document.getElementById('blocked-title');
  const b = document.getElementById('blocked-body');
  if (t) t.textContent = title;
  if (b) b.textContent = body;

  // Hide team-only block details
  const list = document.querySelector('#blocked .list');
  if (list) list.style.display = 'none';

  // CTA → individual portal (no special click handler needed)
  const cta = document.getElementById('blocked-pricing-link');
  if (cta) {
    cta.textContent = 'Resolve billing';
    cta.dataset.action = 'pricing';
    cta.href = `https://viberly.ai/individual/subscription-expired?status=${s}`;
    cta.target = '_blank';
    cta.rel = 'noopener';
  }
}


async function renderAccess() {
  try {
    const resp = await bg({ type: 'ACCESS_STATUS' });
    const snap = resp?.access || {};

    // Individual: show the blocked popup (no auto-redirect)
    const isIndivBlocked =
      snap.blocked === true &&
      snap.team === false &&
      (snap.indiv_status === 'past_due' || snap.indiv_status === 'canceled');

    if (isIndivBlocked) {
      fillIndividualBlockedUI(snap);
      hideAllExceptBlocked();
      wireBlockedButtons();
      return;
    }

    // Team (existing)
    const isBlockedTeam = (snap.blocked === true && snap.team === true);
    if (isBlockedTeam) {
      fillBlockedUI(snap);
      hideAllExceptBlocked();
      wireBlockedButtons();
    } else {
      restoreAll();
    }

  } catch {
    restoreAll();
  }
}


async function recheck() {
  try {
    const resp = await bg({ type: 'ACCESS_RECHECK' });
    const snap = resp?.access || {};

    const isIndivBlocked =
      snap.blocked === true &&
      snap.team === false &&
      (snap.indiv_status === 'past_due' || snap.indiv_status === 'canceled');

    if (isIndivBlocked) {
      fillIndividualBlockedUI(snap);
      hideAllExceptBlocked();
      wireBlockedButtons();
      return;
    }

    const isBlockedTeam = (snap.blocked === true && snap.team === true);
    if (isBlockedTeam) {
      fillBlockedUI(snap);
      hideAllExceptBlocked();
      wireBlockedButtons();
    } else {
      restoreAll();
    }
  } catch {
    // leave current view
  }
}



function wireBlockedButtons() {
  const retry   = $('blocked-retry');
  const signout = $('blocked-signout');

  if (retry && !retry.__wired) {
    retry.__wired = true;
    retry.addEventListener('click', () => {
      try { (typeof recheck === 'function') && recheck(); } catch {}
    });
  }

  if (signout && !signout.__wired) {
    signout.__wired = true;
    signout.addEventListener('click', async () => {
      // Full logout — mirror the main "Log out" button behavior
      try { await db.auth.signOut(); } catch {}
      try { await bg({ type: 'SIGN_OUT' }); } catch {}
      try {
        chrome.storage.local.get(null, (all) => {
          const keys = Object.keys(all).filter(k => k.startsWith('sb-'));
          if (keys.length) chrome.storage.local.remove(keys);
        });
        chrome.storage.local.remove('VG_SESSION');
      } catch {}

      // Return UI to signed-out state
      try { restoreAll(); } catch {}
      try { window.schedulePaint?.('logout'); } catch {}
    });
  }
}

async function handleBlockedCtaClick(ev) {
  try {
    const el  = ev.currentTarget;
    const act = el?.dataset?.action || 'pricing';
    if (act !== 'checkout') return; // pricing link navigates normally

    ev.preventDefault();
    el.textContent = 'Starting…';
    el.style.opacity = '0.85';

    // 1) Check local Supabase session freshness (like webapp)
    let valid = false;
    try {
      const { data: { session } } = await db.auth.getSession();
      const now = Math.floor(Date.now() / 1000);
      valid = !!(session?.user?.id) &&
              (!Number.isFinite(session?.expires_at) || (session.expires_at - now) > 30);
    } catch {}

    // 2) If valid → go straight to /trial-expired
    if (valid) {
      await chrome.tabs.create({ url: 'https://viberly.ai/trial-expired', active: true });
      setTimeout(() => { try { window.close(); } catch {} }, 200);
      return;
    }

    // 3) Not valid → set one-shot redirect and open the auth bridge
    try {
      await chrome.storage.local.set({
        __vg_post_bridge_redirect_url: 'https://viberly.ai/trial-expired'
      });
    } catch {}
    await chrome.tabs.create({ url: 'https://viberly.ai/extension-bridge', active: true });

    // Let the user see the transition briefly; background will adopt tokens
    // and then open /trial-expired automatically, closing the bridge tab.
    setTimeout(() => { try { window.close(); } catch {} }, 400);
  } catch (e) {
    try {
      const el = ev?.currentTarget;
      if (el) { el.textContent = 'Start now'; el.style.opacity = '1'; }
    } catch {}
  }
}


/* === NEW: individual block router (past_due / canceled) === */
async function routeIndividualToPortal(snap) {
  const target =
    snap?.indiv_redirect ||
    `https://viberly.ai/individual/subscription-expired?status=${snap?.indiv_status || ''}`;

  // Check local Supabase session freshness
  let valid = false;
  try {
    const { data: { session } } = await db.auth.getSession();
    const now = Math.floor(Date.now() / 1000);
    valid = !!(session?.user?.id) &&
            (!Number.isFinite(session?.expires_at) || (session.expires_at - now) > 30);
  } catch {}

  if (valid) {
    await chrome.tabs.create({ url: target, active: true });
    setTimeout(() => { try { window.close(); } catch {} }, 200);
    return;
  }

  // Not valid → bridge, then redirect
  try {
    await chrome.storage.local.set({ __vg_post_bridge_redirect_url: target });
  } catch {}
  await chrome.tabs.create({ url: 'https://viberly.ai/extension-bridge', active: true });

  setTimeout(() => { try { window.close(); } catch {} }, 400);
}


// Tiny helpers for auth mode (default ↔ login)
function setAuthMode(mode) {
  try {
    const av = document.getElementById('authView');
    if (!av) return;
    av.dataset.mode = (mode === 'login') ? 'login' : 'default';
  } catch {}
}

document.addEventListener('DOMContentLoaded', () => {
  // ===== Blocked / billing wiring (unchanged behavior) =====
  const cta = document.getElementById('blocked-pricing-link');
  if (cta) cta.addEventListener('click', handleBlockedCtaClick);

  wireBlockedButtons();      // 🔌 make "Log out" work on blocked screen
  recheck();                 // force ACCESS_RECHECK on open so status flips are reflected immediately

  // ===== Two-zone auth mode wiring (NEW) =====
  setAuthMode('default'); // default = signup hero

  const showLogin     = document.getElementById('showLogin');
  const showSignupTop = document.getElementById('showSignupTop');
  const emailField    = document.getElementById('email');

  if (showLogin && !showLogin.__wired) {
    showLogin.__wired = true;
    showLogin.addEventListener('click', (e) => {
      e.preventDefault();
      setAuthMode('login');
      try { emailField?.focus(); } catch {}
      try { authMsgClear?.(); } catch {}
    });
  }

  if (showSignupTop && !showSignupTop.__wired) {
    showSignupTop.__wired = true;
    showSignupTop.addEventListener('click', (e) => {
      e.preventDefault();
      setAuthMode('default');
      try { authMsgClear?.(); } catch {}
    });
  }
});

// If auth state broadcasts while popup is open, re-render block state
chrome.runtime.onMessage.addListener((m) => {
  if (m?.type === 'AUTH_STATUS_PUSH' || m?.type === 'VG_AUTH_CHANGED') {
    recheck();
  }
});

// Expose tiny helpers so the login handler can show the blocked view instantly.
window.__vgPopupShowBlocked = function (snap) {
  try { fillBlockedUI(snap); hideAllExceptBlocked(); } catch {}
};
window.__vgPopupShowIndividualBlocked = function (snap) {
  try { fillIndividualBlockedUI(snap); hideAllExceptBlocked(); } catch {}
};
window.__vgPopupRecheck = function () {
  try { recheck(); } catch {}
};


})();





