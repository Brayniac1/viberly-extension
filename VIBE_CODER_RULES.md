# Vibe Coder Rules for Polyfill Development

## Core Philosophy

Write code that works everywhere, feels natural, and doesn't break the vibe. These rules ensure your code runs smoothly across Chrome, Firefox, Safari, and Edge while maintaining clean, readable patterns.

## Browser API Rules

### 1. Always Use `browser` Instead of `chrome`

```javascript
// VIBE: Use browser API (works everywhere)
browser.storage.local.get("key").then((result) => {
  console.log(result);
});

// ANTI-VIBE: Chrome-specific (breaks in Firefox/Safari)
chrome.storage.local.get("key", (result) => {
  console.log(result);
});
```

### 2. Promise-Based Patterns Over Callbacks

```javascript
// VIBE: Modern promise chains
browser.storage.local
  .get("key")
  .then((result) => {
    console.log(result);
    return browser.tabs.query({ active: true });
  })
  .then((tabs) => {
    console.log(tabs[0]);
  })
  .catch((error) => {
    console.error("Something went wrong:", error);
  });

// ANTI-VIBE: Callback hell
browser.storage.local.get("key", (result) => {
  browser.tabs.query({ active: true }, (tabs) => {
    console.log(tabs[0]);
  });
});
```

### 3. Async/Await When It Makes Sense

```javascript
// VIBE: Clean async/await for complex flows
async function getActiveTabData() {
  try {
    const result = await browser.storage.local.get("key");
    const tabs = await browser.tabs.query({ active: true });
    return { storage: result, activeTab: tabs[0] };
  } catch (error) {
    console.error("Failed to get data:", error);
    return null;
  }
}

// VIBE: Simple promise chains for straightforward operations
browser.storage.local.get("key").then((result) => console.log(result));
```

## 🔧 Polyfill Integration Rules

### 4. Always Import Polyfill First

#### For Chrome

```javascript
// VIBE: Polyfill at the top background.js
importScripts("./vendor/browser-polyfill.js");
importScripts("./vendor/supabase.umd.js");

// Your code here...
```

#### For FireFox/ Safari

```json
// VIBE: Polyfill at the Manifest.json
  "background": {
    "scripts": [
      "vendor/browser-polyfill.js",
      "vendor/supabase.umd.js",
      "background.js"
    ]
  },

// Your code here...
```

### 5. Feature Detection Over Browser Sniffing

```javascript
// VIBE: Check for feature availability
if (typeof browser !== "undefined" && browser.storage) {
  // Use browser.storage
} else if (typeof chrome !== "undefined" && chrome.storage) {
  // Fallback to chrome
} else {
  console.warn("Storage API not available");
}

// ANTI-VIBE: Browser detection
if (navigator.userAgent.includes("Chrome")) {
  // This breaks when user agent changes
}
```

### 6. Graceful Degradation

```javascript
// VIBE: Handle missing APIs gracefully
function safeStorageGet(key, defaultValue = null) {
  if (typeof browser !== "undefined" && browser.storage) {
    return browser.storage.local
      .get(key)
      .then((result) => result[key] || defaultValue);
  }
  return Promise.resolve(defaultValue);
}
```

## Code Style Rules

### 7. Consistent Error Handling

```javascript
// VIBE: Consistent error patterns
browser.runtime
  .sendMessage({ type: "GET_DATA" })
  .then((response) => {
    if (response && response.success) {
      return response.data;
    }
    throw new Error("Invalid response format");
  })
  .catch((error) => {
    console.error("[VG] Message failed:", error);
    return null;
  });
```

### 8. Use Descriptive Variable Names

```javascript
// VIBE: Clear, descriptive names
const isUserSignedIn = await checkAuthStatus();
const activeTabInfo = await browser.tabs.query({
  active: true,
  currentWindow: true,
});

// ANTI-VIBE: Cryptic abbreviations
const auth = await checkAuth();
const tab = await browser.tabs.query({ active: true });
```

### 9. Consistent Logging Patterns

```javascript
// VIBE: Structured logging with prefixes
const vgLog = {
  error: (...args) => console.error("[VG]", ...args),
  warn: (...args) => console.warn("[VG]", ...args),
  info: (...args) => console.info("[VG]", ...args),
  debug: (...args) => console.debug("[VG]", ...args),
};

vgLog.info("Extension loaded successfully");
vgLog.error("Failed to connect to API:", error);
```

## Performance Rules

### 10. Lazy Loading and Code Splitting

