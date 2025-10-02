/**
 * Viberly Extension Background Script (Service Worker)
 * Refactored modular version with cross-browser compatibility
 */

// Load Supabase UMD bundle (exposes global `supabase`)
importScripts("./vendor/supabase.umd.js");

// Import modular background script
import "./src/background/index.js";
