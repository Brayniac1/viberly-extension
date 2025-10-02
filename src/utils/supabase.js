/**
 * Supabase client utility for Viberly Extension
 * Provides cross-browser compatible Supabase client initialization and management
 */

import { SUPABASE_CONFIG } from "../constants.js";
import { supabaseStorage } from "./storage.js";
import { logger } from "./logger.js";

/**
 * Supabase client manager
 */
export class SupabaseManager {
  constructor() {
    this.client = null;
    this.isInitialized = false;
  }

  /**
   * Initialize Supabase client
   * @param {Object} config - Supabase configuration
   * @returns {Object} Supabase client
   */
  initialize(config = SUPABASE_CONFIG) {
    try {
      // Check if Supabase is available
      if (typeof supabase === "undefined") {
        throw new Error("Supabase library not loaded");
      }

      this.client = supabase.createClient(config.url, config.anonKey, {
        auth: {
          storage: supabaseStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
        global: { fetch },
      });

      this.isInitialized = true;
      logger.debug("Supabase client initialized");

      return this.client;
    } catch (error) {
      logger.error("Failed to initialize Supabase client:", error);
      throw error;
    }
  }

  /**
   * Get Supabase client instance
   * @returns {Object} Supabase client
   */
  getClient() {
    if (!this.isInitialized) {
      this.initialize();
    }
    return this.client;
  }

  /**
   * Check if client is initialized
   * @returns {boolean} Whether client is initialized
   */
  isClientInitialized() {
    return this.isInitialized && this.client !== null;
  }

  /**
   * Get current session
   * @returns {Promise<Object|null>} Current session or null
   */
  async getSession() {
    try {
      if (!this.isClientInitialized()) {
        throw new Error("Supabase client not initialized");
      }

      const {
        data: { session },
        error,
      } = await this.client.auth.getSession();

      if (error) {
        logger.error("Failed to get session:", error);
        return null;
      }

      return session;
    } catch (error) {
      logger.error("Get session error:", error);
      return null;
    }
  }

  /**
   * Get current user
   * @returns {Promise<Object|null>} Current user or null
   */
  async getUser() {
    try {
      if (!this.isClientInitialized()) {
        throw new Error("Supabase client not initialized");
      }

      const {
        data: { user },
        error,
      } = await this.client.auth.getUser();

      if (error) {
        logger.error("Failed to get user:", error);
        return null;
      }

      return user;
    } catch (error) {
      logger.error("Get user error:", error);
      return null;
    }
  }

  /**
   * Sign in with email and password
   * @param {string} email - User email
   * @param {string} password - User password
   * @returns {Promise<Object>} Sign in result
   */
  async signInWithPassword(email, password) {
    try {
      if (!this.isClientInitialized()) {
        throw new Error("Supabase client not initialized");
      }

      const { data, error } = await this.client.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        logger.error("Sign in error:", error);
        return { success: false, error: error.message };
      }

      logger.info("User signed in successfully");
      return { success: true, data };
    } catch (error) {
      logger.error("Sign in error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Sign in with OTP (magic link)
   * @param {string} email - User email
   * @param {Object} options - OTP options
   * @returns {Promise<Object>} OTP result
   */
  async signInWithOtp(email, options = {}) {
    try {
      if (!this.isClientInitialized()) {
        throw new Error("Supabase client not initialized");
      }

      const { data, error } = await this.client.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: "https://viberly.ai/extension-bridge",
          ...options,
        },
      });

      if (error) {
        logger.error("OTP sign in error:", error);
        return { success: false, error: error.message };
      }

      logger.info("OTP sent successfully");
      return { success: true, data };
    } catch (error) {
      logger.error("OTP sign in error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Reset password for email
   * @param {string} email - User email
   * @param {Object} options - Reset options
   * @returns {Promise<Object>} Reset result
   */
  async resetPasswordForEmail(email, options = {}) {
    try {
      if (!this.isClientInitialized()) {
        throw new Error("Supabase client not initialized");
      }

      const { data, error } = await this.client.auth.resetPasswordForEmail(
        email,
        {
          redirectTo: "https://viberly.ai/reset-password",
          ...options,
        }
      );

      if (error) {
        logger.error("Password reset error:", error);
        return { success: false, error: error.message };
      }

      logger.info("Password reset email sent successfully");
      return { success: true, data };
    } catch (error) {
      logger.error("Password reset error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Sign out current user
   * @returns {Promise<Object>} Sign out result
   */
  async signOut() {
    try {
      if (!this.isClientInitialized()) {
        throw new Error("Supabase client not initialized");
      }

      const { error } = await this.client.auth.signOut();

      if (error) {
        logger.error("Sign out error:", error);
        return { success: false, error: error.message };
      }

      logger.info("User signed out successfully");
      return { success: true };
    } catch (error) {
      logger.error("Sign out error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Set session from tokens
   * @param {Object} session - Session object with tokens
   * @returns {Promise<Object>} Set session result
   */
  async setSession(session) {
    try {
      if (!this.isClientInitialized()) {
        throw new Error("Supabase client not initialized");
      }

      const { data, error } = await this.client.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });

      if (error) {
        logger.error("Set session error:", error);
        return { success: false, error: error.message };
      }

      logger.debug("Session set successfully");
      return { success: true, data };
    } catch (error) {
      logger.error("Set session error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Add auth state change listener
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  onAuthStateChange(callback) {
    try {
      if (!this.isClientInitialized()) {
        throw new Error("Supabase client not initialized");
      }

      const {
        data: { subscription },
      } = this.client.auth.onAuthStateChange(callback);

      return () => {
        subscription?.unsubscribe();
      };
    } catch (error) {
      logger.error("Auth state change listener error:", error);
      return () => {};
    }
  }

  /**
   * Get database client
   * @returns {Object} Database client
   */
  getDatabase() {
    if (!this.isClientInitialized()) {
      throw new Error("Supabase client not initialized");
    }
    return this.client;
  }

  /**
   * Query profiles table
   * @param {Object} filters - Query filters
   * @returns {Promise<Object>} Query result
   */
  async queryProfiles(filters = {}) {
    try {
      if (!this.isClientInitialized()) {
        throw new Error("Supabase client not initialized");
      }

      let query = this.client.from("vg_profiles").select("*");

      if (filters.user_id) {
        query = query.eq("user_id", filters.user_id);
      }

      if (filters.team_id) {
        query = query.eq("team_id", filters.team_id);
      }

      const { data, error } = await query;

      if (error) {
        logger.error("Query profiles error:", error);
        return { success: false, error: error.message };
      }

      return { success: true, data };
    } catch (error) {
      logger.error("Query profiles error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Query teams table
   * @param {Object} filters - Query filters
   * @returns {Promise<Object>} Query result
   */
  async queryTeams(filters = {}) {
    try {
      if (!this.isClientInitialized()) {
        throw new Error("Supabase client not initialized");
      }

      let query = this.client.from("teams").select("*");

      if (filters.id) {
        query = query.eq("id", filters.id);
      }

      if (filters.admin_user_id) {
        query = query.eq("admin_user_id", filters.admin_user_id);
      }

      const { data, error } = await query;

      if (error) {
        logger.error("Query teams error:", error);
        return { success: false, error: error.message };
      }

      return { success: true, data };
    } catch (error) {
      logger.error("Query teams error:", error);
      return { success: false, error: error.message };
    }
  }
}

// Create default Supabase manager instance
export const supabaseManager = new SupabaseManager();

// Initialize client
export const supabaseClient = supabaseManager.initialize();

// Export convenience functions
export const getSupabaseClient = () => supabaseManager.getClient();
export const getSession = () => supabaseManager.getSession();
export const getUser = () => supabaseManager.getUser();
export const signInWithPassword = (email, password) =>
  supabaseManager.signInWithPassword(email, password);
export const signInWithOtp = (email, options) =>
  supabaseManager.signInWithOtp(email, options);
export const resetPasswordForEmail = (email, options) =>
  supabaseManager.resetPasswordForEmail(email, options);
export const signOut = () => supabaseManager.signOut();
export const setSession = (session) => supabaseManager.setSession(session);
export const onAuthStateChange = (callback) =>
  supabaseManager.onAuthStateChange(callback);
