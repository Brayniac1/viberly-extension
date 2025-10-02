/**
 * Logger utility for Viberly Extension
 * Provides consistent logging across all modules with configurable levels
 */

import { LOG_LEVELS, STORAGE_KEYS } from "../constants.js";

/**
 * Logger class for the Viberly extension
 */
export class Logger {
  constructor(moduleName = "VG", defaultLevel = LOG_LEVELS.ERROR) {
    this.moduleName = moduleName;
    this.logLevel = defaultLevel;
    this.logLevels = {
      [LOG_LEVELS.SILENT]: 0,
      [LOG_LEVELS.ERROR]: 1,
      [LOG_LEVELS.WARN]: 2,
      [LOG_LEVELS.INFO]: 3,
      [LOG_LEVELS.DEBUG]: 4,
    };

    this.initializeLogLevel();
  }

  /**
   * Initialize log level from storage
   */
  async initializeLogLevel() {
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        const result = await new Promise((resolve) => {
          chrome.storage.local.get(STORAGE_KEYS.LOG_LEVEL, (data) => {
            resolve(data?.[STORAGE_KEYS.LOG_LEVEL] || this.logLevel);
          });
        });
        this.logLevel = result;

        // Listen for log level changes
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === "local" && changes[STORAGE_KEYS.LOG_LEVEL]) {
            this.logLevel =
              changes[STORAGE_KEYS.LOG_LEVEL].newValue || LOG_LEVELS.ERROR;
          }
        });
      }
    } catch (error) {
      // Fallback to default level
      this.logLevel = LOG_LEVELS.ERROR;
    }
  }

  /**
   * Check if a log level should be output
   * @param {string} level - The log level to check
   * @returns {boolean} - Whether the level should be logged
   */
  shouldLog(level) {
    const currentLevel = this.logLevels[this.logLevel] || 1;
    const targetLevel = this.logLevels[level] || 1;
    return targetLevel <= currentLevel;
  }

  /**
   * Format log message with module name
   * @param {string} level - Log level
   * @param {...any} args - Arguments to log
   * @returns {Array} - Formatted arguments
   */
  formatMessage(level, ...args) {
    return [`[${this.moduleName}]`, `[${level.toUpperCase()}]`, ...args];
  }

  /**
   * Log error message
   * @param {...any} args - Arguments to log
   */
  error(...args) {
    if (this.shouldLog(LOG_LEVELS.ERROR)) {
      console.error(...this.formatMessage(LOG_LEVELS.ERROR, ...args));
    }
  }

  /**
   * Log warning message
   * @param {...any} args - Arguments to log
   */
  warn(...args) {
    if (this.shouldLog(LOG_LEVELS.WARN)) {
      console.warn(...this.formatMessage(LOG_LEVELS.WARN, ...args));
    }
  }

  /**
   * Log info message
   * @param {...any} args - Arguments to log
   */
  info(...args) {
    if (this.shouldLog(LOG_LEVELS.INFO)) {
      console.info(...this.formatMessage(LOG_LEVELS.INFO, ...args));
    }
  }

  /**
   * Log debug message
   * @param {...any} args - Arguments to log
   */
  debug(...args) {
    if (this.shouldLog(LOG_LEVELS.DEBUG)) {
      console.debug(...this.formatMessage(LOG_LEVELS.DEBUG, ...args));
    }
  }

  /**
   * Log message (alias for info)
   * @param {...any} args - Arguments to log
   */
  log(...args) {
    this.info(...args);
  }
}

// Create default logger instance
export const logger = new Logger("VG");

// Legacy compatibility functions
export const vgErr = (...args) => logger.error(...args);
export const vgWarn = (...args) => logger.warn(...args);
export const vgInfo = (...args) => logger.info(...args);
export const vgDebug = (...args) => logger.debug(...args);

// Debug flag compatibility
export const DEBUG = false;
export const dbg = (...args) => DEBUG && console.log(...args);
export const dbgWarn = (...args) => DEBUG && console.warn(...args);
export const dbgDebug = (...args) => DEBUG && console.debug(...args);
