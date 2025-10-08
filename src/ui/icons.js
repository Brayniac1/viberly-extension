// src/ui/icons.js
export const VG_ICON_ACTIVE = browser.runtime.getURL("assets/active pill.svg");
export const VG_ICON_IDLE = browser.runtime.getURL("assets/inactive pill.svg");
export const iconForState = (signedIn) =>
  signedIn ? VG_ICON_ACTIVE : VG_ICON_IDLE;
