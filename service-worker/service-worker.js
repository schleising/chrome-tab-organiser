/**
 * @typedef {import('../types/types.js').StoredGroup} StoredGroup
 */

import { organiseTab, arrangeTabGroups } from '../shared/tab-grouper.js';

chrome.runtime.onInstalled.addListener(async (details) => {
    // Log the installation event
    console.log("Extension installed.");

    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        // Open the options page when the extension is installed
        await chrome.runtime.openOptionsPage();
    }
});

// Add a listener for tab updates
chrome.tabs.onUpdated.addListener(async (updatedTabId, changeInfo, updatedTab) => {
    // Check if the updated tab is the one we are interested in
    if (changeInfo.status === 'complete') {
        // If the tab is closing, we do not want to organise it
        try {
            await chrome.tabs.get(updatedTabId);
        } catch (error) {
            // If the tab is not found, it means it is closing or has been closed
            return;
        }

        // Skip any chrome: tabs
        if (new URL(updatedTab.url).protocol === 'chrome:') {
            return;
        }

        // Get the window type to ensure we are only processing tabs in a normal window
        const window = await chrome.windows.get(updatedTab.windowId);
        if (window.type !== 'normal') {
            // If the window is not normal, we do not want to group the tab, so return
            return;
        }

        // Call the organiseTab function to handle the tab grouping logic
        await organiseTab(updatedTabId, updatedTab);

        // Arrange tab groups after the tab has been organised
        await arrangeTabGroups(updatedTab.windowId);
    }
});
