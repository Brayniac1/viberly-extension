/**
 * DOM utility functions for Viberly Extension
 * Provides cross-browser compatible DOM manipulation and querying
 */

import { UI_SELECTORS, CSS_CLASSES } from "../constants.js";
import { logger } from "./logger.js";

/**
 * DOM utility class for common DOM operations
 */
export class DOMUtils {
  /**
   * Get element by ID
   * @param {string} id - Element ID
   * @returns {HTMLElement|null} Element or null
   */
  static getElementById(id) {
    try {
      return document.getElementById(id);
    } catch (error) {
      logger.error("getElementById error:", error);
      return null;
    }
  }

  /**
   * Query selector
   * @param {string} selector - CSS selector
   * @param {Element} parent - Parent element (default: document)
   * @returns {Element|null} Element or null
   */
  static querySelector(selector, parent = document) {
    try {
      return parent.querySelector(selector);
    } catch (error) {
      logger.error("querySelector error:", error);
      return null;
    }
  }

  /**
   * Query selector all
   * @param {string} selector - CSS selector
   * @param {Element} parent - Parent element (default: document)
   * @returns {NodeList} Elements
   */
  static querySelectorAll(selector, parent = document) {
    try {
      return parent.querySelectorAll(selector);
    } catch (error) {
      logger.error("querySelectorAll error:", error);
      return [];
    }
  }

  /**
   * Create element with attributes and content
   * @param {string} tagName - HTML tag name
   * @param {Object} attributes - Element attributes
   * @param {string|Node} content - Element content
   * @returns {HTMLElement} Created element
   */
  static createElement(tagName, attributes = {}, content = "") {
    try {
      const element = document.createElement(tagName);

      // Set attributes
      Object.entries(attributes).forEach(([key, value]) => {
        if (key === "className") {
          element.className = value;
        } else if (key === "innerHTML") {
          element.innerHTML = value;
        } else if (key === "textContent") {
          element.textContent = value;
        } else {
          element.setAttribute(key, value);
        }
      });

      // Set content
      if (content) {
        if (typeof content === "string") {
          element.textContent = content;
        } else if (content instanceof Node) {
          element.appendChild(content);
        }
      }

      return element;
    } catch (error) {
      logger.error("createElement error:", error);
      return document.createElement(tagName);
    }
  }

  /**
   * Add event listener with error handling
   * @param {Element} element - Target element
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   * @param {Object} options - Event options
   * @returns {Function} Remove listener function
   */
  static addEventListener(element, event, handler, options = {}) {
    if (!element) return () => {};

    try {
      const wrappedHandler = (e) => {
        try {
          handler(e);
        } catch (error) {
          logger.error(`Event handler error for ${event}:`, error);
        }
      };

      element.addEventListener(event, wrappedHandler, options);

      return () => {
        element.removeEventListener(event, wrappedHandler, options);
      };
    } catch (error) {
      logger.error("addEventListener error:", error);
      return () => {};
    }
  }

  /**
   * Remove element from DOM
   * @param {Element} element - Element to remove
   */
  static removeElement(element) {
    if (!element) return;

    try {
      element.remove();
    } catch (error) {
      logger.error("removeElement error:", error);
    }
  }

  /**
   * Show/hide element
   * @param {Element} element - Target element
   * @param {boolean} show - Whether to show element
   */
  static toggleVisibility(element, show) {
    if (!element) return;

    try {
      element.style.display = show ? "" : "none";
      element.setAttribute("aria-hidden", show ? "false" : "true");
    } catch (error) {
      logger.error("toggleVisibility error:", error);
    }
  }

  /**
   * Add/remove CSS class
   * @param {Element} element - Target element
   * @param {string} className - CSS class name
   * @param {boolean} add - Whether to add or remove class
   */
  static toggleClass(element, className, add) {
    if (!element) return;

    try {
      if (add) {
        element.classList.add(className);
      } else {
        element.classList.remove(className);
      }
    } catch (error) {
      logger.error("toggleClass error:", error);
    }
  }

  /**
   * Set element text content safely
   * @param {Element} element - Target element
   * @param {string} text - Text content
   */
  static setTextContent(element, text) {
    if (!element) return;

    try {
      element.textContent = text || "";
    } catch (error) {
      logger.error("setTextContent error:", error);
    }
  }

  /**
   * Set element HTML content safely
   * @param {Element} element - Target element
   * @param {string} html - HTML content
   */
  static setHTMLContent(element, html) {
    if (!element) return;

    try {
      element.innerHTML = html || "";
    } catch (error) {
      logger.error("setHTMLContent error:", error);
    }
  }

