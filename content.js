// === HUD-ONLY MODE GUARD + HUD→MENU BRIDGE ===

(() => {
  try {
    const VG = (window.__VG = window.__VG || {});
    VG.flags = VG.flags || {};
    VG.flags.useIframeHUD = true;

    // remove any legacy nodes
    ["vibeguardian-pill-host","vg-pill-host","vg-pill","__vg_host__","__vg_legacy__"]
      .forEach(id => document.getElementById(id)?.remove());

    // stop legacy loops/observers if present
    try { clearInterval(window.__VG_LEGACY_INTERVAL__); } catch {}
    try { window.__VG_LEGACY_OBSERVER__?.disconnect(); } catch {}

    // stub legacy mounters so they cannot run later
	window.mountPill = window.vgAutoAnchorPill = window.vgPinPillUnderLovable = () => false;


// === Keep a live copy of auth state ===
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'VG_AUTH_CHANGED' || msg?.type === 'AUTH_STATUS_PUSH') {
    window.__VG_SIGNED_IN_GLOBAL = !!msg.signedIn;
  }
});


	// bridge: HUD click -> if signed in open Quick Menu, else open sign-in popup
	function __vgOpenMenuFromHud() {
	  // If signed out, open the sign-in popup instead of the menu
	  if (!window.__VG_SIGNED_IN_GLOBAL) {
	    try {
	      chrome.runtime.sendMessage({ type: 'VG_OPEN_SIGNIN_POPUP' }, (r) => {
	        if (!r || r.ok !== true) __vgOpenSigninPopupFallback();
	      });
	    } catch {
	      __vgOpenSigninPopupFallback();
	    }
	    return;
	  }
	
	  // don't immediately re-open if we just closed it
	  const now  = performance.now();
	  const last = window.__VG_LAST_MENU_CLOSE || 0;
	  if (now - last < 120) return;
	
	  // toggle: if it's open, close it
	  const existing = document.getElementById('vg-quick-menu');
	  if (existing) {
	    window.__VG_LAST_MENU_CLOSE = now;
	    existing.remove();
	    return;
	  }
		
	  // otherwise open it anchored to the HUD iframe
	  const f = document.getElementById('__vg_iframe_hud__');
	  if (!f) return;
	  const r = f.getBoundingClientRect();
	  if (typeof openQuickMenu === 'function') {
	    openQuickMenu({ left: r.left, top: r.top, width: r.width, height: r.height });
	  }
	}	



	function __vgOpenSigninPopupFallback() {
	  try {
	    const url = chrome.runtime.getURL('popup.html');
	    window.open(url, 'VGAuth', 'popup=yes,width=420,height=640');
	  } catch (_) {}
	}
	
	window.addEventListener("message", (e) => {
	  const d = e?.data || {};
	  if (!d || d.source !== "VG") return;
	
	    // back-compat events (gate just like PILL_CLICK)
		  if (d.type === "VG_OPEN" || d.type === "OPEN_QUICK_MENU") {
		    const signed = !!window.__VG_SIGNED_IN_GLOBAL;
		    if (signed) {
		      __vgOpenMenuFromHud();
		    } else {
		      try {
		        chrome.runtime.sendMessage({ type: 'VG_OPEN_SIGNIN_POPUP' }, (r) => {
		          if (!r || r.ok !== true) __vgOpenSigninPopupFallback();
		        });
		      } catch {
		        __vgOpenSigninPopupFallback();
		      }
		    }	
		    return;
		  }


	  // new unified event from hud_frame
	  if (d.type === "PILL_CLICK") {
	    const signed = !!window.__VG_SIGNED_IN_GLOBAL;
	    if (signed) {
	      __vgOpenMenuFromHud();
	      return;
	    }
	    // Not signed in -> ask background to open popup window
	    try {
	      chrome.runtime.sendMessage({ type: 'VG_OPEN_SIGNIN_POPUP' }, (r) => {
	        if (!r || r.ok !== true) __vgOpenSigninPopupFallback();
	      });
	    } catch {
	      __vgOpenSigninPopupFallback();
	    }
	  }
	}, true);

	
	  } catch {}
	})();

