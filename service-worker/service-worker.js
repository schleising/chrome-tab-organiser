/**
 * @typedef {import('../types/types.js').StoredGroup} StoredGroup
 */

import { organiseTab, arrangeTabGroups } from '../shared/tab-grouper.js';

chrome.runtime.onInstalled.addListener(async () => {
    // Remove any existing listeners to avoid duplicates
    chrome.tabs.onUpdated.removeListener();

    // Log the installation event
    console.log("Extension installed.");
});

// Add a listener for tab updates
chrome.tabs.onUpdated.addListener(async (updatedTabId, changeInfo, updatedTab) => {
    // Check if the updated tab is the one we are interested in
    if (changeInfo.status === 'complete') {
        // Call the organiseTab function to handle the tab grouping logic
        await organiseTab(updatedTabId, updatedTab);

        // Arrange tab groups after the tab has been organised
        await arrangeTabGroups();
    }
});
