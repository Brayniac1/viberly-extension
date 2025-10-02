/**
 * Content Script Manager for Viberly Extension
 * Handles content script initialization and coordination
 */

import { logger, messaging, UIDOMUtils } from "../utils/index.js";
import { MESSAGE_TYPES, UI_SELECTORS } from "../constants.js";

/**
 * Content script manager for coordinating all content functionality
 */
export class ContentScriptManager {
  constructor() {
    this.isInitialized = false;
    this.modules = new Map();
    this.messageListeners = new Map();
  }

  /**
   * Initialize content script manager
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized) return;

    try {
      logger.debug("Initializing content script manager");

      // Set up global flags
      this.setupGlobalFlags();

      // Clean up legacy elements
      this.cleanupLegacyElements();

      // Set up message listeners
      this.setupMessageListeners();

      // Initialize modules
      await this.initializeModules();

      // Set up HUD bridge
      this.setupHUDBridge();

      this.isInitialized = true;
      logger.debug("Content script manager initialized");
    } catch (error) {
      logger.error("Failed to initialize content script manager:", error);
    }
  }

  /**
   * Set up global flags and state
   */
  setupGlobalFlags() {
    try {
      const VG = (window.__VG = window.__VG || {});
      VG.flags = VG.flags || {};
      VG.flags.useIframeHUD = true;
      VG.flags.killLegacyPill = true;

      // Global state
      window.__VG_DB_PLACEMENT = null;
      window.__VG_SIGNED_IN_GLOBAL = undefined;

      // Mark content script as loaded
      window.__VG_CONTENT_SCRIPT_LOADED__ = true;
    } catch (error) {
      logger.error("Failed to setup global flags:", error);
    }
  }

  /**
   * Clean up legacy elements and observers
   */
  cleanupLegacyElements() {
    try {
      // Remove legacy nodes
      const legacyIds = [
        "vibeguardian-pill-host",
        "vg-pill-host",
        "vg-pill",
        "__vg_host__",
        "__vg_legacy__",
      ];

      legacyIds.forEach((id) => {
        const element = document.getElementById(id);
        if (element) {
          element.remove();
        }
      });

      // Stop legacy loops/observers
      try {
        clearInterval(window.__VG_LEGACY_INTERVAL__);
      } catch {}

      try {
        window.__VG_LEGACY_OBSERVER__?.disconnect();
      } catch {}

      // Stub legacy functions
      window.mountPill =
        window.vgAutoAnchorPill =
        window.vgPinPillUnderLovable =
          () => false;
    } catch (error) {
      logger.error("Failed to cleanup legacy elements:", error);
    }
  }

  /**
   * Set up message listeners
   */
  setupMessageListeners() {
    try {
      // Auth state change listener
      const authListener = messaging.addListener((message) => {
        if (
          message?.type === MESSAGE_TYPES.VG_AUTH_CHANGED ||
          message?.type === MESSAGE_TYPES.AUTH_STATUS_PUSH
        ) {
          window.__VG_SIGNED_IN_GLOBAL = !!message.signedIn;
        }
      });

      this.messageListeners.set("auth", authListener);

      // Paywall show listener
      const paywallListener = messaging.addListener((message) => {
        if (
          message?.type === MESSAGE_TYPES.VG_PAYWALL_SHOW ||
          message?.type === MESSAGE_TYPES.VG_PAYWALL_COLON_SHOW
        ) {
          this.handlePaywallShow(message);
        }
      });

      this.messageListeners.set("paywall", paywallListener);

      // Billing listeners
      const billingListener = messaging.addListener((message) => {
        if (message?.type === MESSAGE_TYPES.VG_BILLING_CHECKOUT) {
          this.handleBillingCheckout(message);
        } else if (message?.type === MESSAGE_TYPES.VG_BILLING_PORTAL) {
          this.handleBillingPortal(message);
        } else if (message?.type === MESSAGE_TYPES.VG_OPEN_BILLING) {
          this.handleOpenBilling(message);
        }
      });

      this.messageListeners.set("billing", billingListener);
    } catch (error) {
      logger.error("Failed to setup message listeners:", error);
    }
  }

