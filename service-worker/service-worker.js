/**
 * @typedef {import('../types/types.js').StoredGroup} StoredGroup
 */

import { organiseTab, arrangeTabGroups } from '../shared/tab-grouper.js';

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

    // Call the organiseTab function to handle the tab grouping logic
    await organiseTab(updatedTabId, updatedTab);

    // Arrange tab groups after the tab has been organised
    await arrangeTabGroups(updatedTab.windowId);
});
