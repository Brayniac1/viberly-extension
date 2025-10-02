/**
 * Popup Manager for Viberly Extension
 * Handles popup UI state management and user interactions
 */

import {
  logger,
  messaging,
  UIDOMUtils,
  supabaseClient,
  sessionManager,
  ValidationUtils,
  ValidationSchemas,
} from "../utils/index.js";
import {
  MESSAGE_TYPES,
  UI_SELECTORS,
  CSS_CLASSES,
  URLS,
  DEFAULT_CONFIG,
} from "../constants.js";

/**
 * Popup manager for handling all popup functionality
 */
export class PopupManager {
  constructor() {
    this.isInitialized = false;
    this.paintSequence = 0;
    this.lastPushFP = null;
    this.lastAuthFP = null;
    this.autoCloseEnabled = false;
    this.didAutoClose = false;
  }

  /**
   * Initialize popup manager
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized) return;

    try {
      logger.debug("Initializing popup manager");

      // Set up auth state listener
      this.setupAuthStateListener();

      // Set up UI event listeners
      this.setupUIEventListeners();

      // Set up message listeners
      this.setupMessageListeners();

      // Initialize UI state
      await this.initializeUI();

      // Set up auto-close if enabled
      this.setupAutoClose();

      this.isInitialized = true;
      logger.debug("Popup manager initialized");
    } catch (error) {
      logger.error("Failed to initialize popup manager:", error);
    }
  }

  /**
   * Set up Supabase auth state change listener
   */
  setupAuthStateListener() {
    try {
      supabaseClient.auth.onAuthStateChange((event, session) => {
        this.handleAuthStateChange(event, session);
      });
    } catch (error) {
      logger.error("Failed to setup auth state listener:", error);
    }
  }

  /**
   * Set up UI event listeners
   */
  setupUIEventListeners() {
    try {
      // Auth form elements
      const emailField = UIDOMUtils.getElementById(UI_SELECTORS.EMAIL_FIELD);
      const passwordField = UIDOMUtils.getElementById(
        UI_SELECTORS.PASSWORD_FIELD
      );
      const signinButton = UIDOMUtils.getElementById(
        UI_SELECTORS.SIGNIN_BUTTON
      );
      const signupButton = UIDOMUtils.getElementById(
        UI_SELECTORS.SIGNUP_BUTTON
      );
      const magicButton = UIDOMUtils.getElementById(UI_SELECTORS.MAGIC_BUTTON);
      const forgotButton = UIDOMUtils.getElementById(
        UI_SELECTORS.FORGOT_BUTTON
      );
      const logoutButton = UIDOMUtils.getElementById(
        UI_SELECTORS.LOGOUT_BUTTON
      );

      // Auth mode toggles
      const showLogin = UIDOMUtils.getElementById("showLogin");
      const showSignupTop = UIDOMUtils.getElementById("showSignupTop");

      // Set up form submission
      if (signinButton) {
        this.setupSigninHandler(signinButton, emailField, passwordField);
      }

      if (signupButton) {
        this.setupSignupHandler(signupButton);
      }

      if (magicButton) {
        this.setupMagicLinkHandler(magicButton, emailField);
      }

      if (forgotButton) {
        this.setupForgotPasswordHandler(forgotButton, emailField);
      }

      if (logoutButton) {
        this.setupLogoutHandler(logoutButton);
      }

      // Set up auth mode toggles
      if (showLogin) {
        this.setupAuthModeToggle(showLogin, "login");
      }

      if (showSignupTop) {
        this.setupAuthModeToggle(showSignupTop, "default");
      }

      // Set up keyboard navigation
      this.setupKeyboardNavigation(emailField, passwordField, signinButton);

      // Set up input clearing
      this.setupInputClearing(emailField, passwordField);
    } catch (error) {
      logger.error("Failed to setup UI event listeners:", error);
    }
  }

