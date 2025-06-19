/**
 * @typedef {import('../types/types.js').StoredGroup} StoredGroup
 */

chrome.runtime.onInstalled.addListener(async () => {
    // Remove any existing listeners to avoid duplicates
    chrome.tabs.onUpdated.removeListener();

    // Log the installation event
    console.log("Extension installed.");
});

// Add a listener for tab updates
chrome.tabs.onUpdated.addListener(async (updatedTabId, changeInfo, updatedTab) => {
    console.log("Tab updated:", updatedTabId, changeInfo, updatedTab);
    // Check if the updated tab is the one we are interested in
    if (changeInfo.status === 'complete') {
        // Get the stored groups from local storage
        /** @type {StoredGroup[]} */
        let storedGroups = await chrome.storage.local.get('tab_groups');
        storedGroups = storedGroups.tab_groups || [];

        console.log("Stored groups (SW):", storedGroups);

        // If the tab is already grouped, do nothing
        if (updatedTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
            console.log(`Tab ${updatedTabId} is already grouped.`);
            return;
        }

        // Skip pinned tabs
        if (updatedTab.pinned) {
            console.log(`Tab ${updatedTabId} is pinned, skipping grouping.`);
            return;
        }

        // Check if there are any groups stored
        if (!storedGroups || !storedGroups || storedGroups.length <= 0) {
            console.log("No stored groups found, skipping grouping.");
            return;
        }

        let tab_url = new URL(updatedTab.url);
        let tab_hostname = tab_url.hostname;

        /* @type {boolean} */
        let isGrouped = false;

        console.log(`Checking if tab ${updatedTabId} matches any stored groups...`);
        // Check whether the updated tab's URL matches any of the stored groups
        for (const group of storedGroups) {
            console.log(`Checking group: ${group.name} with URLs: ${group.urls.join(', ')}`);
            for (const url of group.urls) {
                console.log(`Checking if ${updatedTab.url} matches group URL: ${url}`);
                if (tab_hostname.includes(url)) {
                    const matchingGroups = await chrome.tabGroups.query({
                        title: group.name
                    });

                    let groupId = null;
                    if (matchingGroups.length > 0) {
                        // If a group with the matching title exists, set the groupId
                        groupId = matchingGroups[0].id;
                    }

                    // Group the tab 
                    groupId = await chrome.tabs.group({
                        tabIds: [updatedTabId],
                        groupId: groupId
                    });

                    // Update the group title, colour and index to be after the last pinned tab
                    if (groupId) {
                        // Get the currently pinned tabs to determine the index
                        const pinnedTabs = await chrome.tabs.query({
                            currentWindow: true,
                            pinned: true
                        });

                        // Update the group with the new title and colour
                        await chrome.tabGroups.update(groupId, {
                            title: group.name,
                            color: group.colour,
                        });

                        // Move the group to the end of the pinned tabs
                        await chrome.tabGroups.move(groupId, {
                            index: pinnedTabs.length
                        });
                    }

                    // Mark as grouped
                    isGrouped = true;

                    break; // No need to check other URLs in this group
                }
            }
        }

        // If the tab was not grouped, move it to after the last tab
        if (!isGrouped) {
            // Get all tabs in the current window
            const allTabs = await chrome.tabs.query({ currentWindow: true });

            // Get the maximum index of tabs which are in a group
            const maxIndex = allTabs.reduce((max, tab) => {
                return tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE ? Math.max(max, tab.index) : max;
            }, -1);

            // If the current tab index is less than or equal to the maximum index, move it to the end
            if (updatedTab.index <= maxIndex) {
                chrome.tabs.move(updatedTabId, {
                    index: -1 // Move to the end of the tab list
                });
            }
        }
    }
});
