/**
 * WebExtension Polyfill for Viberly Extension
 * Provides cross-browser compatibility for Chrome, Firefox, Edge, Brave, Opera
 */

import { logger } from "./logger.js";

/**
 * WebExtension polyfill manager
 */
export class PolyfillManager {
  constructor() {
    this.isInitialized = false;
    this.browser = null;
    this.chrome = null;
  }

  /**
   * Initialize polyfill
   * @returns {Object} Browser API object
   */
  initialize() {
    if (this.isInitialized) {
      return this.browser || this.chrome;
    }

    try {
      // Check if webextension-polyfill is available
      if (typeof browser !== "undefined" && browser.runtime) {
        this.browser = browser;
        logger.debug("Using native browser API");
      } else if (typeof chrome !== "undefined" && chrome.runtime) {
        this.chrome = chrome;
        logger.debug("Using Chrome API");
      } else {
        throw new Error("No browser API available");
      }

      this.isInitialized = true;
      return this.browser || this.chrome;
    } catch (error) {
      logger.error("Polyfill initialization error:", error);
      throw error;
    }
  }

  /**
   * Get the appropriate API object
   * @returns {Object} Browser API object
   */
  getAPI() {
    if (!this.isInitialized) {
      this.initialize();
    }
    return this.browser || this.chrome;
  }

  /**
   * Check if running in Firefox
   * @returns {boolean} Whether running in Firefox
   */
  isFirefox() {
    return typeof browser !== "undefined" && browser.runtime && !chrome;
  }

  /**
   * Check if running in Chrome/Chromium
   * @returns {boolean} Whether running in Chrome/Chromium
   */
  isChrome() {
    return typeof chrome !== "undefined" && chrome.runtime;
  }

  /**
   * Get browser name
   * @returns {string} Browser name
   */
  getBrowserName() {
    if (this.isFirefox()) return "firefox";
    if (this.isChrome()) return "chrome";
    return "unknown";
  }

  /**
   * Get manifest version
   * @returns {number} Manifest version
   */
  getManifestVersion() {
    try {
      const api = this.getAPI();
      return api.runtime.getManifest().manifest_version || 2;
    } catch (error) {
      logger.error("Failed to get manifest version:", error);
      return 2;
    }
  }

  /**
   * Check if manifest v3
   * @returns {boolean} Whether using manifest v3
   */
  isManifestV3() {
    return this.getManifestVersion() === 3;
  }

  /**
   * Get extension ID
   * @returns {string} Extension ID
   */
  getExtensionId() {
    try {
      const api = this.getAPI();
      return api.runtime.id;
    } catch (error) {
      logger.error("Failed to get extension ID:", error);
      return "";
    }
  }

  /**
   * Get extension URL
   * @param {string} path - Path to append
   * @returns {string} Extension URL
   */
  getExtensionURL(path = "") {
    try {
      const api = this.getAPI();
      return api.runtime.getURL(path);
    } catch (error) {
      logger.error("Failed to get extension URL:", error);
      return "";
    }
  }

  /**
   * Check if extension is in development mode
   * @returns {boolean} Whether in development mode
   */
  isDevelopmentMode() {
    try {
      const api = this.getAPI();
      const manifest = api.runtime.getManifest();
      return manifest.key === undefined;
    } catch (error) {
      logger.error("Failed to check development mode:", error);
      return false;
    }
  }

  /**
   * Get extension version
   * @returns {string} Extension version
   */
  getExtensionVersion() {
    try {
      const api = this.getAPI();
      const manifest = api.runtime.getManifest();
      return manifest.version || "1.0.0";
    } catch (error) {
      logger.error("Failed to get extension version:", error);
      return "1.0.0";
    }
  }

  /**
   * Check if API is available
   * @param {string} apiName - API name to check
   * @returns {boolean} Whether API is available
   */
  isAPIAvailable(apiName) {
    try {
      const api = this.getAPI();
      const parts = apiName.split(".");
      let current = api;

      for (const part of parts) {
        if (current && typeof current === "object" && part in current) {
          current = current[part];
        } else {
          return false;
        }
      }

      return typeof current !== "undefined";
    } catch (error) {
      logger.error(`Failed to check API availability for ${apiName}:`, error);
      return false;
    }
  }

