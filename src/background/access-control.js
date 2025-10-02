/**
 * Access Control Module for Viberly Extension Background
 * Handles user access validation, team/individual subscription checks, and access gating
 */

import {
  STORAGE_KEYS,
  MESSAGE_TYPES,
  TEAM_STATUSES,
  INDIVIDUAL_STATUSES,
  ALLOWED_WHEN_BLOCKED,
} from "../constants.js";
import { logger, storage, supabaseClient } from "../utils/index.js";

/**
 * Access control manager for handling user permissions and subscription status
 */
export class AccessControlManager {
  constructor() {
    this.allowedWhenBlocked = new Set(ALLOWED_WHEN_BLOCKED);
    this.allowedTeamStates = new Set([
      TEAM_STATUSES.ACTIVE,
      TEAM_STATUSES.TRIALING,
    ]);
  }

  /**
   * Check if a message type is allowed when access is blocked
   * @param {string} messageType - Message type to check
   * @returns {boolean} Whether message is allowed
   */
  isAllowedWhenBlocked(messageType) {
    return (
      this.allowedWhenBlocked.has(messageType) ||
      String(messageType || "").startsWith("VG_DEBUG:")
    );
  }

  /**
   * Gate message if user access is blocked
   * @param {string} messageType - Type of message being processed
   * @param {Object} sender - Message sender information
   * @returns {Promise<Object|null>} Block result or null if allowed
   */
  async gateIfBlocked(messageType, sender) {
    try {
      // Quick read of the last snapshot
      let snap = await this.getAccessSnapshotCached();

      // For checkout, ALWAYS use a fresh snapshot and only allow when team trial_expired + admin
      if (messageType === MESSAGE_TYPES.TEAM_CHECKOUT_START) {
        snap = await this.computeAccessSnapshot();
        const isTeam = snap?.team === true;
        const status = String(snap?.team_status || "");
        const isAdmin = snap?.admin_is_me === true;

        if (isTeam && status === TEAM_STATUSES.TRIAL_EXPIRED && isAdmin) {
          return null; // Allow checkout
        }

        try {
          await chrome.action.openPopup();
        } catch (_) {}

        return {
          ok: false,
          reason: isTeam ? "TEAM_BLOCKED" : "INDIV_BLOCKED",
        };
      }

      const isBlocked = snap?.blocked === true;
      const isTeam = snap?.team === true;

      if (!isBlocked) return null;

      // Always allow these while blocked (status, auth, debug, etc.)
      if (this.isAllowedWhenBlocked(messageType)) {
        return null;
      }

      // Block: open popup and stop the message
      try {
        await chrome.action.openPopup();
      } catch (_) {}

      return {
        ok: false,
        reason: isTeam ? "TEAM_BLOCKED" : "INDIV_BLOCKED",
      };
    } catch (error) {
      logger.error("Access gate error:", error);
      return null;
    }
  }

  /**
   * Compute and cache access snapshot for the current session user
   * @returns {Promise<Object>} Access snapshot
   */
  async computeAccessSnapshot() {
    const nowIso = new Date().toISOString();

    try {
      const {
        data: { session },
      } = await supabaseClient.auth.getSession();

      if (!session?.user?.id) {
        logger.debug("No session → allow access");
        return this.setAccessSnapshot({
          blocked: false,
          team: null,
          reason: null,
          last_checked: nowIso,
        });
      }

      const uid = session.user.id;

      // 1) Profile → team_id (+ user_type, subscription_status)
      let teamId = null;
      let prof = null;
      const profRes = await supabaseClient
        .from("vg_profiles")
        .select("user_id, team_id, user_type, subscription_status")
        .eq("user_id", uid)
        .single();

      if (profRes?.error) {
        logger.warn("vg_profiles select error:", profRes.error);
      } else {
        prof = profRes.data || null;
        teamId = prof?.team_id || null;
      }

      // Fallback: if profile.team_id missing, treat as admin-owned team
      if (!teamId) {
        const adminTeam = await supabaseClient
          .from("teams")
          .select("id")
          .eq("admin_user_id", uid)
          .limit(1)
          .maybeSingle();

        if (adminTeam?.data?.id) {
          teamId = adminTeam.data.id;
          logger.debug("Fallback admin-owned team found:", teamId);
        }
      }

      // Individual (no team) → compute by individual subscription_status
      if (!teamId) {
        const utype = String(prof?.user_type || "").toLowerCase();
        const ustat = String(prof?.subscription_status || "").toLowerCase();

        if (
          utype === "individual" &&
          (ustat === INDIVIDUAL_STATUSES.PAST_DUE ||
            ustat === INDIVIDUAL_STATUSES.CANCELED)
        ) {
          const redirect = `https://viberly.ai/individual/subscription-expired?status=${ustat}`;
          logger.debug("Individual blocked →", { status: ustat, redirect });

          return this.setAccessSnapshot({
            blocked: true,
            team: false, // NOT a team block
            indiv: true, // helper flag for popup
            indiv_status: ustat,
            indiv_redirect: redirect,
            reason: "individual_subscription_block",
            last_checked: nowIso,
          });
        }

        // Individual allowed
        return this.setAccessSnapshot({
          blocked: false,
          team: false,
          indiv: true,
          reason: null,
          last_checked: nowIso,
        });
      }

      // Team → compute by teams.subscription_status
      const teamRes = await supabaseClient
        .from("teams")
        .select("id, subscription_status, admin_user_id, name")
        .eq("id", teamId)
        .single();

      if (teamRes?.error) {
        logger.warn("teams select error:", teamRes.error);
        return this.setAccessSnapshot({
          blocked: false,
          team: null,
          reason: "team_query_failed",
          last_checked: nowIso,
        });
      }

      const team = teamRes.data || null;
      const status = String(team?.subscription_status || "").toLowerCase();
      const isAdmin = team?.admin_user_id === uid;

      if (this.allowedTeamStates.has(status)) {
        // Team allowed
        return this.setAccessSnapshot({
          blocked: false,
          team: true,
          team_id: teamId,
          team_name: team?.name || null,
          team_status: status,
          admin_is_me: isAdmin,
          reason: null,
          last_checked: nowIso,
        });
      }

      // Team blocked
      const adminRes = await supabaseClient
        .from("vg_profiles")
        .select("name, email")
        .eq("user_id", team.admin_user_id)
        .single();

      const admin = adminRes?.data || null;

      return this.setAccessSnapshot({
        blocked: true,
        team: true,
        team_id: teamId,
        team_name: team?.name || null,
        team_status: status,
        admin_is_me: isAdmin,
        admin: admin
          ? {
              name: admin.name || null,
              email: admin.email || null,
            }
          : null,
        reason: "team_subscription_block",
        last_checked: nowIso,
      });
    } catch (error) {
      logger.error("Compute access snapshot error:", error);
      return this.setAccessSnapshot({
        blocked: false,
        team: null,
        reason: "computation_error",
        last_checked: nowIso,
      });
    }
  }

