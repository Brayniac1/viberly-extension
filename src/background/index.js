/**
 * Viberly Extension Background Script (Service Worker)
 * Main entry point for the background context
 */

import { logger, supabaseClient } from "../utils/index.js";
import { accessControl } from "./access-control.js";
import { backgroundSessionManager } from "./session-manager.js";
import { messageHandler } from "./message-handler.js";

/**
 * Background script manager
 */
class BackgroundManager {
  constructor() {
    this.isInitialized = false;
  }

  /**
   * Initialize background script
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized) return;

    try {
      logger.info("Initializing Viberly background script");

      // Initialize session manager
      await backgroundSessionManager.initialize();

      // Initialize message handler
      await messageHandler.initialize();

      // Set up extension lifecycle listeners
      this.setupLifecycleListeners();

      // Set up tab listeners
      this.setupTabListeners();

      // Set up command listeners
      this.setupCommandListeners();

      this.isInitialized = true;
      logger.info("Background script initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize background script:", error);
    }
  }

  /**
   * Set up extension lifecycle listeners
   */
  setupLifecycleListeners() {
    try {
      // Handle extension installation
      chrome.runtime.onInstalled.addListener((details) => {
        this.handleInstallation(details);
      });

      // Handle extension startup
      chrome.runtime.onStartup.addListener(() => {
        this.handleStartup();
      });

      // Handle extension suspend (Manifest V3)
      if (chrome.runtime.onSuspend) {
        chrome.runtime.onSuspend.addListener(() => {
          this.handleSuspend();
        });
      }
    } catch (error) {
      logger.error("Failed to setup lifecycle listeners:", error);
    }
  }

  /**
   * Set up tab listeners
   */
  setupTabListeners() {
    try {
      // Handle tab updates
      chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        this.handleTabUpdate(tabId, changeInfo, tab);
      });

      // Handle tab activation
      chrome.tabs.onActivated.addListener((activeInfo) => {
        this.handleTabActivation(activeInfo);
      });

