/**
 * Storage utility for Viberly Extension
 * Provides cross-browser compatible storage operations
 */

import { STORAGE_KEYS } from "../constants.js";
import { logger } from "./logger.js";

/**
 * Storage utility class for Chrome extension storage
 */
export class StorageManager {
  constructor() {
    this.storage = this.getStorageAPI();
  }

  /**
   * Get the appropriate storage API based on browser
   * @returns {Object} Storage API object
   */
  getStorageAPI() {
    // Use browser namespace if available (Firefox), otherwise chrome
    const api = typeof browser !== "undefined" ? browser : chrome;

    if (!api?.storage?.local) {
      throw new Error("Storage API not available");
    }

    return api.storage.local;
  }

  /**
   * Get a value from storage
   * @param {string|string[]} keys - Key(s) to retrieve
   * @returns {Promise<any>} Retrieved value(s)
   */
  async get(keys) {
    try {
      return await new Promise((resolve, reject) => {
        this.storage.get(keys, (result) => {
          if (chrome.runtime?.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(result);
          }
        });
      });
    } catch (error) {
      logger.error("Storage get error:", error);
      throw error;
    }
  }

  /**
   * Set a value in storage
   * @param {Object} items - Key-value pairs to store
   * @returns {Promise<void>}
   */
  async set(items) {
    try {
      return await new Promise((resolve, reject) => {
        this.storage.set(items, () => {
          if (chrome.runtime?.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      logger.error("Storage set error:", error);
      throw error;
    }
  }

  /**
   * Remove keys from storage
   * @param {string|string[]} keys - Key(s) to remove
   * @returns {Promise<void>}
   */
  async remove(keys) {
    try {
      return await new Promise((resolve, reject) => {
        this.storage.remove(keys, () => {
          if (chrome.runtime?.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      logger.error("Storage remove error:", error);
      throw error;
    }
  }

  /**
   * Clear all storage
   * @returns {Promise<void>}
   */
  async clear() {
    try {
      return await new Promise((resolve, reject) => {
        this.storage.clear(() => {
          if (chrome.runtime?.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      logger.error("Storage clear error:", error);
      throw error;
    }
  }

  /**
   * Get all storage items
   * @returns {Promise<Object>} All storage items
   */
  async getAll() {
    try {
      return await this.get(null);
    } catch (error) {
      logger.error("Storage getAll error:", error);
      throw error;
    }
  }

  /**
   * Add a storage change listener
   * @param {Function} callback - Callback function for storage changes
   * @returns {Function} Unsubscribe function
   */
  addChangeListener(callback) {
    const listener = (changes, area) => {
      if (area === "local") {
        callback(changes, area);
      }
    };

    chrome.storage.onChanged.addListener(listener);

    // Return unsubscribe function
    return () => {
      chrome.storage.onChanged.removeListener(listener);
    };
  }
}

// Create default storage manager instance
export const storage = new StorageManager();

/**
 * Supabase-compatible storage adapter
 * Converts Chrome storage to Supabase storage interface
 */
export const supabaseStorage = {
  getItem: async (key) => {
    try {
      const result = await storage.get(key);
      return result?.[key] ?? null;
    } catch (error) {
      logger.error("Supabase storage getItem error:", error);
      return null;
    }
  },

  setItem: async (key, value) => {
    try {
      await storage.set({ [key]: value });
    } catch (error) {
      logger.error("Supabase storage setItem error:", error);
      throw error;
    }
  },

  removeItem: async (key) => {
    try {
      await storage.remove(key);
    } catch (error) {
      logger.error("Supabase storage removeItem error:", error);
      throw error;
    }
  },
};

/**
 * Session management utilities
 */
export class SessionManager {
  constructor() {
    this.storage = storage;
  }

  /**
   * Save session to storage
   * @param {Object} session - Session object
   * @returns {Promise<void>}
   */
  async saveSession(session) {
    try {
      await this.storage.set({ [STORAGE_KEYS.SESSION]: session });
      logger.debug("Session saved to storage");
    } catch (error) {
      logger.error("Failed to save session:", error);
      throw error;
    }
  }

  /**
   * Get session from storage
   * @returns {Promise<Object|null>} Session object or null
   */
  async getSession() {
    try {
      const result = await this.storage.get(STORAGE_KEYS.SESSION);
      return result?.[STORAGE_KEYS.SESSION] || null;
    } catch (error) {
      logger.error("Failed to get session:", error);
      return null;
    }
  }

  /**
   * Clear session from storage
   * @returns {Promise<void>}
   */
  async clearSession() {
    try {
      await this.storage.remove(STORAGE_KEYS.SESSION);
      logger.debug("Session cleared from storage");
    } catch (error) {
      logger.error("Failed to clear session:", error);
      throw error;
    }
  }

  /**
   * Check if session is valid
   * @param {Object} session - Session object to validate
   * @returns {boolean} Whether session is valid
   */
  isValidSession(session) {
    if (!session) return false;

    const hasAccessToken = !!session.access_token;
    const hasRefreshToken = !!session.refresh_token;
    const hasExpiry = Number.isFinite(session.expires_at);

    return hasAccessToken && hasRefreshToken && hasExpiry;
  }

  /**
   * Check if session is expired
   * @param {Object} session - Session object to check
   * @returns {boolean} Whether session is expired
   */
  isSessionExpired(session) {
    if (!this.isValidSession(session)) return true;

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = session.expires_at;

    return now >= expiresAt;
  }
}

// Create default session manager instance
export const sessionManager = new SessionManager();