  /**
   * Set up message listeners
   */
  setupMessageListeners() {
    try {
      // Auth status push listener
      const authListener = messaging.addListener((message) => {
        if (message?.type === MESSAGE_TYPES.AUTH_STATUS_PUSH) {
          this.schedulePaint("auth-push");
        }
      });

      // Store listener for cleanup
      this.messageListeners = this.messageListeners || new Map();
      this.messageListeners.set("auth", authListener);
    } catch (error) {
      logger.error("Failed to setup message listeners:", error);
    }
  }

  /**
   * Initialize UI state
   * @returns {Promise<void>}
   */
  async initializeUI() {
    try {
      // Wire logout button
      this.wireLogout();

      // Push session to background
      await this.pushSessionToBackground();

      // Initial paint
      this.schedulePaint("boot");

      // Check for auto-close
      this.checkAutoClose();
    } catch (error) {
      logger.error("Failed to initialize UI:", error);
    }
  }

  /**
   * Set up auto-close functionality
   */
  setupAutoClose() {
    try {
      const urlParams = new URLSearchParams(location.search);
      this.autoCloseEnabled = urlParams.get("auto") === "1";
    } catch (error) {
      logger.error("Failed to setup auto-close:", error);
    }
  }

  /**
   * Check if auto-close should happen
   */
  async checkAutoClose() {
    if (!this.autoCloseEnabled || this.didAutoClose) return;

    try {
      const {
        data: { session },
      } = await supabaseClient.auth.getSession();
      if (!session?.user) return;

      this.didAutoClose = true;
      this.closePopupSafely();
    } catch (error) {
      logger.error("Auto-close check error:", error);
    }
  }

  /**
   * Handle auth state change
   * @param {string} event - Auth event
   * @param {Object} session - User session
   */
  async handleAuthStateChange(event, session) {
    try {
      if (event === "SIGNED_IN" && session) {
        await this.handleSignIn(session);
      } else if (event === "SIGNED_OUT") {
        await this.handleSignOut();
      } else if (event === "TOKEN_REFRESHED" && session) {
        await this.handleTokenRefresh(session);
      }
    } catch (error) {
      logger.error("Auth state change handler error:", error);
    }
  }

  /**
   * Handle user sign in
   * @param {Object} session - User session
   */
  async handleSignIn(session) {
    try {
      if (!sessionManager.isValidSession(session)) {
        logger.warn("Invalid session received during sign in");
        return;
      }

      // Push session to background
      await this.pushSessionToBackground();

      // Schedule repaint
      this.schedulePaint("signin");
    } catch (error) {
      logger.error("Sign in handler error:", error);
    }
  }

  /**
   * Handle user sign out
   */
  async handleSignOut() {
    try {
      // Schedule repaint
      this.schedulePaint("signout");
    } catch (error) {
      logger.error("Sign out handler error:", error);
    }
  }

  /**
   * Handle token refresh
   * @param {Object} session - Refreshed session
   */
  async handleTokenRefresh(session) {
    try {
      if (!sessionManager.isValidSession(session)) {
        logger.warn("Invalid session received during token refresh");
        return;
      }

      // Push updated session to background
      await this.pushSessionToBackground();
    } catch (error) {
      logger.error("Token refresh handler error:", error);
    }
  }

  /**
   * Push session to background
   * @returns {Promise<void>}
   */
  async pushSessionToBackground() {
    try {
      const {
        data: { session },
      } = await supabaseClient.auth.getSession();
      const at = session?.access_token;
      const rt = session?.refresh_token;
      const exp = session?.expires_at;
      const uid = session?.user?.id || null;
      const email = session?.user?.email || null;

      if (!at || !rt || !Number.isFinite(exp)) return;

      const fp = this.createSessionFingerprint(session);
      if (fp === this.lastPushFP) return;

      this.lastPushFP = fp;

      await new Promise((resolve) =>
        setTimeout(resolve, DEFAULT_CONFIG.PAINT_DELAY)
      );

      const response = await messaging.sendMessage({
        type: MESSAGE_TYPES.SET_SESSION,
        access_token: at,
        refresh_token: rt,
        expires_at: exp,
        userId: uid,
        email: email,
      });

      logger.debug("Session pushed to background:", response);
    } catch (error) {
      logger.error("Failed to push session to background:", error);
    }
  }

