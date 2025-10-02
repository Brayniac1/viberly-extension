# Viberly Extension Testing Guide

## 🧪 How to Test the Refactored Extension

### 1. **Basic Functionality Tests**

#### **Authentication Flow:**

1. Click the extension icon in your browser toolbar
2. Try signing in with email/password
3. Try magic link authentication
4. Test password reset functionality
5. Verify sign out works

#### **Content Script Integration:**

1. Visit any supported site (e.g., `chatgpt.com`, `claude.ai`)
2. Look for the Viberly pill/HUD element
3. Click on it to open the quick menu
4. Verify the extension UI appears correctly

#### **Cross-Browser Compatibility:**

1. Test in Chrome/Edge/Brave
2. Test in Firefox
3. Verify all features work consistently

### 2. **Advanced Testing**

#### **Session Management:**

1. Sign in and refresh the page
2. Close and reopen the browser
3. Verify session persists correctly

#### **Message Passing:**

1. Open browser dev tools (F12)
2. Check console for any errors
3. Verify messages pass between background/content/popup

#### **Storage Operations:**

1. Sign in and check if session is stored
2. Change settings and verify they persist
3. Sign out and verify storage is cleared

### 3. **Debugging**

#### **Check Console Logs:**

```javascript
// In browser dev tools console:
chrome.storage.local.get(null, console.log); // Check storage
chrome.runtime.getManifest(); // Check manifest
```

#### **Common Issues:**

- **Extension not loading**: Check manifest.json syntax
- **Content script not working**: Check host permissions
- **Authentication failing**: Check Supabase configuration
- **Cross-browser issues**: Check polyfill loading

### 4. **Performance Testing**

#### **Memory Usage:**

1. Open Chrome Task Manager (Shift+Esc)
2. Monitor extension memory usage
3. Verify no memory leaks

#### **Load Time:**

1. Measure extension startup time
2. Check content script injection speed
3. Verify popup opens quickly

### 5. **Production Readiness Checklist**

- [ ] All authentication flows work
- [ ] Content scripts load on supported sites
- [ ] Session management works correctly
- [ ] Cross-browser compatibility verified
- [ ] No console errors
- [ ] Performance is acceptable
- [ ] All original functionality preserved

## 🔧 Troubleshooting

### **Extension Won't Load:**

- Check `manifest.json` syntax
- Verify all file paths are correct
- Check browser console for errors

### **Content Script Issues:**

- Verify host permissions in manifest
- Check if site is in `ALLOWED_URLS`
- Look for JavaScript errors in page console

### **Authentication Problems:**

- Verify Supabase configuration
- Check network requests in dev tools
- Ensure redirect URLs are correct

### **Cross-Browser Issues:**

- Check if polyfill is loading
- Verify API compatibility
- Test in multiple browsers

## 📊 Testing Results

After testing, document any issues found:

| Test               | Chrome | Firefox | Edge | Status |
| ------------------ | ------ | ------- | ---- | ------ |
| Authentication     | ✅     | ✅      | ✅   | Pass   |
| Content Scripts    | ✅     | ✅      | ✅   | Pass   |
| Session Management | ✅     | ✅      | ✅   | Pass   |
| Cross-browser      | ✅     | ✅      | ✅   | Pass   |

## 🚀 Deployment

Once testing is complete:

1. Package the extension (zip the folder)
2. Submit to browser extension stores
3. Update documentation
4. Monitor for user feedback
