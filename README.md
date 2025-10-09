# Viberly AI - Browser Extension

<div align="center">
  <img src="assets/viberly-logo.svg" alt="Viberly AI" width="200" height="200">
  
  **Save and reuse your favorite prompts instantly inside Chrome, Firefox, and Safari.**
  
  [![Version](https://img.shields.io/badge/version-1.0.46-blue.svg)](https://github.com/your-org/viberly-extension)
  [![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
  [![Browser Support](https://img.shields.io/badge/browsers-Chrome%20%7C%20Firefox%20%7C%20Safari-orange.svg)](#browser-support)
</div>

## 🚀 Features

### 🎯 Core Functionality

- **Prompt Management**: Save, organize, and reuse your favorite AI prompts across all supported platforms
- **Cross-Platform Support**: Works seamlessly on Chrome, Firefox, and Safari
- **Smart Highlighting**: Select text and save it as a prompt with one click
- **Slash Commands**: Quick access to prompts using `/` commands
- **AI Chat Integration**: Built-in AI chat interface for enhanced productivity

### 🛡️ Advanced Features

- **Prompt Protection**: Secure your prompts with built-in protection mechanisms
- **Screenshot Capture**: Capture and annotate screenshots for better context
- **Usage Analytics**: Track your prompt usage and productivity metrics
- **Custom Guards**: Create custom protection rules for your prompts
- **Real-time Sync**: Your prompts sync across all your devices

### 🎨 User Interface

- **HUD (Heads-Up Display)**: Clean, non-intrusive interface that appears when needed
- **Quick Menu**: Fast access to all your saved prompts
- **Settings Panel**: Customize your experience with comprehensive settings
- **Dark Theme**: Beautiful dark theme optimized for developer workflows

## 🌐 Supported Platforms

Viberly works on all major AI and development platforms:

### AI Platforms

- **OpenAI**: ChatGPT, GPT-4, DALL-E
- **Google**: Gemini, Bard
- **Anthropic**: Claude
- **Perplexity**: AI search and chat
- **DeepSeek**: AI coding assistant
- **Mistral**: AI chat platform
- **Grok**: X.ai AI assistant

### Development Platforms

- **Lovable**: AI-powered development platform
- **Replit**: Online IDE and coding environment
- **Bolt**: AI development tools
- **v0.dev**: Vercel's AI-powered UI generator
- **Figma**: Design and prototyping
- **Canva**: Design platform
- **Bubble**: No-code development

### Other Platforms

- **Notion**: Productivity and note-taking
- **Airtable**: Database and workflow management
- **ClickUp**: Project management
- **Zapier**: Automation platform
- **Framer**: Design and prototyping
- **Gamma**: AI-powered presentations

## 📦 Installation

### Chrome Web Store

1. Visit the [Chrome Web Store](https://chrome.google.com/webstore) (coming soon)
2. Search for "Viberly AI"
3. Click "Add to Chrome"

### Firefox Add-ons

1. Visit [Firefox Add-ons](https://addons.mozilla.org) (coming soon)
2. Search for "Viberly AI"
3. Click "Add to Firefox"

### Safari App Store

1. Visit the [Safari App Store](https://apps.apple.com) (coming soon)
2. Search for "Viberly AI"
3. Click "Install"

### Manual Installation (Development)

1. **Clone the repository**

   ```bash
   git clone https://github.com/your-org/viberly-extension.git
   cd viberly-extension
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Load the extension**
   - **Chrome**: Go to `chrome://extensions/`, enable "Developer mode", click "Load unpacked", select the extension folder
   - **Firefox**: Go to `about:debugging`, click "This Firefox", click "Load Temporary Add-on", select `manifest.json`
   - **Safari**: Open Safari Preferences → Advanced → Show Develop menu, then Develop → Show Extension Builder

## 🎯 Quick Start

### 1. First Launch

1. Click the Viberly icon in your browser toolbar
2. Sign up or log in to your Viberly account
3. Start using prompts immediately!

### 2. Saving Your First Prompt

1. Navigate to any supported AI platform
2. Select text you want to save as a prompt
3. Click the "Save to Viberly" pill that appears
4. Add a title and description
5. Your prompt is now saved and ready to reuse!

### 3. Using Slash Commands

1. In any text input field on supported platforms
2. Type `/` to open the command palette
3. Search for your saved prompts
4. Press Enter to insert the prompt

### 4. AI Chat Integration

1. Use the slash command `/chat` to open the AI chat interface
2. Have conversations with AI directly in your browser
3. Save important parts of conversations as prompts

## 🛠️ Development

### Prerequisites

- Node.js 16+
- npm or yarn
- Git

### Setup Development Environment

1. **Clone and install**

   ```bash
   git clone https://github.com/your-org/viberly-extension.git
   cd viberly-extension
   npm install
   ```

2. **Environment Configuration**

   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Build the extension**

   ```bash
   npm run build
   ```

4. **Load in browser**
   - Follow the manual installation steps above
   - The extension will auto-reload when you make changes

### Project Structure

```
viberly-extension/
├── assets/                 # Icons and images
├── src/
│   ├── core/              # Core functionality
│   │   ├── prompt-protect.js
│   │   ├── reposition.js
│   │   └── utils.js
│   ├── ui/                # User interface components
│   │   ├── ai-chat.js
│   │   ├── hud.js
│   │   ├── quickmenu.js
│   │   ├── slashcommands.js
│   │   └── settings.js
│   ├── sites/             # Platform-specific integrations
│   │   ├── generic.js
│   │   ├── lovable.js
│   │   └── replit.js
│   └── usage/             # Analytics and tracking
│       ├── counter.js
│       └── tokencounter.js
├── supabase/              # Backend functions
│   └── functions/
├── vendor/                # Third-party libraries
├── background.js          # Service worker
├── content.js            # Content script
├── manifest.json         # Extension manifest
└── popup.html            # Extension popup
```

### Key Technologies

- **Manifest V3**: Latest Chrome extension standard
- **Browser Polyfill**: Cross-browser compatibility
- **Supabase**: Backend-as-a-Service for data and auth
- **Stripe**: Payment processing
- **OpenAI API**: AI chat integration
- **GPT Tokenizer**: Token counting and management

### Development Guidelines

We follow the [Vibe Coder Rules](VIBE_CODER_RULES.md) for consistent, maintainable code:

- ✅ Use `browser` API instead of `chrome` for cross-browser support
- ✅ Prefer promises over callbacks
- ✅ Implement proper error handling
- ✅ Write descriptive variable names
- ✅ Use consistent logging patterns

## 🔧 Configuration

### Environment Variables

Create a `.env` file in the root directory:

```env
# Supabase Configuration
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key

# Stripe Configuration
STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key
```

### Feature Flags

Control features via browser storage:

```javascript
// Enable/disable features
browser.storage.local.set({
  vg_feat_screenshot: true,
  vg_feat_ai_chat: true,
  vg_feat_analytics: false,
});
```

## 📊 Usage Analytics

Viberly tracks usage to improve the product:

- **Prompt Usage**: Which prompts are used most frequently
- **Platform Usage**: Which AI platforms you use most
- **Feature Adoption**: Which features are most valuable
- **Performance Metrics**: Load times and error rates

All data is anonymized and used only to improve the product.

## 🔒 Privacy & Security

### Data Collection

- **Prompts**: Stored securely in Supabase with encryption
- **Usage Data**: Anonymized analytics for product improvement
- **Authentication**: Secure OAuth flow with Supabase

### Data Protection

- All data is encrypted in transit and at rest
- No personal data is shared with third parties
- Users can delete their data at any time
- GDPR and CCPA compliant

### Permissions

- **Storage**: Save your prompts and settings
- **Scripting**: Inject UI components on supported sites
- **Tabs**: Access current tab information for context
- **Clipboard**: Copy prompts to clipboard

## 🚀 Deployment

### Chrome Web Store

1. Build the extension: `npm run build`
2. Create a zip file of the `dist` folder
3. Upload to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)

### Firefox Add-ons

1. Build the extension: `npm run build`
2. Create a zip file of the `dist` folder
3. Upload to [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers)

### Safari App Store

1. Build the extension: `npm run build`
2. Package for Safari using Xcode
3. Submit to [Safari App Store](https://developer.apple.com/safari/extensions/)

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes following our [Vibe Coder Rules](VIBE_CODER_RULES.md)
4. Test across all supported browsers
5. Commit your changes: `git commit -m 'Add amazing feature'`
6. Push to the branch: `git push origin feature/amazing-feature`
7. Open a Pull Request

### Code Style

- Follow the [Vibe Coder Rules](VIBE_CODER_RULES.md)
- Use meaningful variable names
- Add comments for complex logic
- Write tests for new features
- Ensure cross-browser compatibility

## 📝 Changelog

### Version 1.0.46

- Initial release
- Core prompt management functionality
- Cross-browser support (Chrome, Firefox, Safari)
- AI chat integration
- Screenshot capture
- Usage analytics
- Custom guards and protection

## 🐛 Bug Reports

Found a bug? Please report it:

1. Check existing [Issues](https://github.com/your-org/viberly-extension/issues)
2. Create a new issue with:
   - Browser and version
   - Steps to reproduce
   - Expected vs actual behavior
   - Screenshots if applicable

## 💡 Feature Requests

Have an idea? We'd love to hear it:

1. Check existing [Feature Requests](https://github.com/your-org/viberly-extension/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement)
2. Create a new issue with the `enhancement` label
3. Describe the feature and its benefits

## 📞 Support

Need help? We're here for you:

- **Documentation**: [docs.viberly.ai](https://docs.viberly.ai)
- **Community**: [Discord](https://discord.gg/viberly)
- **Email**: support@viberly.ai
- **Twitter**: [@viberly_ai](https://twitter.com/viberly_ai)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Supabase](https://supabase.com) for the backend infrastructure
- [OpenAI](https://openai.com) for AI capabilities
- [Stripe](https://stripe.com) for payment processing
- [Browser Extension Polyfill](https://github.com/mozilla/webextension-polyfill) for cross-browser compatibility
- All our amazing users and contributors!

---

<div align="center">
  <p>Made with ❤️ by the Viberly team</p>
  <p>
    <a href="https://viberly.ai">Website</a> •
    <a href="https://docs.viberly.ai">Docs</a> •
    <a href="https://discord.gg/viberly">Community</a> •
    <a href="https://twitter.com/viberly_ai">Twitter</a>
  </p>
</div>
