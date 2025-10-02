/**
 * Viberly Extension Constants
 * Centralized configuration and constants for the Viberly browser extension
 */

// Extension metadata
export const EXTENSION_INFO = {
  name: "Viberly AI",
  shortName: "Viberly AI",
  version: "1.0.45",
  description: "Save and reuse your favorite prompts instantly inside Chrome.",
  id: "viberly-extension",
};

// Supabase configuration
export const SUPABASE_CONFIG = {
  url: "https://auudkltdkakpnmpmddaj.supabase.co",
  anonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1dWRrbHRka2FrcG5tcG1kZGFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU3MDA3NTYsImV4cCI6MjA3MTI3Njc1Nn0.ukDpH6EXksctzWHMSdakhNaWbgFZ61UqrpvzwTy03ho",
};

// Storage keys
export const STORAGE_KEYS = {
  SESSION: "VG_SESSION",
  ACCESS_STATUS: "vg__access_status_v1",
  LOG_LEVEL: "VG_LOG_LEVEL",
  AUTH_STATE: "__vg_auth_state",
  RETURN_TO: "__vg_return_to",
  POST_BRIDGE_REDIRECT: "__vg_post_bridge_redirect_url",
  SITE_ACCESS: "vg_site_access",
  FEATURES: "vg_feat_",
  SETTINGS: "vg_settings",
};

// Message types for inter-script communication
export const MESSAGE_TYPES = {
  // Authentication
  AUTH_STATUS_PUSH: "AUTH_STATUS_PUSH",
  AUTH_STATUS: "AUTH_STATUS",
  AUTH_REDIRECT: "AUTH_REDIRECT",
  AUTH_RESET_PASSWORD: "AUTH_RESET_PASSWORD",
  SET_SESSION: "SET_SESSION",
  SIGN_OUT: "SIGN_OUT",

  // Access control
  ACCESS_STATUS: "ACCESS_STATUS",
  ACCESS_RECHECK: "ACCESS_RECHECK",

  // UI interactions
  VG_OPEN: "VG_OPEN",
  OPEN_QUICK_MENU: "OPEN_QUICK_MENU",
  PILL_CLICK: "PILL_CLICK",
  VG_OPEN_SIGNIN_POPUP: "VG_OPEN_SIGNIN_POPUP",

  // Paywall and billing
  VG_PAYWALL_SHOW: "VG_PAYWALL_SHOW",
  VG_PAYWALL_COLON_SHOW: "VG_PAYWALL:SHOW",
  VG_BILLING_CHECKOUT: "VG_BILLING:CHECKOUT",
  VG_BILLING_PORTAL: "VG_BILLING:PORTAL",
  VG_OPEN_BILLING: "VG_OPEN_BILLING",
  TEAM_CHECKOUT_START: "TEAM_CHECKOUT_START",

  // Screenshot functionality
  VG_SCREENSHOT_BEGIN: "VG_SCREENSHOT_BEGIN",
  VG_SCREENSHOT_CANCEL: "VG_SCREENSHOT_CANCEL",
  VG_SCREENSHOT_CAPTURED: "VG_SCREENSHOT_CAPTURED",
  VG_SCREENSHOT_INSERT: "VG_SCREENSHOT_INSERT",
  VG_SCREENSHOT_TELEMETRY: "VG_SCREENSHOT_TELEMETRY",
  VG_CAPTURE_VISIBLE_TAB: "VG_CAPTURE_VISIBLE_TAB",

  // Usage tracking
  COUNTER_HANDSHAKE: "COUNTER_HANDSHAKE",
  USAGE_TEST_INGEST: "USAGE_TEST_INGEST",
  VG_USAGE_BATCH: "VG_USAGE_BATCH",

  // Site access
  GET_SITE_ACCESS: "GET_SITE_ACCESS",
  SET_SITE_ACCESS: "SET_SITE_ACCESS",

  // Account management
  VG_ACCOUNT_SUMMARY: "VG_ACCOUNT_SUMMARY",

  // Debug
  VG_DEBUG_SESSION_SNAPSHOT: "VG_DEBUG:SESSION_SNAPSHOT",
  VG_DEBUG_LOAD_SETTINGS: "VG_DEBUG:LOAD_SETTINGS",
  VG_DEBUG_PROFILE: "VG_DEBUG:PROFILE",
  VG_DEBUG_GUARDS_COUNT: "VG_DEBUG:GUARDS_COUNT",
  VG_DEBUG_FAVS_COUNT: "VG_DEBUG:FAVS_COUNT",
  VG_DEBUG_DUMP_USER_DATA: "VG_DEBUG:DUMP_USER_DATA",
  VG_DEBUG_CONFIG: "VG_DEBUG:CONFIG",
};

