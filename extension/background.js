/**
 * background.js — service worker. Turns "this tab is showing a login" into
 * a badge on the toolbar icon.
 *
 * The badge is the whole notification: one quiet dot per tab, not an OS
 * popup on every sign-in page. Clicking it opens the popup, which is where
 * anything actually happens.
 */

const BADGE = "●";
const BADGE_COLOUR = "#7C9CFF";

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "detect") return false;
  const tabId = sender.tab && sender.tab.id;
  if (tabId === undefined) return false;
  chrome.action.setBadgeText({ tabId, text: msg.login ? BADGE : "" });
  if (msg.login) {
    chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOUR });
  }
  return false;
});