```javascript
// VIBE: Load modules only when needed
async function loadFeatureModule() {
  if (!window.__VG_FEATURE_LOADED__) {
    await import(browser.runtime.getURL("src/features/advanced.js"));
    window.__VG_FEATURE_LOADED__ = true;
  }
}
```

### 11. Debounce User Interactions

```javascript
// VIBE: Prevent excessive API calls
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

const debouncedSave = debounce((data) => {
  browser.storage.local.set({ userData: data });
}, 300);
```

## Security Rules

### 12. Validate All External Data

```javascript
// VIBE: Always validate incoming messages
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Validate message structure
  if (!message || typeof message.type !== "string") {
    vgLog.warn("Invalid message received:", message);
    return;
  }

  // Validate sender
  if (!sender.tab && message.type !== "INTERNAL_MESSAGE") {
    vgLog.warn("Message from invalid sender:", sender);
    return;
  }

  // Process valid message
  handleMessage(message, sender, sendResponse);
});
```

### 13. Sanitize User Input

```javascript
// VIBE: Sanitize before storage
function sanitizeUserInput(input) {
  if (typeof input !== "string") return "";
  return input
    .replace(/[<>]/g, "") // Remove potential HTML
    .trim()
    .substring(0, 1000); // Limit length
}
```

## Testing Rules

### 14. Test Across All Target Browsers

```javascript
// VIBE: Browser-specific test patterns
function testBrowserCompatibility() {
  const tests = {
    storage: typeof browser !== "undefined" && !!browser.storage,
    tabs: typeof browser !== "undefined" && !!browser.tabs,
    runtime: typeof browser !== "undefined" && !!browser.runtime,
  };

  const failed = Object.entries(tests)
    .filter(([name, passed]) => !passed)
    .map(([name]) => name);

  if (failed.length > 0) {
    vgLog.error("Missing browser APIs:", failed);
  }
}
```

## Documentation Rules

### 15. Document Complex Polyfill Workarounds

```javascript
// VIBE: Explain why polyfill is needed
/**
 * Safari doesn't support chrome.storage.local in content scripts
 * so we use browser-polyfill to normalize the API
 */
async function getStoredData() {
  return browser.storage.local.get("key");
}
```

## Manifest Rules

### 16. Use Manifest V3 Features

```json
{
  "manifest_version": 3,
  "permissions": ["storage", "tabs", "activeTab"],
  "host_permissions": ["<all_urls>"],
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
}
```

## Migration Rules

### 17. Gradual Migration Strategy

```javascript
// VIBE: Support both old and new patterns during migration
function legacyCompatibleStorage() {
  // Try new API first
  if (typeof browser !== "undefined" && browser.storage) {
    return browser.storage.local;
  }

  // Fallback to chrome API
  if (typeof chrome !== "undefined" && chrome.storage) {
    return chrome.storage.local;
  }

  throw new Error("No storage API available");
}
```

## UI/UX Rules

### 18. Consistent UI Patterns

```javascript
// VIBE: Consistent UI state management
const UIState = {
  isVisible: false,
  isLoading: false,
  error: null,

  show() {
    this.isVisible = true;
    this.error = null;
    this.render();
  },

  hide() {
    this.isVisible = false;
    this.render();
  },

  setLoading(loading) {
    this.isLoading = loading;
    this.render();
  },
};
```

## Anti-Patterns to Avoid

### Don't Do These Things

```javascript
// ANTI-VIBE: Browser-specific code paths
if (navigator.userAgent.includes("Chrome")) {
  chrome.storage.local.get("key", callback);
} else {
  browser.storage.local.get("key").then(callback);
}

// ANTI-VIBE: Callback hell
browser.storage.local.get("key1", (result1) => {
  browser.storage.local.get("key2", (result2) => {
    browser.tabs.query({ active: true }, (tabs) => {
      // Nested nightmare
    });
  });
});

// ANTI-VIBE: Silent failures
browser.storage.local.get("key", (result) => {
  // What if this fails? No error handling
  processData(result);
});

// ANTI-VIBE: Inconsistent naming
const data = await browser.storage.local.get("user_data");
const userData = await browser.storage.local.get("userData"); // Different key format
```

## Vibe Check

Before committing code, ask yourself:

- Does this work in Chrome, Firefox, and Safari?
- Am I using promises instead of callbacks?
- Is my error handling consistent?
- Are my variable names clear and descriptive?
- Am I following the established patterns in the codebase?
- Is this code maintainable and readable?

Remember: Good vibe code is code that your future self (and your teammates) will thank you for writing. Keep it clean, keep it consistent, and keep it working everywhere! 🚀
