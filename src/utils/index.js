/**
 * Viberly Extension Utilities
 * Centralized export of all utility modules
 */

// Core utilities
export {
  Logger,
  logger,
  vgErr,
  vgWarn,
  vgInfo,
  vgDebug,
  dbg,
  dbgWarn,
  dbgDebug,
  DEBUG,
} from "./logger.js";
export {
  StorageManager,
  storage,
  supabaseStorage,
  SessionManager,
  sessionManager,
} from "./storage.js";
export {
  MessagingManager,
  messaging,
  MessageTypes,
  MessageUtils,
} from "./messaging.js";
export { DOMUtils, UIDOMUtils } from "./dom.js";
export { ValidationUtils, ValidationSchemas } from "./validation.js";
export {
  SupabaseManager,
  supabaseManager,
  supabaseClient,
  getSupabaseClient,
  getSession,
  getUser,
  signInWithPassword,
  signInWithOtp,
  resetPasswordForEmail,
  signOut,
  setSession,
  onAuthStateChange,
} from "./supabase.js";
export {
  PolyfillManager,
  polyfill,
  getBrowserAPI,
  isFirefox,
  isChrome,
  getBrowserName,
  getManifestVersion,
  isManifestV3,
  getExtensionId,
  getExtensionURL,
  isDevelopmentMode,
  getExtensionVersion,
  isAPIAvailable,
  createStorageAPI,
  createRuntimeAPI,
  createTabsAPI,
  createWindowsAPI,
  createScriptingAPI,
  createActionAPI,
} from "./polyfill.js";

// Re-export constants for convenience
export * from "../constants.js";
