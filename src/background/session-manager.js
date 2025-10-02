/**
 * Session Manager Module for Viberly Extension Background
 * Handles user session management, authentication state, and session persistence
 */

import { STORAGE_KEYS, MESSAGE_TYPES } from "../constants.js";
import {
  logger,
  storage,
  sessionManager,
  supabaseClient,
} from "../utils/index.js";

/**
 * Session manager for handling user authentication and session state
 */
export class BackgroundSessionManager {
  constructor() {
    this.currentSession = null;
    this.isInitialized = false;
  }

  /**
   * Initialize session manager
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized) return;

    try {
      // Load existing session from storage
      this.currentSession = await sessionManager.getSession();

      // Set up auth state change listener
      this.setupAuthStateListener();

      this.isInitialized = true;
      logger.debug("Session manager initialized");
    } catch (error) {
      logger.error("Failed to initialize session manager:", error);
    }
  }

  /**
   * Set up Supabase auth state change listener
   */
  setupAuthStateListener() {
    try {
      supabaseClient.auth.onAuthStateChange(async (event, session) => {
        logger.debug("Auth state changed:", event, !!session);

        if (event === "SIGNED_IN" && session) {
          await this.handleSignIn(session);
        } else if (event === "SIGNED_OUT") {
          await this.handleSignOut();
        } else if (event === "TOKEN_REFRESHED" && session) {
          await this.handleTokenRefresh(session);
        }
      });
    } catch (error) {
      logger.error("Failed to setup auth state listener:", error);
    }
  }

  /**
   * Handle user sign in
   * @param {Object} session - User session
   * @returns {Promise<void>}
   */
  async handleSignIn(session) {
    try {
      if (!sessionManager.isValidSession(session)) {
        logger.warn("Invalid session received during sign in");
        return;
      }

      this.currentSession = session;
      await sessionManager.saveSession(session);

      // Broadcast auth status change
      await this.broadcastAuthStatus(true, session);

      logger.info("User signed in successfully");
    } catch (error) {
      logger.error("Failed to handle sign in:", error);
    }
  }

  /**
   * Handle user sign out
   * @returns {Promise<void>}
   */
  async handleSignOut() {
    try {
      this.currentSession = null;
      await sessionManager.clearSession();

      // Clear all Supabase-related storage
      await this.clearSupabaseStorage();

      // Broadcast auth status change
      await this.broadcastAuthStatus(false, null);

      logger.info("User signed out successfully");
    } catch (error) {
      logger.error("Failed to handle sign out:", error);
    }
  }

  /**
   * Handle token refresh
   * @param {Object} session - Refreshed session
   * @returns {Promise<void>}
   */
  async handleTokenRefresh(session) {
    try {
      if (!sessionManager.isValidSession(session)) {
        logger.warn("Invalid session received during token refresh");
        return;
      }

      this.currentSession = session;
      await sessionManager.saveSession(session);

      logger.debug("Session token refreshed");
    } catch (error) {
      logger.error("Failed to handle token refresh:", error);
    }
  }

  /**
   * Clear all Supabase-related storage
   * @returns {Promise<void>}
   */
  async clearSupabaseStorage() {
    try {
      const allData = await storage.getAll();
      const supabaseKeys = Object.keys(allData).filter((key) =>
        key.startsWith("sb-")
      );

      if (supabaseKeys.length > 0) {
        await storage.remove(supabaseKeys);
      }

      // Also remove our session key
      await storage.remove(STORAGE_KEYS.SESSION);
    } catch (error) {
      logger.error("Failed to clear Supabase storage:", error);
    }
  }