// Allowed URLs for content script injection
export const ALLOWED_URLS = [
  "*://lovable.dev/*",
  "*://*.lovable.dev/*",
  "*://*.replit.com/*",
  "*://bolt.new/*",
  "*://*.cursor.so/*",
  "https://cursor.com/*",
  "*://*.codeium.com/*",
  "*://*.sourcegraph.com/*",
  "*://*.windsurf.ai/*",
  "*://*.mutable.ai/*",
  "*://aider.chat/*",
  "*://*.tabnine.com/*",
  "*://*.base44.com/*",
  "*://*.airtable.com/*",
  "https://airtable.com/*",
  "*://v0.dev/*",
  "*://v0.app/*",
  "https://vercel.com/v0/*",
  "https://github.com/copilot-workspace/*",
  "https://githubnext.com/*",
  "https://chatgpt.com/*",
  "https://*.chatgpt.com/*",
  "https://chat.openai.com/*",
  "*://gemini.google.com/*",
  "*://runwayml.com/*",
  "*://*.runwayml.com/*",
  "*://sora.chatgpt.com/*",
  "*://*.sora.chatgpt.com/*",
  "*://*.perplexity.ai/*",
  "https://perplexity.ai/*",
  "https://claude.ai/*",
  "https://www.canva.com/ai",
  "https://www.canva.com/ai/*",
  "https://grok.com/*",
  "https://canva.com/ai",
  "https://canva.com/ai/*",
  "*://bubble.io/*",
  "*://*.bubble.io/*",
  "https://midjourney.com/*",
  "https://chat.deepseek.com/*",
  "https://x.ai/*",
  "https://aistudio.google.com/*",
  "https://lindy.ai/*",
  "https://www.lindy.ai/*",
  "https://chat.lindy.ai/*",
  "https://figma.com/*",
  "https://www.figma.com/*",
  "https://chat.mistral.ai/*",
  "https://app.heygen.com/*",
  "https://dream-machine.lumalabs.ai/*",
  "https://www.notion.so/*",
  "https://higgsfield.ai/*",
  "https://www.framer.com/*",
  "https://gamma.app/*",
  "https://pika.art/*",
  "https://app.clickup.com/*",
  "https://zapier.com/*",
];

// Host permissions for manifest
export const HOST_PERMISSIONS = [
  "<all_urls>",
  "https://*.supabase.co/*",
  "https://api.openai.com/*",
  "https://viberly.ai/*",
  "https://lovable.dev/*",
  "https://*.lovable.dev/*",
  "https://*.replit.com/*",
  "https://bolt.new/*",
  "https://*.base44.com/*",
  "https://*.airtable.com/*",
  "https://airtable.com/*",
  "https://v0.dev/*",
  "https://v0.app/*",
  "https://vercel.com/v0/*",
  "https://chatgpt.com/*",
  "https://*.chatgpt.com/*",
  "https://chat.openai.com/*",
  "https://gemini.google.com/*",
  "https://runwayml.com/*",
  "https://*.runwayml.com/*",
  "https://sora.chatgpt.com/*",
  "https://*.sora.chatgpt.com/*",
  "https://*.perplexity.ai/*",
  "https://perplexity.ai/*",
  "https://claude.ai/*",
  "https://www.canva.com/*",
  "https://canva.com/*",
  "https://grok.com/*",
  "https://bubble.io/*",
  "https://*.bubble.io/*",
  "https://midjourney.com/*",
  "https://chat.deepseek.com/*",
  "https://x.ai/*",
  "https://aistudio.google.com/*",
  "https://lindy.ai/*",
  "https://www.lindy.ai/*",
  "https://chat.lindy.ai/*",
  "https://figma.com/*",
  "https://www.figma.com/*",
  "https://chat.mistral.ai/*",
];