  /**
   * Set access snapshot in storage
   * @param {Object} snapshot - Access snapshot to store
   * @returns {Promise<Object>} Stored snapshot
   */
  async setAccessSnapshot(snapshot) {
    try {
      await storage.set({ [STORAGE_KEYS.ACCESS_STATUS]: snapshot });
      return snapshot;
    } catch (error) {
      logger.error("Failed to set access snapshot:", error);
      return snapshot;
    }
  }

  /**
   * Get cached access snapshot
   * @returns {Promise<Object>} Cached access snapshot
   */
  async getAccessSnapshotCached() {
    try {
      const result = await storage.get(STORAGE_KEYS.ACCESS_STATUS);
      return (
        result?.[STORAGE_KEYS.ACCESS_STATUS] || { blocked: false, team: null }
      );
    } catch (error) {
      logger.error("Failed to get cached access snapshot:", error);
      return { blocked: false, team: null };
    }
  }

  /**
   * Handle access status request
   * @param {Object} sender - Message sender
   * @param {Function} sendResponse - Response callback
   * @returns {Promise<boolean>} Whether to keep message channel open
   */
  async handleAccessStatus(sender, sendResponse) {
    try {
      const snapshot = await this.computeAccessSnapshot();
      sendResponse({ ok: true, access: snapshot });
      return false;
    } catch (error) {
      logger.error("Access status error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  /**
   * Handle access recheck request
   * @param {Object} sender - Message sender
   * @param {Function} sendResponse - Response callback
   * @returns {Promise<boolean>} Whether to keep message channel open
   */
  async handleAccessRecheck(sender, sendResponse) {
    try {
      const snapshot = await this.computeAccessSnapshot();
      sendResponse({ ok: true, access: snapshot });
      return false;
    } catch (error) {
      logger.error("Access recheck error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }

  /**
   * Handle team checkout start request
   * @param {Object} message - Message data
   * @param {Object} sender - Message sender
   * @param {Function} sendResponse - Response callback
   * @returns {Promise<boolean>} Whether to keep message channel open
   */
  async handleTeamCheckoutStart(message, sender, sendResponse) {
    try {
      const snapshot = await this.computeAccessSnapshot();
      const isTeam = snapshot?.team === true;
      const status = String(snapshot?.team_status || "");
      const isAdmin = snapshot?.admin_is_me === true;

      if (isTeam && status === TEAM_STATUSES.TRIAL_EXPIRED && isAdmin) {
        // Allow checkout - redirect to checkout page
        const checkoutUrl = "https://viberly.ai/trial-expired";
        await chrome.tabs.create({ url: checkoutUrl, active: true });
        sendResponse({ ok: true });
      } else {
        sendResponse({
          ok: false,
          reason: isTeam ? "TEAM_BLOCKED" : "INDIV_BLOCKED",
        });
      }

      return false;
    } catch (error) {
      logger.error("Team checkout start error:", error);
      sendResponse({ ok: false, error: error.message });
      return false;
    }
  }
}

// Create default access control manager instance
export const accessControl = new AccessControlManager();
