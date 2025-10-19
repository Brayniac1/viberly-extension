const CHANNEL_KEY = "__vg_modal_channel__";

if (!window[CHANNEL_KEY]) {
  const listeners = new Set();

  window[CHANNEL_KEY] = {
    subscribe(fn) {
      if (typeof fn === "function") {
        listeners.add(fn);
        return () => listeners.delete(fn);
      }
      return () => {};
    },
    publish(event) {
      listeners.forEach((fn) => {
        try {
          fn(event);
        } catch (err) {
          console.warn("[VG][modal-channel] listener error", err);
        }
      });
    },
    close(id) {
      listeners.forEach((fn) => {
        try {
          fn({ type: "close", id });
        } catch (err) {
          console.warn("[VG][modal-channel] listener error", err);
        }
      });
    },
    currentOwner: null,
    setOwner(id) {
      this.currentOwner = id;
    },
  };
}

export function publishModalEvent(payload) {
  if (!payload) return;
  if (payload.type === "open" && payload.id) {
    window[CHANNEL_KEY]?.setOwner?.(payload.id);
  }
  if (payload.type === "close" && payload.id) {
    const owner = window[CHANNEL_KEY]?.currentOwner;
    if (owner === payload.id) {
      window[CHANNEL_KEY]?.setOwner?.(null);
    }
  }
  window[CHANNEL_KEY]?.publish?.(payload);
}

export function closeOtherModals(id) {
  window[CHANNEL_KEY]?.close?.(id);
}

export function subscribeToModalChannel(fn) {
  return window[CHANNEL_KEY]?.subscribe?.(fn) || (() => {});
}

export const MODAL_IDS = {
  markers: "markers_modal",
  suggestion: "suggestion_modal",
  quickmenu: "quickmenu_modal",
};