  /**
   * Broadcast authentication status to all contexts
   * @param {boolean} signedIn - Whether user is signed in
   * @param {Object|null} session - User session or null
   * @returns {Promise<void>}
   */
  async broadcastAuthStatus(signedIn, session) {
    try {
      const message = {
        type: MESSAGE_TYPES.AUTH_STATUS_PUSH,
        signedIn,
        session: session
          ? {
              access_token: session.access_token,
              refresh_token: session.refresh_token,
              expires_at: session.expires_at,
              user: session.user,
            }
          : null,
      };

      // Send to all tabs
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        try {
          await chrome.tabs.sendMessage(tab.id, message);
        } catch (error) {
          // Ignore errors for tabs that don't have our content script
        }
      }

      logger.debug("Auth status broadcasted to all tabs");
    } catch (error) {
      logger.error("Failed to broadcast auth status:", error);
    }
  }

  /**
   * Handle set session request
   * @param {Object} message - Message data
   * @param {Object} sender - Message sender
   * @param {Function} sendResponse - Response callback
   * @returns {Promise<boolean>} Whether to keep message channel open
   */
  async handleSetSession(message, sender, sendResponse) {
    try {
      const { access_token, refresh_token, expires_at, userId, email } =
        message;

      if (!access_token || !refresh_token || !expires_at) {
        sendResponse({ ok: false, error: "Missing required session data" });
        return false;
      }

      const session = {
        access_token,
        refresh_token,
        expires_at: Number(expires_at),
        user: {
          id: userId,
          email: email,
        },
      };

      // Set session in Supabase client
      const { data, error } = await supabaseClient.auth.setSession({
        access_token,
        refresh_token,
      });

      if (error) {
        logger.error("Failed to set Supabase session:", error);
        sendResponse({ ok: false, error: error.message });
        return false;
      }

      // Save to storage
      this.currentSession = data.session;
      await sessionManager.saveSession(data.session);

      // Broadcast auth status
      await this.broadcastAuthStatus(true, data.session);

      sendResponse({ ok: true });
      return false;
    } catch (error) {
      logger.error("Set session error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  /**
   * Handle sign out request
   * @param {Object} message - Message data
   * @param {Object} sender - Message sender
   * @param {Function} sendResponse - Response callback
   * @returns {Promise<boolean>} Whether to keep message channel open
   */
  async handleSignOut(message, sender, sendResponse) {
    try {
      await supabaseClient.auth.signOut();
      sendResponse({ ok: true });
      return false;
    } catch (error) {
      logger.error("Sign out error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  /**
   * Handle auth status request
   * @param {Object} message - Message data
   * @param {Object} sender - Message sender
   * @param {Function} sendResponse - Response callback
   * @returns {Promise<boolean>} Whether to keep message channel open
   */
  async handleAuthStatus(message, sender, sendResponse) {
    try {
      const isSignedIn =
        !!this.currentSession &&
        sessionManager.isValidSession(this.currentSession);

      sendResponse({
        ok: true,
        signedIn: isSignedIn,
        session: isSignedIn ? this.currentSession : null,
      });

      return false;
    } catch (error) {
      logger.error("Auth status error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  /**
   * Handle auth redirect request
   * @param {Object} message - Message data
   * @param {Object} sender - Message sender
   * @param {Function} sendResponse - Response callback
   * @returns {Promise<boolean>} Whether to keep message channel open
   */
  async handleAuthRedirect(message, sender, sendResponse) {
    try {
      const { url, redirectTo } = message;

      if (!url) {
        sendResponse({ ok: false, error: "URL is required" });
        return false;
      }

      // Open the URL in a new tab
      await chrome.tabs.create({ url, active: true });

      // If redirectTo is provided, store it for later use
      if (redirectTo) {
        await storage.set({ [STORAGE_KEYS.POST_BRIDGE_REDIRECT]: redirectTo });
      }

      sendResponse({ ok: true });
      return false;
    } catch (error) {
      logger.error("Auth redirect error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  /**
   * Handle auth reset password request
   * @param {Object} message - Message data
   * @param {Object} sender - Message sender
   * @param {Function} sendResponse - Response callback
   * @returns {Promise<boolean>} Whether to keep message channel open
   */
  async handleAuthResetPassword(message, sender, sendResponse) {
    try {
      const { email, redirectTo } = message;

      if (!email) {
        sendResponse({ ok: false, error: "Email is required" });
        return false;
      }

      const { data, error } = await supabaseClient.auth.resetPasswordForEmail(
        email,
        {
          redirectTo: redirectTo || "https://viberly.ai/reset-password",
        }
      );

      if (error) {
        logger.error("Password reset error:", error);
        sendResponse({ ok: false, error: error.message });
        return false;
      }

      sendResponse({ ok: true });
      return false;
    } catch (error) {
      logger.error("Auth reset password error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  /**
   * Get current session
   * @returns {Object|null} Current session or null
   */
  getCurrentSession() {
    return this.currentSession;
  }

  /**
   * Check if user is signed in
   * @returns {boolean} Whether user is signed in
   */
  isSignedIn() {
    return (
      !!this.currentSession &&
      sessionManager.isValidSession(this.currentSession)
    );
  }

  /**
   * Check if session is expired
   * @returns {boolean} Whether session is expired
   */
  isSessionExpired() {
    if (!this.currentSession) return true;
    return sessionManager.isSessionExpired(this.currentSession);
  }
}

// Create default session manager instance
export const backgroundSessionManager = new BackgroundSessionManager();