// content.js (bootstrap only)
(() => {
  (async () => {
    try {
      if (window.__VG_ALLOWED__ === false) return;


      // >>> HARD KILL (must be set *before* 0.5 import) <<<
      try {
        Object.defineProperty(window, '__VG_DISABLE_SEND_INTERCEPT', {
          value: true, configurable: true, enumerable: false, writable: true
        });
      } catch { window.__VG_DISABLE_SEND_INTERCEPT = true; }


      // 0) Ensure Settings UI (publishes window.__VG_SETTINGS)
      try {
        await import(chrome.runtime.getURL('src/ui/settings.js'));
        console.debug('[VG] settings ready →', typeof window.openModal, typeof window.__SB_OPEN_MODAL);
      } catch (e) {
        console.error('[VG] settings load failed:', e);
      }

      // 0.5) Install global send interceptor API (reads window.__VG_SETTINGS)
      try {
        await import(chrome.runtime.getURL('src/interceptsend.js'));
        console.debug('[VG] interceptsend ready');
      } catch (e) {
        console.error('[VG] interceptsend load failed:', e);
      }

      // 1) Ensure Quick Menu API
      try {
        await import(chrome.runtime.getURL('src/ui/quickmenu.js'));
      } catch (e) {
        console.error('[VG] quickmenu load failed:', e);
      }

      // 2) Start boot (auth + DB placement + HUD)
      await import(chrome.runtime.getURL('src/boot.js'));

    } catch (e) {
      console.error('[VG] content bootstrap error:', e);
    }
  })();
})();



// === Paywall + Billing message handlers (robust aliases) ===
(() => {
  function importPaywallAndShow(payload) {
    console.log('[VG][content] paywall request →', payload);
    return import(chrome.runtime.getURL('src/ui/paywall.js'))
      .then(() => {
        // Two supported exports: VGPaywall.show() OR __VG_OPEN_PAYWALL__()
        try {
          if (window.VGPaywall && typeof window.VGPaywall.show === 'function') {
            window.VGPaywall.show(payload || {});
            console.log('[VG][content] VGPaywall.show() invoked');
            return true;
          }
        } catch (e) { console.warn('[VG][content] VGPaywall.show() failed', e); }

        try {
          if (typeof window.__VG_OPEN_PAYWALL__ === 'function') {
            window.__VG_OPEN_PAYWALL__(payload?.reason || 'limit', payload?.source || 'unknown');
            console.log('[VG][content] __VG_OPEN_PAYWALL__ invoked');
            return true;
          }
        } catch (e) { console.warn('[VG][content] __VG_OPEN_PAYWALL__ failed', e); }

        // Fallback: open Settings modal on Billing tab
        try {
          const open = (window.openModal || window.__SB_OPEN_MODAL);
          if (typeof open === 'function') { open('billing'); return true; }
        } catch {}
        return false;
      })
      .catch(err => {
        console.warn('[VG][content] paywall import failed', err);
        // Fallback: Billing tab
        try {
          const open = (window.openModal || window.__SB_OPEN_MODAL);
          if (typeof open === 'function') { open('billing'); return true; }
        } catch {}
        return false;
      });
  }

  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      // Accept BOTH names: VG_PAYWALL_SHOW (underscore) and VG_PAYWALL:SHOW (colon)
      if (msg && (msg.type === 'VG_PAYWALL_SHOW' || msg.type === 'VG_PAYWALL:SHOW')) {
        importPaywallAndShow(msg.payload || { reason:'limit', source:'unknown' })
          .then(ok => sendResponse && sendResponse({ ok }))
          .catch(e => sendResponse && sendResponse({ ok:false, error:String(e?.message || e) }));
        return true; // async
      }

      if (msg?.type === 'VG_BILLING:CHECKOUT') {
        console.log('[VG][content] billing checkout request →', msg?.plan);
        try { window.__VGBilling?.checkout?.(msg.plan || 'basic'); }
        catch (e) { console.warn('[VG][content] billing checkout failed', e); }
        sendResponse && sendResponse({ ok:true });
        return false;
      }

      if (msg?.type === 'VG_BILLING:PORTAL') {
        console.log('[VG][content] billing portal request');
        try { window.__VGBilling?.portal?.(); }
        catch (e) { console.warn('[VG][content] billing portal failed', e); }
        sendResponse && sendResponse({ ok:true });
        return false;
      }

      if (msg?.type === 'VG_OPEN_BILLING') {
        try {
          const open = (window.openModal || window.__SB_OPEN_MODAL);
          if (typeof open === 'function') {
            open('billing');
            sendResponse && sendResponse({ ok:true });
            return false;
          }
          import(chrome.runtime.getURL('src/ui/settings.js'))
            .then(() => {
              const fn = (window.openModal || window.__SB_OPEN_MODAL);
              if (typeof fn === 'function') fn('billing');
              sendResponse && sendResponse({ ok:true });
            })
            .catch((e) => {
              console.warn('[VG][content] settings lazy import failed', e);
              sendResponse && sendResponse({ ok:false, error:String(e?.message || e) });
            });
          return true; // async
        } catch (e) {
          console.warn('[VG][content] VG_OPEN_BILLING handler failed', e);
          sendResponse && sendResponse({ ok:false, error:String(e?.message || e) });
          return false;
        }
      }

      return false;
    });
  } catch (e) {
    console.warn('[VG][content] paywall listener wiring failed', e);
  }
})();

