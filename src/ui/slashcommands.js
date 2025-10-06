// src/ui/slashcommands.js
(() => {
  if (window.__VG_SLASH_CMDS_ACTIVE__) return;
  window.__VG_SLASH_CMDS_ACTIVE__ = true;

  const MIN_QUERY_LEN = 2;
  const MAX_RESULTS = 6;
  const LOOKBACK_CHARS = 80;
  const CACHE_TTL_MS = 30_000;

  const ICON_OPEN_EXTERNAL = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3h7v7"/><path d="M21 3l-11 11"/><path d="M10 3h-3a3 3 0 0 0-3 3v11a3 3 0 0 0 3 3h11a3 3 0 0 0 3-3v-3"/></svg>';

  function getCommandMatches(queryLower) {
    if (queryLower === 'chat') {
      return [{
        id: '__vg_cmd_chat__',
        name: 'Open AI Chat',
        source: 'command',
        icon: 'external',
        previewable: false,
        run: openAiChatViaSlash
      }];
    }
    return [];
  }

  async function openAiChatViaSlash() {
    try {
      if (typeof window.openAiChatModal !== 'function') {
        const url = chrome?.runtime?.getURL?.('src/ui/ai-chat.js');
        if (url) {
          await import(url);
        }
      }
      if (typeof window.openAiChatModal === 'function') {
        window.openAiChatModal();
      }
    } catch (err) {
      console.warn('[VG][slash] AI Chat launch failed', err);
    }
  }

  function rectIsUsable(rect) {
    if (!rect) return false;
    const { left, top, width, height } = rect;
    if (!Number.isFinite(left) || !Number.isFinite(top)) return false;
    return width > 0 || height > 0;
  }

  function getRect(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return null;
    try {
      return el.getBoundingClientRect();
    } catch {
      return null;
    }
  }

  function expandAnchor(el) {
    if (!el || !el.closest) return el;
    const scopes = [
      'form',
      '[data-testid*="composer"]',
      '[class*="composer"]',
      '[class*="input"]',
      '[class*="editor"]',
      '[role="textbox"]',
      '[class*="footer"]',
      '[class*="toolbar"]'
    ];
    for (const sel of scopes) {
      try {
        const parent = el.closest(sel);
        if (parent && parent !== document.body) {
          const rect = getRect(parent);
          if (rectIsUsable(rect)) return parent;
        }
      } catch {}
    }
    return el;
  }

  function resolveAnchorElement(composer) {
    const target = composer && document.contains(composer) ? composer : null;
    let best = null;
    let bestScore = -Infinity;

    if (target) {
      const expandedTarget = expandAnchor(target);
      const rect = getRect(expandedTarget);
      if (rectIsUsable(rect)) {
        best = expandedTarget;
        bestScore = rect.width * rect.height + 500_000; // prioritize actual composer tree
      }
    }

    const placement = window.__VG_DB_PLACEMENT || null;
    const selector = placement?.composer_selector;
    if (!selector) return best || target;

    let matches = [];
    try {
      matches = Array.from(document.querySelectorAll(selector));
    } catch {
      matches = [];
    }
    if (!matches.length) return best || target;

    for (const el of matches) {
      if (!document.contains(el)) continue;
      const expanded = expandAnchor(el);
      const rect = getRect(expanded);
      if (!rectIsUsable(rect)) continue;
      let score = rect.width * rect.height;
      if (target && (expanded === target || expanded.contains(target) || target.contains(expanded))) {
        score += 1_000_000;
      }
      if (score > bestScore) {
        bestScore = score;
        best = expanded;
      }
    }

    return best || target;
  }

  function isInsideAnchor(node) {
    if (!node) return false;
    const anchor = state.anchorEl;
    if (!anchor || !document.contains(anchor)) return false;
    if (anchor === node) return true;
    try {
      if (anchor.contains(node)) return true;
    } catch {}
    if (node.nodeType === Node.ELEMENT_NODE) {
      try {
        return node.contains(anchor);
      } catch {}
    }
    return false;
  }

  function captureCaretRange(anchor) {
    if (!anchor || !document.contains(anchor)) return null;
    try {
      const sel = anchor.ownerDocument?.getSelection?.() || window.getSelection?.();
      if (!sel || sel.rangeCount === 0) return null;
      const range = sel.getRangeAt(0);
      if (!anchor.contains(range.endContainer)) return null;
      return range.cloneRange();
    } catch {
      return null;
    }
  }

const state = {
  active: false,
  composer: null,
  trigger: null,
  matches: [],
  selectedIndex: 0,
  pendingFetch: 0,
  lastQuery: '',
  paletteEl: null,
  listEl: null,
  scrollListeners: [],
  anchorEl: null,
  caretRange: null
};

  let promptCache = null;
  let promptCacheAt = 0;

  const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF]/g;

  function stripZeroWidth(str) {
    return typeof str === 'string' ? str.replace(ZERO_WIDTH_RE, '') : str;
  }

  ensurePaletteStyle();
  attachListeners();

  function attachListeners() {
    document.addEventListener('input', handleInputEvent, true);
    document.addEventListener('selectionchange', handleSelectionChange, true);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('click', handleClickAway, true);
    window.addEventListener('blur', () => closePalette(), true);
  }

  function handleInputEvent(ev) {
    const composer = getComposerFromEvent(ev.target);
    if (!composer) {
      closePalette();
      return;
    }
    evaluateComposer(composer);
  }

  function handleSelectionChange() {
    if (!state.active) return;
    const anchor = state.anchorEl && document.contains(state.anchorEl) ? state.anchorEl : state.composer;
    if (!anchor || !document.contains(anchor)) {
      closePalette();
      return;
    }
    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0) return;
    const node = sel.anchorNode;
    if (node && isInsideAnchor(node)) {
      state.caretRange = captureCaretRange(state.anchorEl);
      return;
    }
    closePalette();
  }

  function handleClickAway(ev) {
    if (!state.active) return;
    const target = ev.target;
    if (!state.paletteEl) return;
    if (state.paletteEl.contains(target)) return;
    if (state.composer && (state.composer === target || state.composer.contains(target))) return;
    closePalette();
  }

  function handleKeyDown(ev) {
    if (!state.active) return;
    const key = ev.key;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      ev.preventDefault();
      ev.stopPropagation();
      if (!state.matches.length) return;
      const dir = key === 'ArrowDown' ? 1 : -1;
      const count = state.matches.length;
      state.selectedIndex = (state.selectedIndex + dir + count) % count;
      renderMatches();
      return;
    }
    if (key === 'Enter') {
      ev.preventDefault();
      ev.stopPropagation();
      applySelection(state.selectedIndex).catch((e) => console.warn('[VG][slash] insert failed', e));
      return;
    }
    if (key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      closePalette();
    }
  }

  function evaluateComposer(composer) {
    let trigger = extractSlashTrigger(composer);
    if (!trigger) {
      const fallback = findSlashBySnapshot(composer);
      if (!fallback) {
        closePalette();
        return;
      }
      trigger = fallback;
    }

    const queryLower = trigger.query.toLowerCase();
    if (queryLower.length < MIN_QUERY_LEN) {
      closePalette();
      return;
    }

    state.composer = composer;
    state.trigger = trigger;
    state.lastQuery = queryLower;

    const fetchId = ++state.pendingFetch;
    const commandMatches = getCommandMatches(queryLower);
    loadPrompts().then((prompts) => {
      if (fetchId !== state.pendingFetch) return;
      let matches = filterMatches(prompts, queryLower);
      if (commandMatches.length) {
        matches = [...commandMatches, ...matches].slice(0, MAX_RESULTS);
      }
      if (!matches.length) {
        closePalette();
        return;
      }
      state.matches = matches;
      state.selectedIndex = 0;
      openPalette(composer);
    }).catch((err) => {
      console.warn('[VG][slash] prompt load failed', err);
      if (fetchId !== state.pendingFetch) return;
      if (!commandMatches.length) return;
      state.matches = commandMatches;
      state.selectedIndex = 0;
      openPalette(composer);
    });
  }

  function openPalette(composer) {
    const root = ensurePaletteRoot();
    state.active = true;
    state.paletteEl = root;
    state.listEl = root.querySelector('.vg-slash-list');
    const anchor = resolveAnchorElement(composer) || composer;
    state.anchorEl = anchor;
    state.caretRange = captureCaretRange(anchor);
    state.composer = anchor;
    renderMatches();
    root.style.display = 'block';
    positionPalette(composer, root);
    registerScrollListeners(composer);
  }

  function closePalette(opts = {}) {
    const { keepTrigger = false } = opts;
    state.active = false;
    state.matches = [];
    state.selectedIndex = 0;
    if (!keepTrigger) state.trigger = null;
    state.lastQuery = '';
    state.pendingFetch = 0;
    state.anchorEl = null;
    state.caretRange = null;
    removeScrollListeners();
    if (state.paletteEl) state.paletteEl.style.display = 'none';
  }

  function renderMatches() {
    if (!state.listEl) return;
    const list = state.listEl;
    list.textContent = '';
    state.matches.forEach((match, index) => {
      const row = document.createElement('div');
      row.className = 'vg-slash-item';
      if (index === state.selectedIndex) row.classList.add('active');
      row.dataset.index = String(index);

      const name = document.createElement('div');
      name.className = 'vg-slash-name';
      name.textContent = match.name;
      row.appendChild(name);

      let right = null;
      const ensureRight = () => {
        if (!right) {
          right = document.createElement('div');
          right.className = 'vg-slash-meta';
        }
        return right;
      };

      if (match.icon === 'external') {
        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'vg-slash-icon vg-slash-open';
        openBtn.innerHTML = ICON_OPEN_EXTERNAL;
        openBtn.setAttribute('aria-label', 'Open');
        openBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          applySelection(index).catch((err) => console.warn('[VG][slash] command click failed', err));
        });
        ensureRight().appendChild(openBtn);
      } else if (typeof window.__VG_OPEN_PROMPT_PREVIEW === 'function' && match.previewable !== false) {
        const eyeBtn = document.createElement('button');
        eyeBtn.type = 'button';
        eyeBtn.className = 'vg-slash-icon vg-slash-eye';
        eyeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
        eyeBtn.setAttribute('aria-label', 'Preview');
        eyeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openPreview(match);
        });
        ensureRight().appendChild(eyeBtn);
      }

      if (right) row.appendChild(right);

      row.addEventListener('mouseenter', () => {
        state.selectedIndex = index;
        highlightSelection();
      });
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
      });
      row.addEventListener('click', () => {
        applySelection(index).catch((err) => console.warn('[VG][slash] insert click failed', err));
      });

      list.appendChild(row);
    });

    highlightSelection();
  }

  async function applySelection(index) {
    const match = state.matches[index];
    if (!match) return;

    const trigger = state.trigger;
    closePalette();
    if (!trigger) return;

    if (typeof match.run === 'function') {
      removeSlashToken(trigger);
      state.trigger = null;
      state.caretRange = null;
      try {
        await match.run({ trigger });
      } catch (err) {
        console.warn('[VG][slash] command run failed', err);
      }
      return;
    }
    await performInsert(match, trigger);
  }

  function openPreview(match) {
    if (typeof window.__VG_OPEN_PROMPT_PREVIEW !== 'function') return;
    const trigger = state.trigger;
    closePalette({ keepTrigger: true });
    try {
      window.__VG_OPEN_PROMPT_PREVIEW({
        id: match.id,
        title: match.name || 'Preview',
        body: match.body || '',
        onInsert: async () => {
          await performInsert(match, trigger);
        }
      });
    } catch (e) {
      console.warn('[VG][slash] preview failed', e);
    }
  }

  function highlightSelection() {
    if (!state.listEl) return;
    const rows = state.listEl.querySelectorAll('.vg-slash-item');
    rows.forEach((row, idx) => {
      if (idx === state.selectedIndex) row.classList.add('active');
      else row.classList.remove('active');
    });
  }

  async function performInsert(match, trigger) {
    if (!trigger) return;

    const allowed = await gateForPrompt(match);
    if (!allowed) return;

    removeSlashToken(trigger);
    const text = match.body || '';
    if (!text) return;

    let inserted = false;
    try {
      if (typeof window.vgInsertPrompt === 'function') {
        inserted = !!window.vgInsertPrompt(text);
      }
      if (!inserted && typeof window.setComposerGuardAndCaret === 'function') {
        inserted = !!window.setComposerGuardAndCaret(text);
      }
    } catch (e) {
      console.warn('[VG][slash] insert error', e);
    }

    if (!inserted) {
      if (trigger.kind === 'input') {
        const el = trigger.target;
        try {
          const proto = Object.getPrototypeOf(el);
          const desc = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
          const value = el.value || '';
          const pos = el.selectionStart ?? value.length;
          const before = value.slice(0, pos);
          const after = value.slice(pos);
          const next = before + text + after;
          if (desc && typeof desc.set === 'function') desc.set.call(el, next); else el.value = next;
          const caret = before.length + text.length;
          el.setSelectionRange?.(caret, caret);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          inserted = true;
        } catch {}
      }
    }

    if (inserted) {
      try { await maybeLogUsage(match); } catch (e) { console.warn('[VG][slash] usage log failed', e); }
      try { await window.maybePromptUpgrade?.(); } catch {}
    }

    state.trigger = null;
  }

  async function gateForPrompt(match) {
    try {
      if (match.source === 'quick') {
        const guard = await sendBG('VG_CAN_INSERT_QUICK', { prompt_id: match.id });
        if (guard && guard.ok === false) return false;
      } else if (match.source === 'custom' || match.source === 'team') {
        const guard = await sendBG('VG_CAN_INSERT_CUSTOM', { guard_id: match.id });
        if (guard && guard.ok === false) return false;
      }
    } catch (e) {
      console.warn('[VG][slash] gating failed', e);
      return false;
    }
    return true;
  }

  async function maybeLogUsage(match) {
    try {
      if (match.source === 'quick') {
        await sendBG('VG_LOG_QUICK_USE', { prompt_id: match.id });
      } else if (match.source === 'custom' || match.source === 'team') {
        await sendBG('VG_LOG_GUARD_USE', { guard_id: match.id });
      }
    } catch {}
  }

  function removeSlashToken(trigger) {
    if (!trigger) return;
    if (trigger.kind === 'input') {
      const el = trigger.target;
      const value = el.value || '';
      const before = value.slice(0, trigger.replaceStart);
      const after = value.slice(trigger.replaceEnd);
      try {
        const proto = Object.getPrototypeOf(el);
        const desc = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
        const next = before + after;
        if (desc && typeof desc.set === 'function') desc.set.call(el, next); else el.value = next;
        el.setSelectionRange?.(trigger.replaceStart, trigger.replaceStart);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (e) {
        console.warn('[VG][slash] failed to trim command', e);
      }
      return;
    }

    if (trigger.kind === 'ce' && trigger.range) {
      try {
        const range = trigger.range;
        range.deleteContents();
        range.collapse(true);
        const sel = window.getSelection?.();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } catch (e) {
        console.warn('[VG][slash] CE trim failed', e);
      }
    }
  }

  function extractSlashTrigger(composer) {
    if (!isComposerElement(composer)) return null;

    if ('value' in composer) {
      const value = String(composer.value || '');
      const pos = Number.isFinite(composer.selectionStart) ? composer.selectionStart : value.length;
      const snippet = stripZeroWidth(value.slice(Math.max(0, pos - LOOKBACK_CHARS), pos));
      const match = snippet.match(/(^|[\s([{])\/([a-z0-9]{0,32})$/i);
      if (!match) return null;
      const query = match[2];
      const removeLen = query.length + 1;
      const replaceEnd = pos;
      const replaceStart = replaceEnd - removeLen;
      if (replaceStart < 0) return null;
      return {
        kind: 'input',
        target: composer,
        query,
        replaceStart,
        replaceEnd
      };
    }

    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!composer.contains(range.endContainer)) return null;

    const prefixRange = range.cloneRange();
    prefixRange.setStart(composer, 0);
    const preceding = prefixRange.toString();
    const snippet = stripZeroWidth(preceding.slice(-LOOKBACK_CHARS));
    const match = snippet.match(/(^|[\s([{])\/([a-z0-9]{0,32})$/i);
    if (!match) return null;

    const query = match[2];
    const removeLen = query.length + 1;
    const caretInfo = findTextPositionBackward(composer, range.endContainer, range.endOffset, removeLen);
    if (!caretInfo) return null;

    const tokenRange = document.createRange();
    tokenRange.setStart(caretInfo.node, caretInfo.offset);
    tokenRange.setEnd(range.endContainer, range.endOffset);

    return {
      kind: 'ce',
      target: composer,
      query,
      range: tokenRange
    };
  }

  function findSlashBySnapshot(composer) {
    try {
      if ('value' in composer) {
        const value = String(composer.value || '');
        const snapshot = stripZeroWidth(value);
        const match = snapshot.match(/\/([a-z0-9]{0,32})$/i);
        if (!match) return null;
        return {
          kind: 'input',
          target: composer,
          query: match[1],
          replaceStart: snapshot.length - match[0].length,
          replaceEnd: snapshot.length
        };
      }

      const text = stripZeroWidth(String(composer.innerText || composer.textContent || ''));
      const match = text.match(/\/([a-z0-9]{0,32})$/i);
      if (!match) return null;
      return {
        target: composer,
        query: match[1]
      };
    } catch {
      return null;
    }
  }

  function findTextPositionBackward(root, container, offset, chars) {
    let node = container;
    let idx = offset;
    let remaining = chars;

    const walkPrev = (n) => {
      if (n === root) return null;
      if (n.previousSibling) {
        n = n.previousSibling;
        while (n && n.lastChild) n = n.lastChild;
        return n;
      }
      const parent = n.parentNode;
      if (!parent) return null;
      return walkPrev(parent);
    };

    while (node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        idx = Math.min(idx, text.length);
        if (idx > 0) {
          const take = Math.min(remaining, idx);
          idx -= take;
          remaining -= take;
          if (remaining === 0) {
            return { node, offset: idx };
          }
        }
      }

      const prev = walkPrev(node);
      if (!prev || !root.contains(prev)) break;
      node = prev;
      if (node.nodeType === Node.TEXT_NODE) {
        idx = node.textContent ? node.textContent.length : 0;
      } else {
        idx = 0;
      }
    }
    return null;
  }

  function positionPalette(composer, palette) {
    const rect = getAnchorRect(composer);
    if (!rect) return;
    const rootRect = palette.getBoundingClientRect();
    const padding = 12;
    let left = rect.left;
    const preferAbove = rect.top > rootRect.height + padding;
    let top = preferAbove ? rect.top - rootRect.height - 8 : rect.bottom + 8;

    left = Math.max(padding, Math.min(left, window.innerWidth - rootRect.width - padding));
    top = Math.max(padding, Math.min(top, window.innerHeight - rootRect.height - padding));

    palette.style.left = `${Math.round(left)}px`;
    palette.style.top = `${Math.round(top)}px`;
  }

  function getAnchorRect(composer) {
    const trigger = state.trigger;

    if (trigger?.range && typeof trigger.range.getBoundingClientRect === 'function') {
      const rects = trigger.range.getClientRects?.();
      if (rects && rects.length) {
        const last = rects[rects.length - 1];
        if (rectIsUsable(last)) return last;
      }
      try {
        const rect = trigger.range.getBoundingClientRect();
        if (rectIsUsable(rect)) return rect;
      } catch {}
    }

    if (!state.caretRange && state.anchorEl) {
      state.caretRange = captureCaretRange(state.anchorEl);
    }

    const caretRange = state.caretRange;
    if (caretRange && typeof caretRange.getBoundingClientRect === 'function') {
      try {
        const rects = caretRange.getClientRects?.();
        if (rects && rects.length) {
          const last = rects[rects.length - 1];
          if (rectIsUsable(last)) return last;
        }
        const rect = caretRange.getBoundingClientRect();
        if (rectIsUsable(rect)) return rect;
      } catch {}
    }

    const sel = window.getSelection?.();
    if (sel && sel.rangeCount) {
      try {
        const range = sel.getRangeAt(0).cloneRange();
        range.collapse(false);
        const rects = range.getClientRects();
        if (rects.length) {
          const last = rects[rects.length - 1];
          if (rectIsUsable(last)) return last;
        }
        const rect = range.getBoundingClientRect();
        if (rectIsUsable(rect)) return rect;
      } catch {}
    }

    const anchor = state.anchorEl;
    if (anchor && document.contains(anchor)) {
      const expanded = expandAnchor(anchor);
      const rect = getRect(expanded);
      if (rectIsUsable(rect)) {
        state.anchorEl = expanded;
        return rect;
      }
    }

    const composerRect = getRect(composer || state.anchorEl);
    if (rectIsUsable(composerRect)) return composerRect;

    return composerRect || null;
  }

  function filterMatches(prompts, queryLower) {
    const matches = [];
    for (const prompt of prompts) {
      if (!prompt.nameLower.includes(queryLower)) continue;
      matches.push(prompt);
      if (matches.length >= MAX_RESULTS) break;
    }
    return matches;
  }

  async function loadPrompts() {
    const now = Date.now();
    if (promptCache && now - promptCacheAt < CACHE_TTL_MS) {
      return promptCache;
    }

    await ensureBGSession();

    const [custom, team, quick] = await Promise.all([
      fetchCustomPrompts(),
      fetchTeamPrompts(),
      fetchQuickAdds()
    ]);

    const lists = [custom, team, quick].filter(Array.isArray);
    if (!lists.length) return [];

    const combined = lists.flat();
    promptCache = combined.map((item) => ({
      ...item,
      nameLower: item.name.toLowerCase(),
      sourceLabel: item.sourceLabel || sourceLabelFor(item.source)
    }));
    promptCacheAt = now;
    return promptCache;
  }

  function sourceLabelFor(source) {
    if (source === 'quick') return 'Quick Add';
    if (source === 'team') return 'Team';
    return 'Custom';
  }

  async function fetchCustomPrompts() {
    const resp = await sendBG('VG_LIST_CUSTOM_PROMPTS');
    if (!resp || resp === '__NO_RECEIVER__' || resp === '__TIMEOUT__' || resp.ok !== true || !Array.isArray(resp.items)) return null;
    return resp.items.map((row) => ({
      id: String(row.id || row.name || ''),
      name: row.title || row.name || 'Custom Prompt',
      body: row.body || row.text || '',
      source: 'custom'
    }));
  }

  async function fetchTeamPrompts() {
    const resp = await sendBG('GET_TEAM_PROMPTS');
    if (!resp || resp === '__NO_RECEIVER__' || resp === '__TIMEOUT__' || resp.ok !== true || !Array.isArray(resp.prompts)) return null;
    return resp.prompts.map((row) => ({
      id: String(row.id || row.name || ''),
      name: row.name || 'Team Prompt',
      body: row.body || row.text || '',
      source: 'team'
    }));
  }

  async function fetchQuickAdds() {
    if (typeof window.vgQAGet !== 'function') return null;
    const ids = await window.vgQAGet();
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const lib = await ensurePromptLibrary();
    if (!Array.isArray(lib)) return [];
    const byId = new Map(lib.map((p) => [String(p.id), p]));
    return ids.map((id) => {
      const row = byId.get(String(id));
      if (!row) return null;
      return {
        id: String(id),
        name: row['Prompt Name'] || row.name || 'Quick Prompt',
        body: row['Prompt Text'] || '',
        source: 'quick'
      };
    }).filter(Boolean);
  }

  function ensurePromptLibrary() {
    if (Array.isArray(window.__VG_PROMPT_LIBRARY)) return Promise.resolve(window.__VG_PROMPT_LIBRARY);
    return new Promise((resolve) => {
      const handler = () => {
        resolve(window.__VG_PROMPT_LIBRARY || []);
      };
      document.addEventListener('vg-lib-ready', handler, { once: true });
    });
  }

  async function ensureBGSession() {
    try {
      const sot = await new Promise((res) => chrome.storage?.local?.get?.('VG_SESSION', (o) => res(o?.VG_SESSION || null)));
      if (!sot || !sot.access_token || !sot.refresh_token || !Number.isFinite(sot.expires_at)) return false;
      const r = await sendBG('SET_SESSION', {
        access_token: sot.access_token,
        refresh_token: sot.refresh_token,
        expires_at: sot.expires_at,
        userId: sot.userId || null,
        email: sot.email || null
      });
      return !!(r && r.ok);
    } catch {
      return false;
    }
  }

  async function sendBG(type, payload, timeoutMs = 1500) {

    async function ask() {
      return new Promise((res) => {
        let done = false;
        const timer = setTimeout(() => { if (!done) res('__TIMEOUT__'); }, timeoutMs);
        try {
          chrome.runtime.sendMessage({ type, ...(payload || {}) }, (r) => {
            done = true; clearTimeout(timer);
            if (chrome.runtime.lastError) return res('__NO_RECEIVER__');
            res(r);
          });
        } catch {
          res('__NO_RECEIVER__');
        }
      });
    }

    let resp = await ask();
    if (resp === '__NO_RECEIVER__' || resp === '__TIMEOUT__') {
      try {
        const { data:{ session } } = await (window.VG?.auth?.getSession?.() ?? { data:{ session: null } });
        if (session?.access_token && session?.refresh_token) {
          await new Promise((resolve) => {
            chrome.runtime.sendMessage({
              type: 'SET_SESSION',
              access_token: session.access_token,
              refresh_token: session.refresh_token
            }, () => resolve());
          });
        }
      } catch {}
      resp = await ask();
    }
    return resp;
  }

  function getComposerFromEvent(target) {
    if (!target) return null;
    if (isComposerElement(target)) return target;
    if (target.closest) {
      return target.closest('textarea, input[type="text"], input[type="search"], [contenteditable="true"], [role="textbox"][contenteditable="true"]');
    }
    return null;
  }

  function isComposerElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      return ['text', 'search', 'email', 'url', 'tel', 'password'].includes(t);
    }
    const ce = el.getAttribute && el.getAttribute('contenteditable');
    if (ce && ce.toLowerCase() === 'true') return true;
    if (el.getAttribute && el.getAttribute('role') === 'textbox' && ce !== 'false') return true;
    return false;
  }

  function ensurePaletteRoot() {
    let host = document.getElementById('__vg_slash_palette');
    if (host) return host;
    host = document.createElement('div');
    host.id = '__vg_slash_palette';
    host.className = 'vg-slash-root';
    const list = document.createElement('div');
    list.className = 'vg-slash-list';
    host.appendChild(list);
    document.body.appendChild(host);
    return host;
  }

  function ensurePaletteStyle() {
    if (document.getElementById('vg-slash-style')) return;
    const st = document.createElement('style');
    st.id = 'vg-slash-style';
    st.textContent = `
      .vg-slash-root {
        position: fixed;
        z-index: 2147483605;
        display: none;
        min-width: 320px;
        max-width: 360px;
        background: #0f1116;
        color: #e6e7eb;
        border: 1px solid #2a2a33;
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0,0,0,.5);
        font: 14px/1.4 Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
        overflow: hidden;
      }
      .vg-slash-list {
        max-height: 320px;
        overflow-y: auto;
        padding: 10px;
        scrollbar-width: thin;
        scrollbar-color: #2a2a33 #0c0e13;
      }
      .vg-slash-list::-webkit-scrollbar {
        width: 10px;
      }
      .vg-slash-list::-webkit-scrollbar-track {
        background: #0c0e13;
        border-radius: 8px;
      }
      .vg-slash-list::-webkit-scrollbar-thumb {
        background: #2a2a33;
        border-radius: 8px;
        border: 2px solid #0c0e13;
      }
      .vg-slash-list::-webkit-scrollbar-thumb:hover {
        background: #3a3a45;
      }
      .vg-slash-item {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 12px;
        margin-bottom: 6px;
        border-radius: 10px;
        border: 1px solid #22232b;
        background: #0c0e13;
        cursor: pointer;
        transition: border-color .12s ease, background .12s ease;
      }
      .vg-slash-item:last-child {
        margin-bottom: 0;
      }
      .vg-slash-item.active {
        border-color: #7c3aed;
        background: rgba(124,58,237,0.12);
      }
      .vg-slash-name {
        flex: 1;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: #e5e7eb;
        font-size: 14px;
      }
      .vg-slash-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }
      .vg-slash-icon {
        width: 26px;
        height: 26px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid #2a2a33;
        border-radius: 50%;
        background: #151821;
        color: #cfd4ff;
        cursor: pointer;
        transition: background .12s ease, color .12s ease, border-color .12s ease;
      }
      .vg-slash-icon:hover {
        color: #8b5cf6;
        border-color: #8b5cf6;
        background: rgba(139,92,246,0.12);
      }
      .vg-slash-open {
        color: #cfe5ff;
      }
      .vg-slash-open:hover {
        color: #60a5fa;
        border-color: #60a5fa;
        background: rgba(96,165,250,0.12);
      }
    `;
    document.head.appendChild(st);
  }

  function registerScrollListeners(composer) {
    removeScrollListeners();
    const targets = [window, document];
    const parent = findScrollableParent(state.anchorEl || composer);
    if (parent && parent !== document && parent !== window) targets.push(parent);
    targets.forEach((node) => {
      const handler = () => {
        if (!state.active) return;
        if (!state.paletteEl) return;
        const anchor = state.anchorEl || composer;
        if (!anchor || !document.contains(anchor)) {
          closePalette();
          return;
        }
        const rect = getAnchorRect(anchor);
        if (!rect || !rectIsUsable(rect)) {
          closePalette();
          return;
        }
        positionPalette(anchor, state.paletteEl);
      };
      const targetNode = node === document ? document : node;
      targetNode.addEventListener('scroll', handler, { passive: true });
      state.scrollListeners.push({ node: targetNode, handler });
    });
  }

  function removeScrollListeners() {
    state.scrollListeners.forEach(({ node, handler }) => {
      node.removeEventListener('scroll', handler, { passive: true });
    });
    state.scrollListeners = [];
  }

  function findScrollableParent(el) {
    let node = el?.parentElement;
    while (node && node !== document.body) {
      const style = window.getComputedStyle(node);
      const overflowY = style.overflowY;
      if (/(auto|scroll)/i.test(overflowY)) return node;
      node = node.parentElement;
    }
    return window;
  }

})();
