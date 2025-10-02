# Viberly Extension - Refactored Architecture

This document describes the refactored, modular architecture of the Viberly browser extension.

## Overview

The extension has been completely refactored to follow modern JavaScript best practices, provide cross-browser compatibility, and maintain a clean, modular structure.

## Architecture

### Core Principles

1. **Modular Design**: Each functionality is separated into its own module
2. **Cross-Browser Compatibility**: Uses webextension-polyfill for Chrome, Firefox, Edge, Brave, Opera
3. **Modern JavaScript**: ES2023+ features, async/await, proper error handling
4. **Type Safety**: JSDoc comments and validation utilities
5. **Maintainability**: Clear separation of concerns and reusable utilities

### Directory Structure

```
src/
├── constants.js              # Centralized configuration and constants
├── utils/                    # Shared utility modules
│   ├── index.js             # Utility exports
│   ├── logger.js            # Logging system
│   ├── storage.js           # Storage management
│   ├── messaging.js         # Inter-script communication
│   ├── dom.js               # DOM manipulation utilities
│   ├── validation.js        # Data validation
│   ├── supabase.js          # Supabase client management
│   └── polyfill.js          # Cross-browser compatibility
├── background/               # Background script modules
│   ├── index.js             # Main background script
│   ├── access-control.js    # User access and permissions
│   ├── session-manager.js   # Authentication and session management
│   └── message-handler.js   # Message routing and handling
├── content/                  # Content script modules
│   └── content-manager.js   # Content script coordination
├── popup/                    # Popup UI modules
│   └── popup-manager.js     # Popup state and interactions
├── ui/                       # UI components (existing)
└── sites/                    # Site-specific logic (existing)
```

## Key Features

### 1. Cross-Browser Compatibility

- **WebExtension Polyfill**: Automatic detection and polyfill for Chrome/Firefox APIs
- **Manifest V3**: Primary support with V2 fallback considerations
- **Unified API**: Single interface for all browser APIs

### 2. Modular Architecture

- **Background Script**: Separated into access control, session management, and message handling
- **Content Scripts**: Centralized management with dynamic module loading
- **Popup**: State management and UI interactions separated from business logic

### 3. Modern JavaScript

- **ES Modules**: Native import/export syntax
- **Async/Await**: Consistent asynchronous programming
- **Error Handling**: Comprehensive error catching and logging
- **Validation**: Input validation and sanitization

### 4. Developer Experience

- **Logging System**: Configurable log levels and structured logging
- **Type Safety**: JSDoc comments and runtime validation
- **Debugging**: Comprehensive debug utilities and error reporting

## Usage

### Installation

1. Install dependencies:

   ```bash
   npm install
   ```

2. Load the extension in your browser:
   - Chrome: Load unpacked extension from the project directory
   - Firefox: Load temporary add-on from the project directory

### Development

1. **Background Script**: Edit files in `src/background/`
2. **Content Scripts**: Edit files in `src/content/` and `src/ui/`
3. **Popup**: Edit files in `src/popup/`
4. **Utilities**: Edit files in `src/utils/`

### Configuration

All configuration is centralized in `src/constants.js`:

- Extension metadata
- Supabase configuration
- Storage keys
- Message types
- UI selectors
- Feature flags

## API Reference

### Utilities

#### Logger

```javascript
import { logger } from "./src/utils/index.js";

logger.info("Information message");
logger.error("Error message");
logger.debug("Debug message");
```

#### Storage

```javascript
import { storage } from "./src/utils/index.js";

await storage.set({ key: "value" });
const data = await storage.get("key");
```

#### Messaging

```javascript
import { messaging } from "./src/utils/index.js";

// Send message
const response = await messaging.sendMessage({
  type: "MESSAGE_TYPE",
  data: "value",
});

// Add listener
const removeListener = messaging.addListener((message) => {
  // Handle message
});
```

#### DOM Utilities

```javascript
import { UIDOMUtils } from "./src/utils/index.js";

UIDOMUtils.setTextById("elementId", "text");
UIDOMUtils.toggleVisibility(element, true);
```

### Background Script

#### Access Control

```javascript
import { accessControl } from "./src/background/access-control.js";

// Check if user access is blocked
const result = await accessControl.gateIfBlocked("MESSAGE_TYPE", sender);
```

#### Session Management

```javascript
import { backgroundSessionManager } from "./src/background/session-manager.js";

// Get current session
const session = backgroundSessionManager.getCurrentSession();
```

### Content Script

#### Content Manager

```javascript
import { contentScriptManager } from "./src/content/content-manager.js";

// Initialize content script
await contentScriptManager.initialize();
```

### Popup

#### Popup Manager

```javascript
import { popupManager } from "./src/popup/popup-manager.js";

// Initialize popup
await popupManager.initialize();
```

## Migration Guide

### From Old Architecture

1. **Background Script**: Replace `background.js` with `background-new.js`
2. **Content Script**: Replace `content.js` with `content-new.js`
3. **Popup**: Replace `popup.js` with `popup-new.js`
4. **Manifest**: Use `manifest-new.json`

### Breaking Changes

1. **Module System**: All scripts now use ES modules
2. **API Changes**: Some internal APIs have been refactored
3. **Error Handling**: Improved error handling may change behavior
4. **Logging**: New logging system replaces console.log statements

## Testing

### Unit Tests

```bash
npm test
```

### Integration Tests

```bash
npm run test:integration
```

### Linting

```bash
npm run lint
```

## Browser Support

- **Chrome**: 88+
- **Firefox**: 78+
- **Edge**: 88+
- **Brave**: 1.0+
- **Opera**: 74+

## Performance

### Optimizations

1. **Lazy Loading**: Modules are loaded only when needed
2. **Efficient Storage**: Optimized storage operations
3. **Memory Management**: Proper cleanup and garbage collection
4. **Bundle Size**: Minimal bundle size with tree shaking

### Monitoring

- **Performance Metrics**: Built-in performance monitoring
- **Error Tracking**: Comprehensive error logging
- **Usage Analytics**: Optional usage tracking

## Security

### Best Practices

1. **Input Validation**: All inputs are validated and sanitized
2. **CSP Compliance**: Content Security Policy compliance
3. **Secure Storage**: Sensitive data is properly encrypted
4. **Permission Management**: Minimal required permissions

### Security Features

- **Session Management**: Secure session handling
- **Access Control**: User permission validation
- **Data Sanitization**: Input/output sanitization
- **Error Handling**: Secure error reporting

## Contributing

### Code Style

- **ESLint**: Follow ESLint configuration
- **Prettier**: Use Prettier for formatting
- **JSDoc**: Document all public APIs
- **TypeScript**: Consider TypeScript for future versions

### Pull Requests

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

- **Documentation**: [docs.viberly.ai](https://docs.viberly.ai)
- **Issues**: [GitHub Issues](https://github.com/viberly/viberly-extension/issues)
- **Discord**: [Viberly Discord](https://discord.gg/viberly)