  /**
   * Get element bounding rectangle
   * @param {Element} element - Target element
   * @returns {DOMRect} Bounding rectangle
   */
  static getBoundingRect(element) {
    if (!element) return { left: 0, top: 0, width: 0, height: 0 };

    try {
      return element.getBoundingClientRect();
    } catch (error) {
      logger.error("getBoundingRect error:", error);
      return { left: 0, top: 0, width: 0, height: 0 };
    }
  }

  /**
   * Check if element is visible
   * @param {Element} element - Target element
   * @returns {boolean} Whether element is visible
   */
  static isVisible(element) {
    if (!element) return false;

    try {
      const style = window.getComputedStyle(element);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      );
    } catch (error) {
      logger.error("isVisible error:", error);
      return false;
    }
  }

  /**
   * Find active form element
   * @returns {Element|null} Active form element
   */
  static findActiveFormElement() {
    try {
      const activeElement = document.activeElement;

      if (
        activeElement &&
        (activeElement.isContentEditable ||
          activeElement.tagName === "TEXTAREA" ||
          activeElement.tagName === "INPUT")
      ) {
        return activeElement;
      }

      // Fallback: find common form elements
      return (
        document.querySelector('[contenteditable="true"]') ||
        document.querySelector("textarea") ||
        document.querySelector('input[type="text"], input[type="search"]') ||
        document.body
      );
    } catch (error) {
      logger.error("findActiveFormElement error:", error);
      return document.body;
    }
  }

  /**
   * Insert text at cursor position
   * @param {Element} element - Target element
   * @param {string} text - Text to insert
   */
  static insertTextAtCursor(element, text) {
    if (!element || !text) return;

    try {
      if (element.isContentEditable) {
        // ContentEditable element
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(text));
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      } else if (
        element.tagName === "TEXTAREA" ||
        element.tagName === "INPUT"
      ) {
        // Textarea or input element
        const start = element.selectionStart || 0;
        const end = element.selectionEnd || 0;
        const value = element.value || "";

        element.value = value.slice(0, start) + text + value.slice(end);
        element.selectionStart = element.selectionEnd = start + text.length;

        // Trigger input event
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } catch (error) {
      logger.error("insertTextAtCursor error:", error);
    }
  }

  /**
   * Create and dispatch custom event
   * @param {string} eventName - Event name
   * @param {Object} detail - Event detail
   * @param {Element} target - Target element (default: document)
   */
  static dispatchCustomEvent(eventName, detail = {}, target = document) {
    try {
      const event = new CustomEvent(eventName, {
        detail,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
    } catch (error) {
      logger.error("dispatchCustomEvent error:", error);
    }
  }
}

/**
 * UI-specific DOM utilities
 */
export class UIDOMUtils extends DOMUtils {
  /**
   * Set text content by ID
   * @param {string} id - Element ID
   * @param {string} text - Text content
   */
  static setTextById(id, text) {
    const element = this.getElementById(id);
    this.setTextContent(element, text);
  }

  /**
   * Set HTML state classes on document element
   * @param {boolean} signedIn - Whether user is signed in
   */
  static setHTMLState(signedIn) {
    try {
      const html = document.documentElement;
      this.toggleClass(html, CSS_CLASSES.SIGNED_IN, signedIn);
      this.toggleClass(html, CSS_CLASSES.SIGNED_OUT, !signedIn);
    } catch (error) {
      logger.error("setHTMLState error:", error);
    }
  }

  /**
   * Show/hide auth message
   * @param {string} text - Message text
   * @param {string} type - Message type ('ok' or 'err')
   */
  static showAuthMessage(text, type = "err") {
    const element = this.getElementById(UI_SELECTORS.AUTH_MESSAGE);
    if (!element) return;

    this.setTextContent(element, text || "");
    this.toggleClass(element, CSS_CLASSES.MESSAGE_SUCCESS, type === "ok");
    this.toggleClass(element, CSS_CLASSES.MESSAGE_ERROR, type === "err");
    this.toggleVisibility(element, !!text);
  }

  /**
   * Clear auth message
   */
  static clearAuthMessage() {
    this.showAuthMessage("");
  }

  /**
   * Lock/unlock form element
   * @param {Element} element - Target element
   * @param {boolean} locked - Whether to lock element
   */
  static lockElement(element, locked = true) {
    if (!element) return;

    try {
      element.disabled = locked;
      element.style.opacity = locked ? "0.7" : "1";
    } catch (error) {
      logger.error("lockElement error:", error);
    }
  }

  /**
   * Set auth mode
   * @param {string} mode - Auth mode ('login' or 'default')
   */
  static setAuthMode(mode) {
    const element = this.getElementById(UI_SELECTORS.AUTH_VIEW);
    if (!element) return;

    element.dataset.mode = mode === "login" ? "login" : "default";
  }
}

// Export both classes
export { DOMUtils };