  /**
   * Create cross-browser compatible storage API
   * @returns {Object} Storage API
   */
  createStorageAPI() {
    const api = this.getAPI();

    if (!api.storage) {
      throw new Error("Storage API not available");
    }

    return {
      local: api.storage.local,
      sync: api.storage.sync,
      managed: api.storage.managed,
      onChanged: api.storage.onChanged,
    };
  }

  /**
   * Create cross-browser compatible runtime API
   * @returns {Object} Runtime API
   */
  createRuntimeAPI() {
    const api = this.getAPI();

    if (!api.runtime) {
      throw new Error("Runtime API not available");
    }

    return {
      id: api.runtime.id,
      getURL: api.runtime.getURL.bind(api.runtime),
      getManifest: api.runtime.getManifest.bind(api.runtime),
      sendMessage: api.runtime.sendMessage.bind(api.runtime),
      onMessage: api.runtime.onMessage,
      onConnect: api.runtime.onConnect,
      onInstalled: api.runtime.onInstalled,
      lastError: api.runtime.lastError,
    };
  }

  /**
   * Create cross-browser compatible tabs API
   * @returns {Object} Tabs API
   */
  createTabsAPI() {
    const api = this.getAPI();

    if (!api.tabs) {
      throw new Error("Tabs API not available");
    }

    return {
      query: api.tabs.query.bind(api.tabs),
      get: api.tabs.get.bind(api.tabs),
      create: api.tabs.create.bind(api.tabs),
      update: api.tabs.update.bind(api.tabs),
      remove: api.tabs.remove.bind(api.tabs),
      onUpdated: api.tabs.onUpdated,
      onActivated: api.tabs.onActivated,
      onRemoved: api.tabs.onRemoved,
      captureVisibleTab: api.tabs.captureVisibleTab.bind(api.tabs),
      executeScript: api.tabs.executeScript.bind(api.tabs),
      insertCSS: api.tabs.insertCSS.bind(api.tabs),
      removeCSS: api.tabs.removeCSS.bind(api.tabs),
    };
  }

  /**
   * Create cross-browser compatible windows API
   * @returns {Object} Windows API
   */
  createWindowsAPI() {
    const api = this.getAPI();

    if (!api.windows) {
      throw new Error("Windows API not available");
    }

    return {
      get: api.windows.get.bind(api.windows),
      getCurrent: api.windows.getCurrent.bind(api.windows),
      getLastFocused: api.windows.getLastFocused.bind(api.windows),
      getAll: api.windows.getAll.bind(api.windows),
      create: api.windows.create.bind(api.windows),
      update: api.windows.update.bind(api.windows),
      remove: api.windows.remove.bind(api.windows),
      onCreated: api.windows.onCreated,
      onRemoved: api.windows.onRemoved,
      onFocusChanged: api.windows.onFocusChanged,
    };
  }

  /**
   * Create cross-browser compatible scripting API (Manifest V3)
   * @returns {Object} Scripting API
   */
  createScriptingAPI() {
    const api = this.getAPI();

    if (!api.scripting) {
      throw new Error("Scripting API not available (requires Manifest V3)");
    }

    return {
      executeScript: api.scripting.executeScript.bind(api.scripting),
      insertCSS: api.scripting.insertCSS.bind(api.scripting),
      removeCSS: api.scripting.removeCSS.bind(api.scripting),
      registerContentScripts: api.scripting.registerContentScripts.bind(
        api.scripting
      ),
      unregisterContentScripts: api.scripting.unregisterContentScripts.bind(
        api.scripting
      ),
      getRegisteredContentScripts:
        api.scripting.getRegisteredContentScripts.bind(api.scripting),
    };
  }