  /**
   * Create session fingerprint for deduplication
   * @param {Object} session - Session object
   * @returns {string} Session fingerprint
   */
  createSessionFingerprint(session) {
    const at = session?.access_token || "";
    const rt = session?.refresh_token || "";
    const exp = session?.expires_at || session?.expires_in || "";
    return `${at.slice(0, 12)}.${rt.slice(0, 12)}.${exp}`;
  }

  /**
   * Schedule UI repaint
   * @param {string} reason - Reason for repaint
   */
  schedulePaint(reason = "") {
    const mySeq = ++this.paintSequence;

    Promise.resolve().then(() => {
      this.paintIfCurrent(mySeq, reason).catch((error) => {
        logger.error("Paint error:", error);
      });
    });
  }

  /**
   * Paint UI if current sequence
   * @param {number} seq - Paint sequence number
   * @param {string} reason - Reason for paint
   */
  async paintIfCurrent(seq, reason = "") {
    if (seq !== this.paintSequence) return;

    try {
      // Get session from background
      const sot = await this.getBackgroundSession();
      logger.debug("Paint start", {
        reason,
        seq,
        hasSession: !!sot?.access_token,
      });

      if (seq !== this.paintSequence) return;

      const signedIn =
        sessionManager.isValidSession(sot) || !!sot?.session?.user;
      UIDOMUtils.setHTMLState(!!signedIn);

      if (signedIn) {
        await this.paintSignedInState(sot);
      } else {
        this.paintSignedOutState();
      }

      // Paint site access controls
      if (seq === this.paintSequence) {
        await this.paintSiteAccessControls();
      }

      // Final guard
      if (seq !== this.paintSequence) return;

      logger.debug("Paint completed", { reason, seq });
    } catch (error) {
      logger.error("Paint error:", error);
    }
  }

  /**
   * Get session from background
   * @returns {Promise<Object|null>} Background session
   */
  async getBackgroundSession() {
    try {
      const response = await messaging.sendMessage({
        type: MESSAGE_TYPES.AUTH_STATUS,
      });
      return response?.session || null;
    } catch (error) {
      logger.error("Failed to get background session:", error);
      return null;
    }
  }

  /**
   * Paint signed-in state
   * @param {Object} sot - Session from background
   */
  async paintSignedInState(sot) {
    try {
      // Hydrate local client from tokens
      await this.hydrateFromSession(sot);

      // Get user info
      let email = "";
      try {
        const {
          data: { session },
        } = await supabaseClient.auth.getSession();
        const {
          data: { user },
        } = await supabaseClient.auth.getUser();
        email = user?.email || user?.user_metadata?.email || "";
      } catch (error) {
        logger.error("Failed to get user info:", error);
      }

      if (!email) email = sot?.email || "";

      UIDOMUtils.setHTMLState(true);
      UIDOMUtils.setTextById(UI_SELECTORS.ACCOUNT_EMAIL, email || "—");

      // Get account summary
      const summary = await this.getAccountSummary();
      if (this.paintSequence !== this.paintSequence) return;

      this.paintAccountSummary(summary);
    } catch (error) {
      logger.error("Paint signed-in state error:", error);
    }
  }

  /**
   * Paint signed-out state
   */
  paintSignedOutState() {
    UIDOMUtils.setTextById(UI_SELECTORS.ACCOUNT_EMAIL, "—");
    UIDOMUtils.setTextById(UI_SELECTORS.ACCOUNT_PLAN, "—");
    UIDOMUtils.setTextById(UI_SELECTORS.ACCOUNT_USAGE, "—");
  }

