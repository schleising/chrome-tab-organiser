/**
 * @typedef {import('../types/types.js').StoredGroup} StoredGroup
 */

import { organiseTab, arrangeTabGroups, getStoredGroups } from '../shared/tab-grouper.js';

const ARRANGE_DEBOUNCE_MS = 220;
const arrangeTimers = new Map();

function scheduleArrangeTabGroups(windowId) {
    const existingTimer = arrangeTimers.get(windowId);
    if (existingTimer) {
        clearTimeout(existingTimer);
    }

    const timerId = setTimeout(async () => {
        arrangeTimers.delete(windowId);
        try {
            await arrangeTabGroups(windowId);
        } catch (error) {
            console.error(`Error arranging tab groups for window ${windowId}:`, error);
        }
    }, ARRANGE_DEBOUNCE_MS);

    arrangeTimers.set(windowId, timerId);
}

chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        // Open the options page when the extension is installed
        await chrome.runtime.openOptionsPage();
    }
});

// Add a listener for tab updates
chrome.tabs.onUpdated.addListener(async (updatedTabId, changeInfo, updatedTab) => {
    if (changeInfo.status !== 'complete') {
        return;
    }

    // If the tab is closing, we do not want to organise it
    try {
        await chrome.tabs.get(updatedTabId);
    } catch {
        // If the tab is not found, it means it is closing or has been closed
        return;
    }

    if (!updatedTab.url) {
        return;
    }

    // Skip any chrome: tabs
    try {
        if (new URL(updatedTab.url).protocol === 'chrome:') {
            return;
        }
    } catch {
        return;
    }

    // Get the window type to ensure we are only processing tabs in a normal window
    const windowInfo = await chrome.windows.get(updatedTab.windowId);
    if (windowInfo.type !== 'normal') {
        // If the window is not normal, we do not want to group the tab, so return
        return;
    }

    const storedGroups = await getStoredGroups();
    if (storedGroups.length === 0) {
        return;
    }

    // Call the organiseTab function to handle the tab grouping logic
    await organiseTab(updatedTabId, updatedTab, storedGroups);

    // Arrange tab groups after updates settle to avoid repeated churn.
    scheduleArrangeTabGroups(updatedTab.windowId);
});