  /**
   * Create cross-browser compatible action API (Manifest V3)
   * @returns {Object} Action API
   */
  createActionAPI() {
    const api = this.getAPI();

    if (!api.action) {
      throw new Error("Action API not available (requires Manifest V3)");
    }

    return {
      setTitle: api.action.setTitle.bind(api.action),
      getTitle: api.action.getTitle.bind(api.action),
      setIcon: api.action.setIcon.bind(api.action),
      setBadgeText: api.action.setBadgeText.bind(api.action),
      getBadgeText: api.action.getBadgeText.bind(api.action),
      setBadgeBackgroundColor: api.action.setBadgeBackgroundColor.bind(
        api.action
      ),
      getBadgeBackgroundColor: api.action.getBadgeBackgroundColor.bind(
        api.action
      ),
      enable: api.action.enable.bind(api.action),
      disable: api.action.disable.bind(api.action),
      openPopup: api.action.openPopup.bind(api.action),
      onClicked: api.action.onClicked,
    };
  }

  /**
   * Create cross-browser compatible browserAction API (Manifest V2)
   * @returns {Object} BrowserAction API
   */
  createBrowserActionAPI() {
    const api = this.getAPI();

    if (!api.browserAction) {
      throw new Error("BrowserAction API not available (requires Manifest V2)");
    }

    return {
      setTitle: api.browserAction.setTitle.bind(api.browserAction),
      getTitle: api.browserAction.getTitle.bind(api.browserAction),
      setIcon: api.browserAction.setIcon.bind(api.browserAction),
      setBadgeText: api.browserAction.setBadgeText.bind(api.browserAction),
      getBadgeText: api.browserAction.getBadgeText.bind(api.browserAction),
      setBadgeBackgroundColor: api.browserAction.setBadgeBackgroundColor.bind(
        api.browserAction
      ),
      getBadgeBackgroundColor: api.browserAction.getBadgeBackgroundColor.bind(
        api.browserAction
      ),
      enable: api.browserAction.enable.bind(api.browserAction),
      disable: api.browserAction.disable.bind(api.browserAction),
      onClicked: api.browserAction.onClicked,
    };
  }

  /**
   * Get the appropriate action API based on manifest version
   * @returns {Object} Action API
   */
  getActionAPI() {
    if (this.isManifestV3()) {
      return this.createActionAPI();
    } else {
      return this.createBrowserActionAPI();
    }
  }

  /**
   * Get the appropriate scripting API based on manifest version
   * @returns {Object} Scripting API
   */
  getScriptingAPI() {
    if (this.isManifestV3()) {
      return this.createScriptingAPI();
    } else {
      // For Manifest V2, return tabs API methods
      const tabsAPI = this.createTabsAPI();
      return {
        executeScript: tabsAPI.executeScript,
        insertCSS: tabsAPI.insertCSS,
        removeCSS: tabsAPI.removeCSS,
      };
    }
  }
}

// Create default polyfill manager instance
export const polyfill = new PolyfillManager();

// Initialize polyfill
polyfill.initialize();

// Export convenience functions
export const getBrowserAPI = () => polyfill.getAPI();
export const isFirefox = () => polyfill.isFirefox();
export const isChrome = () => polyfill.isChrome();
export const getBrowserName = () => polyfill.getBrowserName();
export const getManifestVersion = () => polyfill.getManifestVersion();
export const isManifestV3 = () => polyfill.isManifestV3();
export const getExtensionId = () => polyfill.getExtensionId();
export const getExtensionURL = (path) => polyfill.getExtensionURL(path);
export const isDevelopmentMode = () => polyfill.isDevelopmentMode();
export const getExtensionVersion = () => polyfill.getExtensionVersion();
export const isAPIAvailable = (apiName) => polyfill.isAPIAvailable(apiName);

// Export API factories
export const createStorageAPI = () => polyfill.createStorageAPI();
export const createRuntimeAPI = () => polyfill.createRuntimeAPI();
export const createTabsAPI = () => polyfill.createTabsAPI();
export const createWindowsAPI = () => polyfill.createWindowsAPI();
export const createScriptingAPI = () => polyfill.getScriptingAPI();
export const createActionAPI = () => polyfill.getActionAPI();