  /**
   * Hydrate Supabase client from session
   * @param {Object} session - Session object
   * @returns {Promise<boolean>} Whether hydration succeeded
   */
  async hydrateFromSession(session) {
    if (!sessionManager.isValidSession(session)) return false;

    try {
      await supabaseClient.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });

      // Verify session is set
      for (let i = 0; i < 8; i++) {
        try {
          const {
            data: { session: currentSession },
          } = await supabaseClient.auth.getSession();
          if (currentSession?.user?.id) return true;
        } catch (error) {
          // Continue trying
        }
        await new Promise((resolve) => setTimeout(resolve, 75));
      }

      return false;
    } catch (error) {
      logger.error("Failed to hydrate from session:", error);
      return false;
    }
  }

  /**
   * Get account summary from background
   * @returns {Promise<Object>} Account summary
   */
  async getAccountSummary() {
    try {
      const response = await messaging.sendMessage({
        type: MESSAGE_TYPES.VG_ACCOUNT_SUMMARY,
      });
      return (
        response?.summary || {
          tier: "free",
          used: 0,
          limit: 1,
          status: "inactive",
        }
      );
    } catch (error) {
      logger.error("Failed to get account summary:", error);
      return { tier: "free", used: 0, limit: 1, status: "inactive" };
    }
  }

  /**
   * Paint account summary
   * @param {Object} summary - Account summary
   */
  paintAccountSummary(summary) {
    const tier = summary?.tier ?? summary?.plan ?? "—";
    const used = Number.isFinite(summary?.used) ? summary.used : null;
    const limit = Number.isFinite(summary?.limit)
      ? summary.limit
      : Number.isFinite(summary?.Limit)
      ? summary.Limit
      : null;

    UIDOMUtils.setTextById(UI_SELECTORS.ACCOUNT_PLAN, String(tier || "—"));

    if (used != null && limit != null) {
      UIDOMUtils.setTextById(UI_SELECTORS.ACCOUNT_USAGE, `${used} / ${limit}`);
    } else {
      UIDOMUtils.setTextById(UI_SELECTORS.ACCOUNT_USAGE, "—");
    }
  }

  /**
   * Paint site access controls
   */
  async paintSiteAccessControls() {
    try {
      const response = await messaging.sendMessage({
        type: MESSAGE_TYPES.GET_SITE_ACCESS,
      });

      const host = response?.host || null;
      const path = response?.path || "/";
      const tri =
        typeof response?.state === "string"
          ? response.state
          : response?.enabled
          ? "on"
          : "off";
      const isOn = tri === "on";
      const isNA = tri === "na";

      UIDOMUtils.setTextById(UI_SELECTORS.SITE_ACCESS_HOST, host || "—");
      UIDOMUtils.setTextById(
        UI_SELECTORS.SITE_ACCESS_STATE,
        isNA ? "N/A" : isOn ? "ON" : "OFF"
      );

      // Show hint only when ON
      const hint = UIDOMUtils.getElementById(UI_SELECTORS.SITE_ACCESS_HINT);
      if (hint) {
        UIDOMUtils.toggleVisibility(hint, isOn);
      }

      // Set up toggle
      this.setupSiteAccessToggle(host, path, isOn, isNA);
    } catch (error) {
      logger.error("Paint site access controls error:", error);
    }
  }

  /**
   * Set up site access toggle
   * @param {string} host - Site host
   * @param {string} path - Site path
   * @param {boolean} isOn - Whether access is on
   * @param {boolean} isNA - Whether access is not applicable
   */
  setupSiteAccessToggle(host, path, isOn, isNA) {
    const toggle = UIDOMUtils.getElementById(UI_SELECTORS.SITE_ACCESS_TOGGLE);
    if (!toggle) return;

    toggle.checked = isOn;
    toggle.disabled = isNA;

    if (isNA) {
      toggle.setAttribute("aria-disabled", "true");
    } else {
      toggle.removeAttribute("aria-disabled");
    }

    if (!toggle.__wired) {
      toggle.__wired = true;
      UIDOMUtils.addEventListener(toggle, "change", () => {
        this.handleSiteAccessToggleChange(toggle, host, path);
      });
    }
  }

  /**
   * Handle site access toggle change
   * @param {HTMLElement} toggle - Toggle element
   * @param {string} host - Site host
   * @param {string} path - Site path
   */
  async handleSiteAccessToggleChange(toggle, host, path) {
    if (toggle.disabled) {
      toggle.checked = false;
      return;
    }

    const wantOn = toggle.checked;
    const state = wantOn ? "inherit" : "off";

    try {
      await messaging.sendMessage({
        type: MESSAGE_TYPES.SET_SITE_ACCESS,
        host,
        path,
        state,
      });

      // Re-read truth from background
      const response = await messaging.sendMessage({
        type: MESSAGE_TYPES.GET_SITE_ACCESS,
        host,
        path,
      });

      const tri2 =
        typeof response?.state === "string"
          ? response.state
          : response?.enabled
          ? "on"
          : "off";
      const on2 = tri2 === "on";
      const na2 = tri2 === "na";

      UIDOMUtils.setTextById(
        UI_SELECTORS.SITE_ACCESS_STATE,
        na2 ? "N/A" : on2 ? "ON" : "OFF"
      );
      toggle.checked = on2;

      const hint = UIDOMUtils.getElementById(UI_SELECTORS.SITE_ACCESS_HINT);
      if (hint) {
        UIDOMUtils.toggleVisibility(hint, on2);
      }

      if (na2) {
        toggle.disabled = true;
        toggle.setAttribute("aria-disabled", "true");
      } else {
        toggle.disabled = false;
        toggle.removeAttribute("aria-disabled");
      }
    } catch (error) {
      logger.error("Site access toggle change error:", error);
    }
  }

  /**
   * Set up signin handler
   * @param {HTMLElement} button - Signin button
   * @param {HTMLElement} emailField - Email field
   * @param {HTMLElement} passwordField - Password field
   */
  setupSigninHandler(button, emailField, passwordField) {
    UIDOMUtils.addEventListener(button, "click", async () => {
      await this.handleSignin(button, emailField, passwordField);
    });
  }

  /**
   * Handle signin
   * @param {HTMLElement} button - Signin button
   * @param {HTMLElement} emailField - Email field
   * @param {HTMLElement} passwordField - Password field
   */
  async handleSignin(button, emailField, passwordField) {
    UIDOMUtils.clearAuthMessage();

    const email = (emailField?.value || "").trim();
    const password = passwordField?.value || "";

    if (!email || !password) {
      UIDOMUtils.showAuthMessage("Enter email and password");
      return;
    }

    UIDOMUtils.lockElement(button, true);

    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        UIDOMUtils.showAuthMessage(error.message || "Sign in failed");
        return;
      }

      const session = data?.session;
      if (!sessionManager.isValidSession(session)) {
        UIDOMUtils.showAuthMessage(
          "Signed in but no session tokens; try again"
        );
        return;
      }

      // Hydrate popup client
      await supabaseClient.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });

      // Push to background
      await this.pushSessionToBackground();

      // Check access gate
      await this.checkAccessGate();

      // Success
      this.schedulePaint("login");
      UIDOMUtils.showAuthMessage("Signed in", "ok");
      setTimeout(
        () => this.closePopupSafely(),
        DEFAULT_CONFIG.AUTO_CLOSE_DELAY
      );
    } catch (error) {
      UIDOMUtils.showAuthMessage(error?.message || "Unexpected error");
    } finally {
      UIDOMUtils.lockElement(button, false);
    }
  }

  /**
   * Check access gate after signin
   */
  async checkAccessGate() {
    try {
      const response = await messaging.sendMessage({
        type: MESSAGE_TYPES.ACCESS_RECHECK,
      });

      const snap = response?.access || {};
      const teamBlocked = snap.blocked === true && snap.team === true;
      const indivBlocked =
        snap.blocked === true &&
        snap.team === false &&
        (snap.indiv_status === "past_due" || snap.indiv_status === "canceled");

      if (teamBlocked || indivBlocked) {
        // Handle blocked state
        this.handleBlockedState(snap);
        return;
      }
    } catch (error) {
      logger.error("Access gate check error:", error);
    }
  }

  /**
   * Handle blocked state
   * @param {Object} snap - Access snapshot
   */
  handleBlockedState(snap) {
    // This would show the blocked UI
    logger.info("User is blocked:", snap);
  }

  /**
   * Set up signup handler
   * @param {HTMLElement} button - Signup button
   */
  setupSignupHandler(button) {
    UIDOMUtils.addEventListener(button, "click", (e) => {
      e.preventDefault();
      this.openSignup();
    });
  }

  /**
   * Open signup page
   */
  openSignup() {
    try {
      chrome.tabs.create({ url: URLS.SIGNUP });
    } catch (error) {
      window.open(URLS.SIGNUP, "_blank", "noopener,noreferrer");
    }
  }

  /**
   * Set up magic link handler
   * @param {HTMLElement} button - Magic link button
   * @param {HTMLElement} emailField - Email field
   */
  setupMagicLinkHandler(button, emailField) {
    UIDOMUtils.addEventListener(button, "click", async () => {
      await this.handleMagicLink(button, emailField);
    });
  }

  /**
   * Handle magic link
   * @param {HTMLElement} button - Magic link button
   * @param {HTMLElement} emailField - Email field
   */
  async handleMagicLink(button, emailField) {
    UIDOMUtils.clearAuthMessage();

    const email = (emailField?.value || "").trim();
    if (!email) {
      UIDOMUtils.showAuthMessage("Enter your email, then press button");
      return;
    }

    UIDOMUtils.lockElement(button, true);

    try {
      const { error } = await supabaseClient.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: URLS.EXTENSION_BRIDGE,
        },
      });

      if (error) {
        UIDOMUtils.showAuthMessage(error.message || "Failed to send link");
        return;
      }

      UIDOMUtils.showAuthMessage("Check your email for a login link", "ok");
    } catch (error) {
      UIDOMUtils.showAuthMessage(error?.message || "Unexpected error");
    } finally {
      UIDOMUtils.lockElement(button, false);
    }
  }

  /**
   * Set up forgot password handler
   * @param {HTMLElement} button - Forgot password button
   * @param {HTMLElement} emailField - Email field
   */
  setupForgotPasswordHandler(button, emailField) {
    UIDOMUtils.addEventListener(button, "click", async (e) => {
      e.preventDefault();
      await this.handleForgotPassword(button, emailField);
    });
  }

  /**
   * Handle forgot password
   * @param {HTMLElement} button - Forgot password button
   * @param {HTMLElement} emailField - Email field
   */
  async handleForgotPassword(button, emailField) {
    UIDOMUtils.clearAuthMessage();

    const email = (emailField?.value || "").trim();
    if (!email) {
      UIDOMUtils.showAuthMessage(
        "Enter your email first, then click Forgot Password"
      );
      emailField?.focus();
      return;
    }

    UIDOMUtils.lockElement(button, true);

    try {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: URLS.RESET_PASSWORD,
      });

      if (error) throw error;

      UIDOMUtils.showAuthMessage("Reset link sent. Check your inbox.", "ok");
    } catch (error) {
      logger.warn("Reset via popup failed, trying background fallback:", error);

      try {
        const response = await messaging.sendMessage({
          type: MESSAGE_TYPES.AUTH_RESET_PASSWORD,
          email,
          redirectTo: URLS.RESET_PASSWORD,
        });

        if (response?.ok) {
          UIDOMUtils.showAuthMessage(
            "Reset link sent. Check your inbox.",
            "ok"
          );
        } else {
          UIDOMUtils.showAuthMessage(
            response?.error || "Failed to send reset email"
          );
        }
      } catch (error2) {
        UIDOMUtils.showAuthMessage(
          error2?.message || "Failed to send reset email"
        );
      }
    } finally {
      UIDOMUtils.lockElement(button, false);
    }
  }

  /**
   * Set up logout handler
   * @param {HTMLElement} button - Logout button
   */
  setupLogoutHandler(button) {
    UIDOMUtils.addEventListener(button, "click", async () => {
      await this.handleLogout();
    });
  }

  /**
   * Handle logout
   */
  async handleLogout() {
    try {
      await supabaseClient.auth.signOut();
      await messaging.sendMessage({ type: MESSAGE_TYPES.SIGN_OUT });

      // Clear storage
      const allData = await chrome.storage.local.get();
      const keys = Object.keys(allData).filter((k) => k.startsWith("sb-"));
      if (keys.length) {
        await chrome.storage.local.remove(keys);
      }
      await chrome.storage.local.remove("VG_SESSION");

      this.schedulePaint("logout");
    } catch (error) {
      logger.error("Logout error:", error);
    }
  }

  /**
   * Wire logout button
   */
  wireLogout() {
    const button = UIDOMUtils.getElementById(UI_SELECTORS.LOGOUT_BUTTON);
    if (!button || button.__wired) return;

    button.__wired = true;
    this.setupLogoutHandler(button);
  }

  /**
   * Set up auth mode toggle
   * @param {HTMLElement} button - Toggle button
   * @param {string} mode - Auth mode
   */
  setupAuthModeToggle(button, mode) {
    UIDOMUtils.addEventListener(button, "click", (e) => {
      e.preventDefault();
      UIDOMUtils.setAuthMode(mode);
      UIDOMUtils.clearAuthMessage();

      if (mode === "login") {
        const emailField = UIDOMUtils.getElementById(UI_SELECTORS.EMAIL_FIELD);
        emailField?.focus();
      }
    });
  }

  /**
   * Set up keyboard navigation
   * @param {HTMLElement} emailField - Email field
   * @param {HTMLElement} passwordField - Password field
   * @param {HTMLElement} signinButton - Signin button
   */
  setupKeyboardNavigation(emailField, passwordField, signinButton) {
    [emailField, passwordField].forEach((field) => {
      if (!field) return;

      UIDOMUtils.addEventListener(field, "keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          signinButton?.click();
        }
      });
    });
  }

  /**
   * Set up input clearing
   * @param {HTMLElement} emailField - Email field
   * @param {HTMLElement} passwordField - Password field
   */
  setupInputClearing(emailField, passwordField) {
    [emailField, passwordField].forEach((field) => {
      if (!field) return;

      UIDOMUtils.addEventListener(field, "input", () => {
        UIDOMUtils.clearAuthMessage();
      });
    });
  }

  /**
   * Close popup safely
   */
  closePopupSafely() {
    try {
      window.close();
    } catch (error) {
      // Ignore close errors
    }

    // Only close extension window if opened with ?auto=1
    try {
      const params = new URLSearchParams(location.search);
      const canCloseWindow = params.get("auto") === "1";
      if (!canCloseWindow) return;

      chrome.windows.getCurrent((window) => {
        if (!window?.id) return;

        chrome.tabs.query({ windowId: window.id }, (tabs) => {
          const isSingleExtTab =
            tabs?.length === 1 &&
            tabs[0]?.url?.startsWith("chrome-extension://");
          if (isSingleExtTab && window.type === "popup") {
            chrome.windows.remove(window.id);
          }
        });
      });
    } catch (error) {
      // Ignore window close errors
    }
  }
}

// Create and initialize popup manager
const popupManager = new PopupManager();

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    popupManager.initialize();
  });
} else {
  popupManager.initialize();
}

// Export for testing
export { popupManager };