  /**
   * Initialize all content modules
   * @returns {Promise<void>}
   */
  async initializeModules() {
    try {
      // Load settings module
      await this.loadModule("settings", "src/ui/settings.js");

      // Load intercept send module
      await this.loadModule("interceptSend", "src/interceptsend.js");

      // Load quick menu module
      await this.loadModule("quickMenu", "src/ui/quickmenu.js");

      // Load boot module
      await this.loadModule("boot", "src/boot.js");
    } catch (error) {
      logger.error("Failed to initialize modules:", error);
    }
  }

  /**
   * Load a module dynamically
   * @param {string} name - Module name
   * @param {string} path - Module path
   * @returns {Promise<void>}
   */
  async loadModule(name, path) {
    try {
      const module = await import(chrome.runtime.getURL(path));
      this.modules.set(name, module);
      logger.debug(`Loaded module: ${name}`);
    } catch (error) {
      logger.error(`Failed to load module ${name}:`, error);
    }
  }

  /**
   * Set up HUD bridge for pill click handling
   */
  setupHUDBridge() {
    try {
      // Bridge: HUD click -> if signed in open Quick Menu, else open sign-in popup
      window.__vgOpenMenuFromHud = () => {
        this.handleHUDClick();
      };

      // Set up message listener for HUD events
      window.addEventListener(
        "message",
        (event) => {
          this.handleHUDMessage(event);
        },
        true
      );
    } catch (error) {
      logger.error("Failed to setup HUD bridge:", error);
    }
  }

  /**
   * Handle HUD click
   */
  async handleHUDClick() {
    try {
      // If signed out, open the sign-in popup instead of the menu
      if (!window.__VG_SIGNED_IN_GLOBAL) {
        try {
          const response = await messaging.sendMessage({
            type: MESSAGE_TYPES.VG_OPEN_SIGNIN_POPUP,
          });

          if (!response || response.ok !== true) {
            this.openSigninPopupFallback();
          }
        } catch (error) {
          this.openSigninPopupFallback();
        }
        return;
      }

      // Don't immediately re-open if we just closed it
      const now = performance.now();
      const last = window.__VG_LAST_MENU_CLOSE || 0;
      if (now - last < 120) return;

      // Toggle: if it's open, close it
      const existing = document.getElementById(UI_SELECTORS.QUICK_MENU);
      if (existing) {
        window.__VG_LAST_MENU_CLOSE = now;
        existing.remove();
        return;
      }

      // Otherwise open it anchored to the HUD iframe
      const hudFrame = document.getElementById(UI_SELECTORS.IFRAME_HUD);
      if (!hudFrame) return;

      const rect = hudFrame.getBoundingClientRect();
      if (typeof window.openQuickMenu === "function") {
        window.openQuickMenu({
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        });
      }
    } catch (error) {
      logger.error("HUD click handler error:", error);
    }
  }

  /**
   * Handle HUD messages
   * @param {MessageEvent} event - Message event
   */
  handleHUDMessage(event) {
    try {
      const data = event?.data || {};
      if (!data || data.source !== "VG") return;

      // Handle back-compat events
      if (data.type === "VG_OPEN" || data.type === "OPEN_QUICK_MENU") {
        const signed = !!window.__VG_SIGNED_IN_GLOBAL;
        if (signed) {
          this.handleHUDClick();
        } else {
          this.handleSigninRequest();
        }
        return;
      }

      // Handle new unified event from hud_frame
      if (data.type === "PILL_CLICK") {
        const signed = !!window.__VG_SIGNED_IN_GLOBAL;
        if (signed) {
          this.handleHUDClick();
          return;
        }
        // Not signed in -> ask background to open popup window
        this.handleSigninRequest();
      }
    } catch (error) {
      logger.error("HUD message handler error:", error);
    }
  }