      // Handle tab removal
      chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
        this.handleTabRemoval(tabId, removeInfo);
      });
    } catch (error) {
      logger.error("Failed to setup tab listeners:", error);
    }
  }

  /**
   * Set up command listeners
   */
  setupCommandListeners() {
    try {
      chrome.commands.onCommand.addListener((command) => {
        this.handleCommand(command);
      });
    } catch (error) {
      logger.error("Failed to setup command listeners:", error);
    }
  }

  /**
   * Handle extension installation
   * @param {Object} details - Installation details
   */
  async handleInstallation(details) {
    try {
      logger.info("Extension installed:", details.reason);

      if (details.reason === "install") {
        // First time installation
        await this.handleFirstInstall();
      } else if (details.reason === "update") {
        // Extension update
        await this.handleUpdate(details.previousVersion);
      }
    } catch (error) {
      logger.error("Installation handler error:", error);
    }
  }

  /**
   * Handle first installation
   * @returns {Promise<void>}
   */
  async handleFirstInstall() {
    try {
      logger.info("First time installation - setting up defaults");

      // Set default settings
      await chrome.storage.local.set({
        VG_LOG_LEVEL: "error",
        vg_settings: {
          debug: false,
          screenshot_enabled: true,
        },
      });

      // Open welcome page
      try {
        await chrome.tabs.create({
          url: "https://viberly.ai/welcome",
          active: true,
        });
      } catch (error) {
        logger.warn("Failed to open welcome page:", error);
      }
    } catch (error) {
      logger.error("First install handler error:", error);
    }
  }

  /**
   * Handle extension update
   * @param {string} previousVersion - Previous version
   * @returns {Promise<void>}
   */
  async handleUpdate(previousVersion) {
    try {
      logger.info("Extension updated from", previousVersion);

      // Perform any necessary migration
      await this.performMigration(previousVersion);
    } catch (error) {
      logger.error("Update handler error:", error);
    }
  }

  /**
   * Perform data migration
   * @param {string} previousVersion - Previous version
   * @returns {Promise<void>}
   */
  async performMigration(previousVersion) {
    try {
      // Add migration logic here based on version
      logger.debug("Performing migration from version:", previousVersion);

      // Example: Migrate old storage keys
      const allData = await chrome.storage.local.get();
      const migrationNeeded = Object.keys(allData).some((key) =>
        key.startsWith("old_")
      );

      if (migrationNeeded) {
        logger.info("Performing storage migration");
        // Add migration logic here
      }
    } catch (error) {
      logger.error("Migration error:", error);
    }
  }

  /**
   * Handle extension startup
   */
  async handleStartup() {
    try {
      logger.info("Extension startup");

      // Reinitialize session manager
      await backgroundSessionManager.initialize();
    } catch (error) {
      logger.error("Startup handler error:", error);
    }
  }

  /**
   * Handle extension suspend
   */
  handleSuspend() {
    try {
      logger.info("Extension suspending");

      // Clean up resources
      this.cleanup();
    } catch (error) {
      logger.error("Suspend handler error:", error);
    }
  }

  /**
   * Handle tab update
   * @param {number} tabId - Tab ID
   * @param {Object} changeInfo - Change information
   * @param {Object} tab - Tab object
   */
  async handleTabUpdate(tabId, changeInfo, tab) {
    try {
      // Only process when tab is complete
      if (changeInfo.status !== "complete") return;

      // Check if tab URL is supported
      if (!this.isUrlSupported(tab.url)) return;

      // Inject content scripts if needed
      await this.ensureContentScripts(tabId);
    } catch (error) {
      logger.error("Tab update handler error:", error);
    }
  }

  /**
   * Handle tab activation
   * @param {Object} activeInfo - Active tab information
   */
  async handleTabActivation(activeInfo) {
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);

      // Check if tab URL is supported
      if (!this.isUrlSupported(tab.url)) return;

      // Ensure content scripts are injected
      await this.ensureContentScripts(activeInfo.tabId);
    } catch (error) {
      logger.error("Tab activation handler error:", error);
    }
  }

  /**
   * Handle tab removal
   * @param {number} tabId - Tab ID
   * @param {Object} removeInfo - Removal information
   */
  handleTabRemoval(tabId, removeInfo) {
    try {
      logger.debug("Tab removed:", tabId);
      // Clean up any tab-specific resources
    } catch (error) {
      logger.error("Tab removal handler error:", error);
    }
  }

  /**
   * Handle command execution
   * @param {string} command - Command name
   */
  async handleCommand(command) {
    try {
      logger.info("Command executed:", command);

      switch (command) {
        case "open-marketplace":
          await this.openMarketplace();
          break;
        case "capture-screenshot":
          await this.captureScreenshot();
          break;
        default:
          logger.warn("Unknown command:", command);
      }
    } catch (error) {
      logger.error("Command handler error:", error);
    }
  }

  /**
   * Open marketplace
   * @returns {Promise<void>}
   */
  async openMarketplace() {
    try {
      await chrome.tabs.create({
        url: "https://viberly.ai/marketplace",
        active: true,
      });
    } catch (error) {
      logger.error("Failed to open marketplace:", error);
    }
  }

  /**
   * Capture screenshot
   * @returns {Promise<void>}
   */
  async captureScreenshot() {
    try {
      // Get active tab
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs.length === 0) return;

      // Send screenshot begin message to content script
      await chrome.tabs.sendMessage(tabs[0].id, {
        type: "VG_SCREENSHOT_BEGIN",
      });
    } catch (error) {
      logger.error("Failed to capture screenshot:", error);
    }
  }

  /**
   * Check if URL is supported
   * @param {string} url - URL to check
   * @returns {boolean} Whether URL is supported
   */
  isUrlSupported(url) {
    if (!url) return false;

    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();

      // Check against allowed URLs (simplified check)
      const allowedPatterns = [
        "lovable.dev",
        "replit.com",
        "bolt.new",
        "chatgpt.com",
        "claude.ai",
        "gemini.google.com",
        "perplexity.ai",
        "canva.com",
        "figma.com",
      ];

      return allowedPatterns.some(
        (pattern) =>
          hostname.includes(pattern) || hostname.endsWith(`.${pattern}`)
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * Ensure content scripts are injected
   * @param {number} tabId - Tab ID
   * @returns {Promise<void>}
   */
  async ensureContentScripts(tabId) {
    try {
      // Check if content script is already injected
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => !!window.__VG_CONTENT_SCRIPT_LOADED__,
      });

      if (results[0]?.result) {
        return; // Already injected
      }

      // Inject content scripts
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [
          "src/boot.js",
          "src/ui/savehighlight.js",
          "src/ui/enhancehighlight.js",
          "src/ui/hud.js",
          "src/usage/counter.js",
        ],
      });

      logger.debug("Content scripts injected for tab:", tabId);
    } catch (error) {
      logger.error("Failed to inject content scripts:", error);
    }
  }

  /**
   * Clean up resources
   */
  cleanup() {
    try {
      // Clean up any timers, intervals, or other resources
      logger.debug("Cleaning up resources");
    } catch (error) {
      logger.error("Cleanup error:", error);
    }
  }
}

// Create and initialize background manager
const backgroundManager = new BackgroundManager();

// Initialize when script loads
backgroundManager.initialize().catch((error) => {
  logger.error("Failed to initialize background manager:", error);
});

// Export for testing
export { backgroundManager };
