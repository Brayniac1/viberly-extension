/**
 * Validation utility for Viberly Extension
 * Provides validation functions for various data types and inputs
 */

import { logger } from "./logger.js";

/**
 * Validation utility class
 */
export class ValidationUtils {
  /**
   * Validate email address
   * @param {string} email - Email to validate
   * @returns {boolean} Whether email is valid
   */
  static isValidEmail(email) {
    if (!email || typeof email !== "string") return false;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
  }

  /**
   * Validate password strength
   * @param {string} password - Password to validate
   * @returns {Object} Validation result with isValid and message
   */
  static validatePassword(password) {
    if (!password || typeof password !== "string") {
      return { isValid: false, message: "Password is required" };
    }

    if (password.length < 8) {
      return {
        isValid: false,
        message: "Password must be at least 8 characters long",
      };
    }

    return { isValid: true, message: "Password is valid" };
  }

  /**
   * Validate URL
   * @param {string} url - URL to validate
   * @returns {boolean} Whether URL is valid
   */
  static isValidURL(url) {
    if (!url || typeof url !== "string") return false;

    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate session object
   * @param {Object} session - Session to validate
   * @returns {Object} Validation result
   */
  static validateSession(session) {
    if (!session || typeof session !== "object") {
      return { isValid: false, message: "Session is required" };
    }

    const requiredFields = ["access_token", "refresh_token", "expires_at"];
    const missingFields = requiredFields.filter((field) => !session[field]);

    if (missingFields.length > 0) {
      return {
        isValid: false,
        message: `Session missing required fields: ${missingFields.join(", ")}`,
      };
    }

    if (!Number.isFinite(session.expires_at)) {
      return {
        isValid: false,
        message: "Session expires_at must be a valid number",
      };
    }

    return { isValid: true, message: "Session is valid" };
  }

  /**
   * Validate access snapshot
   * @param {Object} snapshot - Access snapshot to validate
   * @returns {Object} Validation result
   */
  static validateAccessSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
      return { isValid: false, message: "Access snapshot is required" };
    }

    if (typeof snapshot.blocked !== "boolean") {
      return {
        isValid: false,
        message: "Access snapshot blocked must be boolean",
      };
    }

