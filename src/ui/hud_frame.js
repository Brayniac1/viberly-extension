// Build the pill UI in JS (no inline scripts/styles -> CSP-safe)
(function () {
  // CSS reset INSIDE the iframe (prevents UA/backgrounds)
  try {
    const st = document.createElement('style');
    st.textContent = `
      html, body {
        background: transparent !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      /* container we paint into */
      #pill {
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        padding: var(--vg-pad, 1px);         /* small inset so purple stroke never clips */
        background: #1f1f26 !important;      /* dark gray so no black-square flash */
        border: 0 !important;
        outline: none !important;
        border-radius: 8px !important;      /* rounded corners */
        box-shadow: none !important;
        filter: none;
        cursor: pointer;
        user-select: none;
        transition: filter 0.18s ease;
        will-change: filter;
      }


      #icon {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
        object-position: center center;
        background: transparent !important;
        image-rendering: -webkit-optimize-contrast;
      }
      #typingDot {
        display: none;
        width: 6px;
        height: 6px;
        background: #542DF9;
        border-radius: 50%;
        box-shadow: 0 0 0 0 rgba(84,45,249,0.45);
        pointer-events: none;
      }
      @keyframes vgHudTypingPulse {
        0%, 100% {
          box-shadow: 0 0 0 0 rgba(84,45,249,0.45);
          opacity: 1;
        }
        50% {
          box-shadow: 0 0 0 10px rgba(84,45,249,0);
          opacity: 0.75;
        }
      }
      #pill.has-suggestion {
        padding: var(--vg-pad, 1px) 6px;
        gap: 6px;
      }
      #pill.has-suggestion #iconWrap {
        flex: 0 0 20px;
      }
      #suggestBadge {
        display: none;
        width: 16px;
        height: 16px;
        border-radius: 999px;
        background: #542DF9;
        color: #fff;
        font-size: 10px;
        font-weight: 700;
        line-height: 1;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        pointer-events: auto;
        box-shadow: 0 2px 8px rgba(84,45,249,0.25);
      }
      /* More visible, still geometry-safe */
	#pill:hover,
	#pill:focus-visible {
	  /* noticeable but not gaudy on dark UIs */
	  filter:
	    brightness(1.18)                          /* up from 1.06 */
	    saturate(1.10)                            /* up from 1.03 */
	    drop-shadow(0 0 5px rgba(255,255,255,0.35))    /* brighter inner glow */
	    drop-shadow(0 0 12px rgba(114, 94, 255, 0.28)); /* soft purple aura */
	}

      /* Respect reduced motion */
      @media (prefers-reduced-motion: reduce) {
        #pill { transition: none; }
        #pill:hover { filter: none; }
        #typingDot { animation: none !important; }
      }
    `;
    document.head.appendChild(st);
  } catch {}

  const pill = document.createElement('div');
  const icon = document.createElement('img');
  const typingDot = document.createElement('div');
  const badge = document.createElement('div');
  const iconWrap = document.createElement('div');
  pill.id = 'pill';
  icon.id = 'icon';
  typingDot.id = 'typingDot';
  badge.id = 'suggestBadge';
  iconWrap.id = 'iconWrap';

  pill.setAttribute('role','button');
  pill.setAttribute('aria-label','Viberly');
  pill.tabIndex = 0;
  icon.style.pointerEvents = 'none';
  typingDot.setAttribute('aria-hidden', 'true');
  badge.setAttribute('aria-hidden', 'true');
  badge.textContent = '1';



  document.body.appendChild(pill);
  pill.appendChild(typingDot);
  iconWrap.appendChild(icon);
  pill.appendChild(iconWrap);
  pill.appendChild(badge);

  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    parent.postMessage({ source:'VG', type:'PILL_SUGGEST_CLICK' }, '*');
  });


  // base styles
  const s = pill.style;
  s.display = 'flex';
  s.alignItems = s.justifyContent = 'center';
  s.borderRadius = '10px';                // rounded corners
  s.boxShadow = 'none';
  s.border = '0';
  s.outline = 'none';
  s.cursor = 'pointer';
  s.userSelect = 'none';
  s.boxSizing = 'border-box';
  s.background = '#1f1f26';               // dark gray fallback before icon paints

	
	document.documentElement.style.background = 'transparent';
	document.body.style.background = 'transparent';
	document.body.style.margin = '0';
	document.body.style.border = '0';
	document.body.style.boxShadow = 'none';

	
	// remove focus ring on click/focus (if you still want keyboard focus, keep tabIndex=0 above)
	pill.addEventListener('focus', () => { s.outline = 'none'; });
	pill.addEventListener('mousedown', () => { try { pill.blur(); } catch {} });



let __VG_LAST_SIZE__ = 34;
let __VG_LAST_PAD__ = 2;
let __VG_TYPING_ACTIVE__ = false;
let __VG_SUGGEST_ACTIVE__ = false;
const prefersReducedMotion = (() => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)');
  } catch {
    return { matches: false, addEventListener: () => {}, addListener: () => {} };
  }
})();

