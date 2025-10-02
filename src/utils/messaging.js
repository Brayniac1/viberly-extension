/**
 * Messaging utility for Viberly Extension
 * Provides cross-browser compatible messaging between extension contexts
 */

import { MESSAGE_TYPES } from "../constants.js";
import { logger } from "./logger.js";

/**
 * Messaging utility class for extension communication
 */
export class MessagingManager {
  constructor() {
    this.runtime = this.getRuntimeAPI();
    this.listeners = new Map();
  }

  /**
   * Get the appropriate runtime API based on browser
   * @returns {Object} Runtime API object
   */
  getRuntimeAPI() {
    // Use browser namespace if available (Firefox), otherwise chrome
    const api = typeof browser !== "undefined" ? browser : chrome;

    if (!api?.runtime) {
      throw new Error("Runtime API not available");
    }

    return api.runtime;
  }

  /**
   * Send a message to the background script
   * @param {Object} message - Message object to send
   * @param {Object} options - Send options
   * @returns {Promise<any>} Response from background script
   */
  async sendMessage(message, options = {}) {
    try {
      return await new Promise((resolve, reject) => {
        const timeout = options.timeout || 5000;

        const timeoutId = setTimeout(() => {
          reject(new Error("Message timeout"));
        }, timeout);

        this.runtime.sendMessage(message, (response) => {
          clearTimeout(timeoutId);

          if (chrome.runtime?.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
    } catch (error) {
      logger.error("Send message error:", error);
      throw error;
    }
  }

  /**
   * Send a message to a specific tab
   * @param {number} tabId - Target tab ID
   * @param {Object} message - Message object to send
   * @param {Object} options - Send options
   * @returns {Promise<any>} Response from tab
   */
  async sendMessageToTab(tabId, message, options = {}) {
    try {
      return await new Promise((resolve, reject) => {
        const timeout = options.timeout || 5000;

        const timeoutId = setTimeout(() => {
          reject(new Error("Message timeout"));
        }, timeout);

        this.runtime.sendMessage(tabId, message, (response) => {
          clearTimeout(timeoutId);

          if (chrome.runtime?.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
    } catch (error) {
      logger.error("Send message to tab error:", error);
      throw error;
    }
  }

  /**
   * Add a message listener
   * @param {Function} callback - Callback function for messages
   * @param {Object} filter - Optional message filter
   * @returns {Function} Unsubscribe function
   */
  addListener(callback, filter = null) {
    const listener = (message, sender, sendResponse) => {
      // Apply filter if provided
      if (filter && !this.matchesFilter(message, filter)) {
        return false;
      }

      try {
        const result = callback(message, sender, sendResponse);

        // Handle async responses
        if (result instanceof Promise) {
          result
            .then((response) => {
              if (sendResponse) {
                sendResponse(response);
              }
            })
            .catch((error) => {
              logger.error("Message handler error:", error);
              if (sendResponse) {
                sendResponse({ error: error.message });
              }
            });
          return true; // Indicate async response
        }

        return result;
      } catch (error) {
        logger.error("Message listener error:", error);
        if (sendResponse) {
          sendResponse({ error: error.message });
        }
        return false;
      }
    };

    this.runtime.onMessage.addListener(listener);

    // Store listener for cleanup
    const listenerId = Date.now() + Math.random();
    this.listeners.set(listenerId, listener);

    // Return unsubscribe function
    return () => {
      this.runtime.onMessage.removeListener(listener);
      this.listeners.delete(listenerId);
    };
  }

  /**
   * Check if message matches filter
   * @param {Object} message - Message to check
   * @param {Object} filter - Filter criteria
   * @returns {boolean} Whether message matches filter
   */
  matchesFilter(message, filter) {
    if (!filter) return true;

    // Check message type
    if (filter.type && message.type !== filter.type) {
      return false;
    }

    // Check sender tab ID
    if (filter.tabId && message.sender?.tab?.id !== filter.tabId) {
      return false;
    }

    // Check sender frame ID
    if (filter.frameId && message.sender?.frameId !== filter.frameId) {
      return false;
    }

    return true;
  }

  /**
   * Remove all listeners
   */
  removeAllListeners() {
    this.listeners.forEach((listener) => {
      this.runtime.onMessage.removeListener(listener);
    });
    this.listeners.clear();
  }

  /**
   * Get extension ID
   * @returns {string} Extension ID
   */
  getExtensionId() {
    return this.runtime.id;
  }

  /**
   * Get extension URL
   * @param {string} path - Path to append to extension URL
   * @returns {string} Full extension URL
   */
  getExtensionURL(path = "") {
    return this.runtime.getURL(path);
  }
}

// Create default messaging manager instance
export const messaging = new MessagingManager();

/**
 * Message type constants for easy access
 */
export const MessageTypes = MESSAGE_TYPES;

/**
 * Utility functions for common message patterns
 */
export const MessageUtils = {
  /**
   * Send authentication status update
   * @param {boolean} signedIn - Whether user is signed in
   * @param {Object} session - Session data
   * @returns {Promise<any>} Response
   */
  async sendAuthStatus(signedIn, session = null) {
    return messaging.sendMessage({
      type: MESSAGE_TYPES.AUTH_STATUS_PUSH,
      signedIn,
      session,
    });
  },

  /**
   * Send session data to background
   * @param {Object} session - Session data
   * @returns {Promise<any>} Response
   */
  async sendSession(session) {
    return messaging.sendMessage({
      type: MESSAGE_TYPES.SET_SESSION,
      ...session,
    });
  },

  /**
   * Request access status
   * @returns {Promise<any>} Access status response
   */
  async getAccessStatus() {
    return messaging.sendMessage({
      type: MESSAGE_TYPES.ACCESS_STATUS,
    });
  },

  /**
   * Request account summary
   * @returns {Promise<any>} Account summary response
   */
  async getAccountSummary() {
    return messaging.sendMessage({
      type: MESSAGE_TYPES.VG_ACCOUNT_SUMMARY,
    });
  },

  /**
   * Send sign out request
   * @returns {Promise<any>} Response
   */
  async signOut() {
    return messaging.sendMessage({
      type: MESSAGE_TYPES.SIGN_OUT,
    });
  },

  /**
   * Send pill click event
   * @returns {Promise<any>} Response
   */
  async sendPillClick() {
    return messaging.sendMessage({
      type: MESSAGE_TYPES.PILL_CLICK,
    });
  },

  /**
   * Send screenshot begin event
   * @returns {Promise<any>} Response
   */
  async sendScreenshotBegin() {
    return messaging.sendMessage({
      type: MESSAGE_TYPES.VG_SCREENSHOT_BEGIN,
    });
  },

  /**
   * Send screenshot captured event
   * @param {Object} data - Screenshot data
   * @returns {Promise<any>} Response
   */
  async sendScreenshotCaptured(data) {
    return messaging.sendMessage({
      type: MESSAGE_TYPES.VG_SCREENSHOT_CAPTURED,
      data,
    });
  },
};