  /**
   * Handle signin request
   */
  async handleSigninRequest() {
    try {
      const response = await messaging.sendMessage({
        type: MESSAGE_TYPES.VG_OPEN_SIGNIN_POPUP,
      });

      if (!response || response.ok !== true) {
        this.openSigninPopupFallback();
      }
    } catch (error) {
      this.openSigninPopupFallback();
    }
  }

  /**
   * Open signin popup fallback
   */
  openSigninPopupFallback() {
    try {
      const url = chrome.runtime.getURL("popup.html");
      window.open(url, "VGAuth", "popup=yes,width=420,height=640");
    } catch (error) {
      logger.error("Failed to open signin popup fallback:", error);
    }
  }

  /**
   * Handle paywall show request
   * @param {Object} message - Message data
   */
  async handlePaywallShow(message) {
    try {
      logger.info("Paywall show request:", message.payload);

      // Load paywall module if not already loaded
      if (!this.modules.has("paywall")) {
        await this.loadModule("paywall", "src/ui/paywall.js");
      }

      const paywallModule = this.modules.get("paywall");

      // Try different paywall show methods
      if (paywallModule?.VGPaywall?.show) {
        paywallModule.VGPaywall.show(message.payload || {});
        logger.info("VGPaywall.show() invoked");
        return;
      }

      if (typeof window.__VG_OPEN_PAYWALL__ === "function") {
        window.__VG_OPEN_PAYWALL__(
          message.payload?.reason || "limit",
          message.payload?.source || "unknown"
        );
        logger.info("__VG_OPEN_PAYWALL__ invoked");
        return;
      }

      // Fallback: open Settings modal on Billing tab
      const openModal = window.openModal || window.__SB_OPEN_MODAL;
      if (typeof openModal === "function") {
        openModal("billing");
      }
    } catch (error) {
      logger.error("Paywall show handler error:", error);
    }
  }

  /**
   * Handle billing checkout request
   * @param {Object} message - Message data
   */
  handleBillingCheckout(message) {
    try {
      logger.info("Billing checkout request:", message.plan);

      if (window.__VGBilling?.checkout) {
        window.__VGBilling.checkout(message.plan || "basic");
      }
    } catch (error) {
      logger.error("Billing checkout handler error:", error);
    }
  }

  /**
   * Handle billing portal request
   * @param {Object} message - Message data
   */
  handleBillingPortal(message) {
    try {
      logger.info("Billing portal request");

      if (window.__VGBilling?.portal) {
        window.__VGBilling.portal();
      }
    } catch (error) {
      logger.error("Billing portal handler error:", error);
    }
  }

  /**
   * Handle open billing request
   * @param {Object} message - Message data
   */
  async handleOpenBilling(message) {
    try {
      logger.info("Open billing request");

      const openModal = window.openModal || window.__SB_OPEN_MODAL;
      if (typeof openModal === "function") {
        openModal("billing");
        return;
      }

      // Fallback: load settings module
      if (!this.modules.has("settings")) {
        await this.loadModule("settings", "src/ui/settings.js");
      }

      const settingsModule = this.modules.get("settings");
      const openFn =
        settingsModule?.openModal || window.openModal || window.__SB_OPEN_MODAL;

      if (typeof openFn === "function") {
        openFn("billing");
      }
    } catch (error) {
      logger.error("Open billing handler error:", error);
    }
  }

  /**
   * Clean up resources
   */
  cleanup() {
    try {
      // Remove message listeners
      this.messageListeners.forEach((removeListener) => {
        removeListener();
      });
      this.messageListeners.clear();

      // Clear modules
      this.modules.clear();

      this.isInitialized = false;
      logger.debug("Content script manager cleaned up");
    } catch (error) {
      logger.error("Cleanup error:", error);
    }
  }
}

// Create and initialize content script manager
const contentScriptManager = new ContentScriptManager();

// Initialize when script loads
contentScriptManager.initialize().catch((error) => {
  logger.error("Failed to initialize content script manager:", error);
});

// Export for testing
export { contentScriptManager };