// UI element IDs and selectors
export const UI_SELECTORS = {
  // HUD elements
  IFRAME_HUD: "__vg_iframe_hud__",
  QUICK_MENU: "vg-quick-menu",

  // Popup elements
  AUTH_VIEW: "authView",
  ACCOUNT_VIEW: "accountView",
  BLOCKED_VIEW: "blocked",

  // Auth form elements
  EMAIL_FIELD: "email",
  PASSWORD_FIELD: "password",
  SIGNIN_BUTTON: "signin",
  SIGNUP_BUTTON: "signup",
  MAGIC_BUTTON: "magic",
  FORGOT_BUTTON: "forgot",
  LOGOUT_BUTTON: "logout",
  AUTH_MESSAGE: "authMsg",

  // Account elements
  ACCOUNT_EMAIL: "acctEmail",
  ACCOUNT_PLAN: "acctPlan",
  ACCOUNT_USAGE: "acctUsage",
  SITE_ACCESS_HOST: "saHost",
  SITE_ACCESS_STATE: "saState",
  SITE_ACCESS_TOGGLE: "saToggle",
  SITE_ACCESS_HINT: "saHint",

  // Blocked view elements
  BLOCKED_TITLE: "blocked-title",
  BLOCKED_BODY: "blocked-body",
  BLOCKED_TEAM_NAME: "blocked-team-name",
  BLOCKED_ADMIN_NAME: "blocked-admin-name",
  BLOCKED_ADMIN_EMAIL: "blocked-admin-email",
  BLOCKED_PRICING_LINK: "blocked-pricing-link",
  BLOCKED_RETRY: "blocked-retry",
  BLOCKED_SIGNOUT: "blocked-signout",
};

// Feature flags
export const FEATURE_FLAGS = {
  SCREENSHOT_ENABLED: "screenshot_enabled",
  USE_IFRAME_HUD: "useIframeHUD",
  KILL_LEGACY_PILL: "killLegacyPill",
};

// Log levels
export const LOG_LEVELS = {
  SILENT: "silent",
  ERROR: "error",
  WARN: "warn",
  INFO: "info",
  DEBUG: "debug",
};

// Access control states
export const ACCESS_STATES = {
  ON: "on",
  OFF: "off",
  NOT_APPLICABLE: "na",
};

// Team subscription statuses
export const TEAM_STATUSES = {
  ACTIVE: "active",
  TRIALING: "trialing",
  TRIAL_EXPIRED: "trial_expired",
  PAST_DUE: "past_due",
  CANCELED: "canceled",
  EXPIRED: "expired",
};

// Individual subscription statuses
export const INDIVIDUAL_STATUSES = {
  PAST_DUE: "past_due",
  CANCELED: "canceled",
};

// Site strategies for content injection
export const SITE_STRATEGIES = {
  SWAP: "swap",
  REWRITE: "rewrite",
};

// Default configuration
export const DEFAULT_CONFIG = {
  DEBUG: false,
  LOG_LEVEL: LOG_LEVELS.ERROR,
  MENU_GAP: 8,
  PILL_SIZE: 40,
  Z_INDEX: 2147483600,
  MENU_DX: 0,
  AUTO_CLOSE_DELAY: 120,
  PAINT_DELAY: 20,
  SESSION_REFRESH_THRESHOLD: 30,
};

// URLs
export const URLS = {
  SIGNUP: "https://viberly.ai/signup",
  PRICING: "https://viberly.ai/pricing",
  EXTENSION_BRIDGE: "https://viberly.ai/extension-bridge",
  TRIAL_EXPIRED: "https://viberly.ai/trial-expired",
  INDIVIDUAL_SUBSCRIPTION_EXPIRED:
    "https://viberly.ai/individual/subscription-expired",
  RESET_PASSWORD: "https://viberly.ai/reset-password",
};

// CSS classes
export const CSS_CLASSES = {
  SIGNED_IN: "signed-in",
  SIGNED_OUT: "signed-out",
  AUTH_MODE_LOGIN: "login",
  AUTH_MODE_DEFAULT: "default",
  MESSAGE_ERROR: "err",
  MESSAGE_SUCCESS: "ok",
  BUTTON_PRIMARY: "primary",
  BUTTON_GHOST: "ghost",
  BUTTON_GOOGLE: "google",
};

// Event names
export const EVENTS = {
  DOM_CONTENT_LOADED: "DOMContentLoaded",
  CLICK: "click",
  KEYDOWN: "keydown",
  INPUT: "input",
  CHANGE: "change",
  MESSAGE: "message",
  AUTH_STATE_CHANGE: "authStateChange",
};

// File types
export const FILE_TYPES = {
  PNG: "image/png",
  JPEG: "image/jpeg",
  WEBP: "image/webp",
};

// Default file names
export const DEFAULT_FILENAMES = {
  SCREENSHOT: "screenshot.png",
};
