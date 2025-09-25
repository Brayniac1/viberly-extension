// src/ui/icons.js
export const VG_ICON_ACTIVE = chrome.runtime.getURL('assets/active pill.svg');
export const VG_ICON_IDLE   = chrome.runtime.getURL('assets/inactive pill.svg');
export const iconForState = (signedIn) => (signedIn ? VG_ICON_ACTIVE : VG_ICON_IDLE);