    return { isValid: true, message: "Access snapshot is valid" };
  }

  /**
   * Validate message object
   * @param {Object} message - Message to validate
   * @returns {Object} Validation result
   */
  static validateMessage(message) {
    if (!message || typeof message !== "object") {
      return { isValid: false, message: "Message is required" };
    }

    if (!message.type || typeof message.type !== "string") {
      return { isValid: false, message: "Message type is required" };
    }

    return { isValid: true, message: "Message is valid" };
  }

  /**
   * Validate tab object
   * @param {Object} tab - Tab to validate
   * @returns {Object} Validation result
   */
  static validateTab(tab) {
    if (!tab || typeof tab !== "object") {
      return { isValid: false, message: "Tab is required" };
    }

    if (!Number.isInteger(tab.id) || tab.id < 0) {
      return { isValid: false, message: "Tab ID must be a positive integer" };
    }

    if (!tab.url || typeof tab.url !== "string") {
      return { isValid: false, message: "Tab URL is required" };
    }

    return { isValid: true, message: "Tab is valid" };
  }

  /**
   * Validate file object
   * @param {Object} file - File to validate
   * @returns {Object} Validation result
   */
  static validateFile(file) {
    if (!file || typeof file !== "object") {
      return { isValid: false, message: "File is required" };
    }

    if (!file.name || typeof file.name !== "string") {
      return { isValid: false, message: "File name is required" };
    }

    if (!file.type || typeof file.type !== "string") {
      return { isValid: false, message: "File type is required" };
    }

    if (!file.size || typeof file.size !== "number" || file.size < 0) {
      return { isValid: false, message: "File size must be a positive number" };
    }

    return { isValid: true, message: "File is valid" };
  }

  /**
   * Validate screenshot data
   * @param {Object} data - Screenshot data to validate
   * @returns {Object} Validation result
   */
  static validateScreenshotData(data) {
    if (!data || typeof data !== "object") {
      return { isValid: false, message: "Screenshot data is required" };
    }

    if (!data.dataURL || typeof data.dataURL !== "string") {
      return { isValid: false, message: "Screenshot dataURL is required" };
    }

    if (!data.dataURL.startsWith("data:image/")) {
      return {
        isValid: false,
        message: "Screenshot dataURL must be a valid image data URL",
      };
    }

    return { isValid: true, message: "Screenshot data is valid" };
  }

  /**
   * Validate usage data
   * @param {Object} usage - Usage data to validate
   * @returns {Object} Validation result
   */
  static validateUsageData(usage) {
    if (!usage || typeof usage !== "object") {
      return { isValid: false, message: "Usage data is required" };
    }

    if (!Number.isInteger(usage.tokens) || usage.tokens < 0) {
      return {
        isValid: false,
        message: "Usage tokens must be a non-negative integer",
      };
    }

    if (!usage.timestamp || typeof usage.timestamp !== "number") {
      return { isValid: false, message: "Usage timestamp is required" };
    }

    return { isValid: true, message: "Usage data is valid" };
  }

  /**
   * Sanitize string input
   * @param {string} input - Input to sanitize
   * @param {number} maxLength - Maximum length (default: 1000)
   * @returns {string} Sanitized string
   */
  static sanitizeString(input, maxLength = 1000) {
    if (!input || typeof input !== "string") return "";

    return input
      .trim()
      .slice(0, maxLength)
      .replace(/[<>]/g, "") // Remove potential HTML tags
      .replace(/[\x00-\x1F\x7F]/g, ""); // Remove control characters
  }

  /**
   * Sanitize HTML content
   * @param {string} html - HTML to sanitize
   * @returns {string} Sanitized HTML
   */
  static sanitizeHTML(html) {
    if (!html || typeof html !== "string") return "";

    // Basic HTML sanitization - remove script tags and dangerous attributes
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/on\w+="[^"]*"/gi, "")
      .replace(/javascript:/gi, "");
  }

  /**
   * Validate and sanitize form data
   * @param {Object} formData - Form data to validate
   * @param {Object} schema - Validation schema
   * @returns {Object} Validation result with sanitized data
   */
  static validateFormData(formData, schema) {
    if (!formData || typeof formData !== "object") {
      return { isValid: false, message: "Form data is required", data: null };
    }

    if (!schema || typeof schema !== "object") {
      return {
        isValid: false,
        message: "Validation schema is required",
        data: null,
      };
    }

    const sanitizedData = {};
    const errors = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = formData[field];

      // Check if required field is present
      if (rules.required && (!value || value === "")) {
        errors.push(`${field} is required`);
        continue;
      }

      // Skip validation if field is not required and empty
      if (!rules.required && (!value || value === "")) {
        sanitizedData[field] = "";
        continue;
      }

      // Sanitize string fields
      if (rules.type === "string") {
        const sanitized = this.sanitizeString(value, rules.maxLength);
        if (rules.minLength && sanitized.length < rules.minLength) {
          errors.push(
            `${field} must be at least ${rules.minLength} characters long`
          );
        } else {
          sanitizedData[field] = sanitized;
        }
      }

      // Validate email fields
      else if (rules.type === "email") {
        if (!this.isValidEmail(value)) {
          errors.push(`${field} must be a valid email address`);
        } else {
          sanitizedData[field] = value.trim().toLowerCase();
        }
      }

      // Validate number fields
      else if (rules.type === "number") {
        const num = Number(value);
        if (isNaN(num)) {
          errors.push(`${field} must be a valid number`);
        } else if (rules.min !== undefined && num < rules.min) {
          errors.push(`${field} must be at least ${rules.min}`);
        } else if (rules.max !== undefined && num > rules.max) {
          errors.push(`${field} must be at most ${rules.max}`);
        } else {
          sanitizedData[field] = num;
        }
      }

      // Validate boolean fields
      else if (rules.type === "boolean") {
        sanitizedData[field] = Boolean(value);
      }

      // Default: sanitize as string
      else {
        sanitizedData[field] = this.sanitizeString(value);
      }
    }

    return {
      isValid: errors.length === 0,
      message: errors.length > 0 ? errors.join(", ") : "Form data is valid",
      data: sanitizedData,
    };
  }
}

// Export validation schemas for common forms
export const ValidationSchemas = {
  LOGIN: {
    email: { type: "email", required: true },
    password: { type: "string", required: true, minLength: 1 },
  },

  SIGNUP: {
    email: { type: "email", required: true },
    password: { type: "string", required: true, minLength: 8 },
    confirmPassword: { type: "string", required: true, minLength: 8 },
  },

  MESSAGE: {
    type: { type: "string", required: true },
    data: { type: "string", required: false, maxLength: 10000 },
  },

  USAGE: {
    tokens: { type: "number", required: true, min: 0 },
    timestamp: { type: "number", required: true, min: 0 },
  },
};