function applyTypingVisual() {
  if (__VG_TYPING_ACTIVE__) {
    typingDot.style.display = 'block';
    icon.style.display = 'none';
    const shell = Math.max(18, Math.round(__VG_LAST_SIZE__ * 0.55));
    pill.style.width = shell + 'px';
    pill.style.height = shell + 'px';
    pill.style.borderRadius = '999px';
    pill.style.setProperty('--vg-pad', Math.max(1, Math.round(shell * 0.15)) + 'px');
    pill.style.background = 'rgba(84, 45, 249, 0.16)';
    pill.style.boxShadow = '0 0 10px rgba(84,45,249,0.32)';
    badge.style.display = 'none';
    pill.classList.remove('has-suggestion');
    if (!prefersReducedMotion.matches) {
      typingDot.style.animation = 'vgHudTypingPulse 1.3s ease-in-out infinite';
    } else {
      typingDot.style.animation = 'none';
    }
  } else {
    typingDot.style.display = 'none';
    typingDot.style.animation = 'none';
    icon.style.display = 'block';
    pill.style.width = __VG_LAST_SIZE__ + 'px';
    pill.style.height = __VG_LAST_SIZE__ + 'px';
    pill.style.borderRadius = '8px';
    pill.style.setProperty('--vg-pad', __VG_LAST_PAD__ + 'px');
    pill.style.background = '#1f1f26';
    pill.style.boxShadow = 'none';
    if (__VG_SUGGEST_ACTIVE__) {
      badge.style.display = 'flex';
      pill.classList.add('has-suggestion');
      const shell = __VG_LAST_SIZE__ + 18;
      pill.style.width = shell + 'px';
    } else {
      badge.style.display = 'none';
      pill.classList.remove('has-suggestion');
    }
  }
}

try {
  const cb = () => applyTypingVisual();
  if (typeof prefersReducedMotion.addEventListener === 'function') {
    prefersReducedMotion.addEventListener('change', cb);
  } else if (typeof prefersReducedMotion.addListener === 'function') {
    prefersReducedMotion.addListener(cb);
  }
} catch {}

function paint({ signedIn, size, pillSize, iconIdle, iconActive }) {
  const hinted = Number(size ?? pillSize);
  const sz = (Number.isFinite(hinted) && hinted > 0) ? Math.round(hinted) : __VG_LAST_SIZE__;
  __VG_LAST_SIZE__ = sz;

  const pad = Math.max(1, Math.round(sz * 0.05));   // ~5%
  pill.style.setProperty('--vg-pad', pad + 'px');
  __VG_LAST_PAD__ = pad;
  pill.style.width  = sz + 'px';
  pill.style.height = sz + 'px';

  const src = signedIn ? iconActive : iconIdle;
  if (src && icon.getAttribute('src') !== src) {
    icon.onerror = (e) => { try { console.error('[VG/hud_frame] icon load failed:', src, e); } catch {} };
    icon.setAttribute('src', src);
  }

  pill.title = signedIn ? 'Quick Menu' : 'Please sign in to use Viberly';
  applyTypingVisual();
}



  // Click → tell host (content script) to decide (menu vs popup)
  function notifyPillClick(){ parent.postMessage({ source:'VG', type:'PILL_CLICK' }, '*'); }
let __VG_SUPPRESS_CLICK__ = false;

pill.addEventListener('click', (e) => {
  if (__VG_SUPPRESS_CLICK__) {
    __VG_SUPPRESS_CLICK__ = false;
    try { e.preventDefault(); e.stopPropagation(); } catch {}
    return;
  }
  notifyPillClick();
});



let __VG_DRAGGING__ = false;
let __downX = 0, __downY = 0, __pid = 0;



// Begin: click-hold arm (with pointer capture)
pill.addEventListener('pointerdown', (e) => {
  __VG_DRAGGING__ = true;
  __pid = e.pointerId || 1;
  __downX = e.clientX;
  __downY = e.clientY;
  try { pill.setPointerCapture(__pid); } catch {}

  parent.postMessage({
    source: 'VG', type: 'DRAG_ARM',
    x: __downX, y: __downY, buttons: e.buttons, pointerId: __pid
  }, '*');
}, { passive: true });

// Stream moves as deltas from the down point
pill.addEventListener('pointermove', (e) => {
  if (!__VG_DRAGGING__) return;
  const dx = e.clientX - __downX;
  const dy = e.clientY - __downY;
  parent.postMessage({
    source: 'VG', type: 'DRAG_MOVE_DELTA',
    dx, dy, buttons: e.buttons, pointerId: __pid
  }, '*');
}, { passive: true });


// End: send final deltas and release capture
['pointerup','pointercancel'].forEach(t =>
  pill.addEventListener(t, (e) => {
    if (!__VG_DRAGGING__) return;
    __VG_DRAGGING__ = false;


    const dx = e.clientX - __downX;
    const dy = e.clientY - __downY;
    try { pill.releasePointerCapture(__pid); } catch {}
    parent.postMessage({
      source: 'VG', type: 'DRAG_END',
      dx, dy, buttons: e.buttons, pointerId: __pid
    }, '*');
  }, { passive: true })
);



  pill.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') notifyPillClick(); });

window.addEventListener('message', (ev) => {
  const msg = ev?.data || {};
  if (!msg || msg.source !== 'VG') return;

  if (msg.type === 'PAINT_AUTH') {
    paint(msg);
    return;
  }
  if (msg.type === 'PILL_TYPING') {
    __VG_TYPING_ACTIVE__ = !!msg.typing;
    applyTypingVisual();
    return;
  }
  if (msg.type === 'PILL_SUGGEST') {
    __VG_SUGGEST_ACTIVE__ = !!msg.suggestion;
    applyTypingVisual();
    return;
  }
  if (msg.type === 'DRAG_SILENCE' || msg.type === 'DRAG_CONFIRMED') {
    __VG_SUPPRESS_CLICK__ = true;
    return;
  }
  if (msg.type === 'DRAG_UNSILENCE') {
    __VG_SUPPRESS_CLICK__ = false;
    return;
  }
});


  // handshake so host can send first PAINT_AUTH
  parent.postMessage({ source:'VG', type:'HUD_READY' }, '*');
})();
