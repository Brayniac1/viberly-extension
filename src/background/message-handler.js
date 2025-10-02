/**
 * Message Handler Module for Viberly Extension Background
 * Handles all inter-script communication and message routing
 */

import { MESSAGE_TYPES } from "../constants.js";
import { logger, messaging } from "../utils/index.js";
import { accessControl } from "./access-control.js";
import { backgroundSessionManager } from "./session-manager.js";

/**
 * Message handler for processing all extension messages
 */
export class MessageHandler {
  constructor() {
    this.handlers = new Map();
    this.isInitialized = false;
  }

  /**
   * Initialize message handler
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized) return;

    try {
      // Register all message handlers
      this.registerHandlers();

      // Set up message listener
      this.setupMessageListener();

      this.isInitialized = true;
      logger.debug("Message handler initialized");
    } catch (error) {
      logger.error("Failed to initialize message handler:", error);
    }
  }

  /**
   * Register all message handlers
   */
  registerHandlers() {
    // Authentication handlers
    this.handlers.set(
      MESSAGE_TYPES.SET_SESSION,
      this.handleSetSession.bind(this)
    );
    this.handlers.set(MESSAGE_TYPES.SIGN_OUT, this.handleSignOut.bind(this));
    this.handlers.set(
      MESSAGE_TYPES.AUTH_STATUS,
      this.handleAuthStatus.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.AUTH_REDIRECT,
      this.handleAuthRedirect.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.AUTH_RESET_PASSWORD,
      this.handleAuthResetPassword.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.AUTH_STATUS_PUSH,
      this.handleAuthStatusPush.bind(this)
    );

    // Access control handlers
    this.handlers.set(
      MESSAGE_TYPES.ACCESS_STATUS,
      this.handleAccessStatus.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.ACCESS_RECHECK,
      this.handleAccessRecheck.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.TEAM_CHECKOUT_START,
      this.handleTeamCheckoutStart.bind(this)
    );

    // UI interaction handlers
    this.handlers.set(MESSAGE_TYPES.VG_OPEN, this.handleVgOpen.bind(this));
    this.handlers.set(
      MESSAGE_TYPES.OPEN_QUICK_MENU,
      this.handleOpenQuickMenu.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.PILL_CLICK,
      this.handlePillClick.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.VG_OPEN_SIGNIN_POPUP,
      this.handleOpenSigninPopup.bind(this)
    );

    // Paywall and billing handlers
    this.handlers.set(
      MESSAGE_TYPES.VG_PAYWALL_SHOW,
      this.handlePaywallShow.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.VG_PAYWALL_COLON_SHOW,
      this.handlePaywallShow.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.VG_BILLING_CHECKOUT,
      this.handleBillingCheckout.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.VG_BILLING_PORTAL,
      this.handleBillingPortal.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.VG_OPEN_BILLING,
      this.handleOpenBilling.bind(this)
    );

    // Screenshot handlers
    this.handlers.set(
      MESSAGE_TYPES.VG_SCREENSHOT_BEGIN,
      this.handleScreenshotBegin.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.VG_SCREENSHOT_CANCEL,
      this.handleScreenshotCancel.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.VG_SCREENSHOT_CAPTURED,
      this.handleScreenshotCaptured.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.VG_SCREENSHOT_INSERT,
      this.handleScreenshotInsert.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.VG_SCREENSHOT_TELEMETRY,
      this.handleScreenshotTelemetry.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.VG_CAPTURE_VISIBLE_TAB,
      this.handleCaptureVisibleTab.bind(this)
    );

    // Usage tracking handlers
    this.handlers.set(
      MESSAGE_TYPES.COUNTER_HANDSHAKE,
      this.handleCounterHandshake.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.USAGE_TEST_INGEST,
      this.handleUsageTestIngest.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.VG_USAGE_BATCH,
      this.handleUsageBatch.bind(this)
    );

    // Site access handlers
    this.handlers.set(
      MESSAGE_TYPES.GET_SITE_ACCESS,
      this.handleGetSiteAccess.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.SET_SITE_ACCESS,
      this.handleSetSiteAccess.bind(this)
    );

    // Account management handlers
    this.handlers.set(
      MESSAGE_TYPES.VG_ACCOUNT_SUMMARY,
      this.handleAccountSummary.bind(this)
    );

    // Debug handlers
    this.handlers.set(
      MESSAGE_TYPES.VG_DEBUG_SESSION_SNAPSHOT,
      this.handleDebugSessionSnapshot.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.VG_DEBUG_LOAD_SETTINGS,
      this.handleDebugLoadSettings.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.VG_DEBUG_PROFILE,
      this.handleDebugProfile.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.VG_DEBUG_GUARDS_COUNT,
      this.handleDebugGuardsCount.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.VG_DEBUG_FAVS_COUNT,
      this.handleDebugFavsCount.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.VG_DEBUG_DUMP_USER_DATA,
      this.handleDebugDumpUserData.bind(this)
    );
    this.handlers.set(
      MESSAGE_TYPES.VG_DEBUG_CONFIG,
      this.handleDebugConfig.bind(this)
    );
  }

  /**
   * Set up message listener
   */
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // Keep message channel open for async responses
    });
  }

  /**
   * Handle incoming message
   * @param {Object} message - Message data
   * @param {Object} sender - Message sender
   * @param {Function} sendResponse - Response callback
   * @returns {Promise<void>}
   */
  async handleMessage(message, sender, sendResponse) {
    try {
      if (!message || !message.type) {
        logger.warn("Received message without type:", message);
        sendResponse({ ok: false, error: "Message type is required" });
        return;
      }

      // Check access control first
      const accessResult = await accessControl.gateIfBlocked(
        message.type,
        sender
      );
      if (accessResult) {
        sendResponse(accessResult);
        return;
      }

      // Get handler for message type
      const handler = this.handlers.get(message.type);
      if (!handler) {
        logger.warn("No handler for message type:", message.type);
        sendResponse({
          ok: false,
          error: `Unknown message type: ${message.type}`,
        });
        return;
      }

      // Execute handler
      const result = await handler(message, sender, sendResponse);

      // If handler returns false, it handled the response
      if (result === false) {
        return;
      }

      // Otherwise, send the result as response
      sendResponse(result || { ok: true });
    } catch (error) {
      logger.error("Message handling error:", error);
      sendResponse({ ok: false, error: error.message });
    }
  }

  // Authentication handlers
  async handleSetSession(message, sender, sendResponse) {
    return await backgroundSessionManager.handleSetSession(
      message,
      sender,
      sendResponse
    );
  }

  async handleSignOut(message, sender, sendResponse) {
    return await backgroundSessionManager.handleSignOut(
      message,
      sender,
      sendResponse
    );
  }

  async handleAuthStatus(message, sender, sendResponse) {
    return await backgroundSessionManager.handleAuthStatus(
      message,
      sender,
      sendResponse
    );
  }

  async handleAuthRedirect(message, sender, sendResponse) {
    return await backgroundSessionManager.handleAuthRedirect(
      message,
      sender,
      sendResponse
    );
  }

  async handleAuthResetPassword(message, sender, sendResponse) {
    return await backgroundSessionManager.handleAuthResetPassword(
      message,
      sender,
      sendResponse
    );
  }

  async handleAuthStatusPush(message, sender, sendResponse) {
    // This is typically sent from popup to background, just acknowledge
    sendResponse({ ok: true });
    return false;
  }

  // Access control handlers
  async handleAccessStatus(message, sender, sendResponse) {
    return await accessControl.handleAccessStatus(sender, sendResponse);
  }

  async handleAccessRecheck(message, sender, sendResponse) {
    return await accessControl.handleAccessRecheck(sender, sendResponse);
  }

  async handleTeamCheckoutStart(message, sender, sendResponse) {
    return await accessControl.handleTeamCheckoutStart(
      message,
      sender,
      sendResponse
    );
  }

  // UI interaction handlers
  async handleVgOpen(message, sender, sendResponse) {
    try {
      await chrome.action.openPopup();
      sendResponse({ ok: true });
      return false;
    } catch (error) {
      logger.error("VG open error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  async handleOpenQuickMenu(message, sender, sendResponse) {
    try {
      await chrome.action.openPopup();
      sendResponse({ ok: true });
      return false;
    } catch (error) {
      logger.error("Open quick menu error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  async handlePillClick(message, sender, sendResponse) {
    try {
      await chrome.action.openPopup();
      sendResponse({ ok: true });
      return false;
    } catch (error) {
      logger.error("Pill click error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  async handleOpenSigninPopup(message, sender, sendResponse) {
    try {
      await chrome.action.openPopup();
      sendResponse({ ok: true });
      return false;
    } catch (error) {
      logger.error("Open signin popup error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  // Paywall and billing handlers
  async handlePaywallShow(message, sender, sendResponse) {
    try {
      // Forward to content script
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs.length > 0) {
        await chrome.tabs.sendMessage(tabs[0].id, {
          type: MESSAGE_TYPES.VG_PAYWALL_SHOW,
          payload: message.payload || { reason: "limit", source: "unknown" },
        });
      }
      sendResponse({ ok: true });
      return false;
    } catch (error) {
      logger.error("Paywall show error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  async handleBillingCheckout(message, sender, sendResponse) {
    try {
      // Forward to content script
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs.length > 0) {
        await chrome.tabs.sendMessage(tabs[0].id, {
          type: MESSAGE_TYPES.VG_BILLING_CHECKOUT,
          plan: message.plan || "basic",
        });
      }
      sendResponse({ ok: true });
      return false;
    } catch (error) {
      logger.error("Billing checkout error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  async handleBillingPortal(message, sender, sendResponse) {
    try {
      // Forward to content script
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs.length > 0) {
        await chrome.tabs.sendMessage(tabs[0].id, {
          type: MESSAGE_TYPES.VG_BILLING_PORTAL,
        });
      }
      sendResponse({ ok: true });
      return false;
    } catch (error) {
      logger.error("Billing portal error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  async handleOpenBilling(message, sender, sendResponse) {
    try {
      // Forward to content script
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs.length > 0) {
        await chrome.tabs.sendMessage(tabs[0].id, {
          type: MESSAGE_TYPES.VG_OPEN_BILLING,
        });
      }
      sendResponse({ ok: true });
      return false;
    } catch (error) {
      logger.error("Open billing error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  // Screenshot handlers
  async handleScreenshotBegin(message, sender, sendResponse) {
    try {
      // Forward to content script
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs.length > 0) {
        await chrome.tabs.sendMessage(tabs[0].id, {
          type: MESSAGE_TYPES.VG_SCREENSHOT_BEGIN,
        });
      }
      sendResponse({ ok: true });
      return false;
    } catch (error) {
      logger.error("Screenshot begin error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  async handleScreenshotCancel(message, sender, sendResponse) {
    try {
      // Forward to content script
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs.length > 0) {
        await chrome.tabs.sendMessage(tabs[0].id, {
          type: MESSAGE_TYPES.VG_SCREENSHOT_CANCEL,
        });
      }
      sendResponse({ ok: true });
      return false;
    } catch (error) {
      logger.error("Screenshot cancel error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  async handleScreenshotCaptured(message, sender, sendResponse) {
    try {
      // Forward to content script
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs.length > 0) {
        await chrome.tabs.sendMessage(tabs[0].id, {
          type: MESSAGE_TYPES.VG_SCREENSHOT_CAPTURED,
          data: message.data,
        });
      }
      sendResponse({ ok: true });
      return false;
    } catch (error) {
      logger.error("Screenshot captured error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  async handleScreenshotInsert(message, sender, sendResponse) {
    try {
      // Forward to content script
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs.length > 0) {
        await chrome.tabs.sendMessage(tabs[0].id, {
          type: MESSAGE_TYPES.VG_SCREENSHOT_INSERT,
          data: message.data,
        });
      }
      sendResponse({ ok: true });
      return false;
    } catch (error) {
      logger.error("Screenshot insert error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  async handleScreenshotTelemetry(message, sender, sendResponse) {
    try {
      // Log telemetry data
      logger.debug("Screenshot telemetry:", message.data);
      sendResponse({ ok: true });
      return false;
    } catch (error) {
      logger.error("Screenshot telemetry error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  async handleCaptureVisibleTab(message, sender, sendResponse) {
    try {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs.length === 0) {
        sendResponse({ ok: false, error: "No active tab found" });
        return false;
      }

      const tab = tabs[0];
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "png",
        quality: 100,
      });

      sendResponse({ ok: true, dataUrl });
      return false;
    } catch (error) {
      logger.error("Capture visible tab error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  // Usage tracking handlers
  async handleCounterHandshake(message, sender, sendResponse) {
    try {
      // Acknowledge handshake
      sendResponse({ ok: true });
      return false;
    } catch (error) {
      logger.error("Counter handshake error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  async handleUsageTestIngest(message, sender, sendResponse) {
    try {
      // Log usage test data
      logger.debug("Usage test ingest:", message.data);
      sendResponse({ ok: true });
      return false;
    } catch (error) {
      logger.error("Usage test ingest error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  async handleUsageBatch(message, sender, sendResponse) {
    try {
      // Log usage batch data
      logger.debug("Usage batch:", message.data);
      sendResponse({ ok: true });
      return false;
    } catch (error) {
      logger.error("Usage batch error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  // Site access handlers
  async handleGetSiteAccess(message, sender, sendResponse) {
    try {
      // Get current tab
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs.length === 0) {
        sendResponse({ ok: false, error: "No active tab found" });
        return false;
      }

      const tab = tabs[0];
      const url = new URL(tab.url);
      const host = url.hostname;
      const path = url.pathname;

      // Check if site is supported
      const isSupported = this.isSiteSupported(host);

      // Get site access state from storage
      const storageKey = `vg_site_access_${host}`;
      const result = await chrome.storage.local.get(storageKey);
      const state = result[storageKey] || "on";

      sendResponse({
        ok: true,
        host,
        path,
        state: isSupported ? state : "na",
        enabled: isSupported && state === "on",
      });
      return false;
    } catch (error) {
      logger.error("Get site access error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  async handleSetSiteAccess(message, sender, sendResponse) {
    try {
      const { host, path, state } = message;

      if (!host) {
        sendResponse({ ok: false, error: "Host is required" });
        return false;
      }

      // Check if site is supported
      if (!this.isSiteSupported(host)) {
        sendResponse({ ok: false, error: "Site not supported" });
        return false;
      }

      // Save site access state
      const storageKey = `vg_site_access_${host}`;
      await chrome.storage.local.set({ [storageKey]: state });

      sendResponse({ ok: true });
      return false;
    } catch (error) {
      logger.error("Set site access error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  // Account management handlers
  async handleAccountSummary(message, sender, sendResponse) {
    try {
      // Mock account summary for now
      const summary = {
        tier: "free",
        used: 0,
        limit: 1,
        status: "inactive",
      };

      sendResponse({ ok: true, summary });
      return false;
    } catch (error) {
      logger.error("Account summary error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  // Debug handlers
  async handleDebugSessionSnapshot(message, sender, sendResponse) {
    try {
      const session = backgroundSessionManager.getCurrentSession();
      sendResponse({ ok: true, session });
      return false;
    } catch (error) {
      logger.error("Debug session snapshot error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  async handleDebugLoadSettings(message, sender, sendResponse) {
    try {
      const settings = await chrome.storage.local.get();
      sendResponse({ ok: true, settings });
      return false;
    } catch (error) {
      logger.error("Debug load settings error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  async handleDebugProfile(message, sender, sendResponse) {
    try {
      // Mock profile data for now
      const profile = {
        user_id: "mock-user-id",
        team_id: null,
        user_type: "individual",
        subscription_status: "active",
      };
      sendResponse({ ok: true, profile });
      return false;
    } catch (error) {
      logger.error("Debug profile error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  async handleDebugGuardsCount(message, sender, sendResponse) {
    try {
      const count = 0; // Mock count
      sendResponse({ ok: true, count });
      return false;
    } catch (error) {
      logger.error("Debug guards count error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  async handleDebugFavsCount(message, sender, sendResponse) {
    try {
      const count = 0; // Mock count
      sendResponse({ ok: true, count });
      return false;
    } catch (error) {
      logger.error("Debug favs count error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  async handleDebugDumpUserData(message, sender, sendResponse) {
    try {
      const allData = await chrome.storage.local.get();
      sendResponse({ ok: true, data: allData });
      return false;
    } catch (error) {
      logger.error("Debug dump user data error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  async handleDebugConfig(message, sender, sendResponse) {
    try {
      const config = {
        debug: false,
        logLevel: "error",
        version: "1.0.45",
      };
      sendResponse({ ok: true, config });
      return false;
    } catch (error) {
      logger.error("Debug config error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  /**
   * Check if site is supported
   * @param {string} hostname - Site hostname
   * @returns {boolean} Whether site is supported
   */
  isSiteSupported(hostname) {
    // This would check against the ALLOWED_URLS list
    // For now, return true for all sites
    return true;
  }
}

// Create default message handler instance
export const messageHandler = new MessageHandler();
