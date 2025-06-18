/**
 * @typedef StoredGroup
 * @property {string} name - The name of the group
 * @property {string[]} urls - The URLs of the tabs in the group
 * @property {string} colour - The colour of the group
 * 
 * @typedef StoredGroups
 * @property {StoredGroup[]} groups - An array of stored groups
 */

chrome.runtime.onInstalled.addListener(async () => {
    // Define the URLs to match
    const newScientistUrls = [
        "https://www.newscientist.com/*",
    ];

    /** @type {StoredGroup} */
    const storedGroup = {
        name: "NS",
        urls: newScientistUrls,
        colour: "blue"
    };

    /** @type {StoredGroups} */
    const storedGroups = {
        groups: [storedGroup]
    };

    // Store the group in local storage
    await chrome.storage.local.set({ groups: storedGroups });
    console.log("Extension installed and initial group stored.");

    // Remove any existing listeners to avoid duplicates
    chrome.tabs.onUpdated.removeListener();

    // Add a listener for tab updates
    chrome.tabs.onUpdated.addListener(async (updatedTabId, changeInfo, updatedTab) => {
        // Check if the updated tab is the one we are interested in
        if (changeInfo.status === 'complete') {
            // Get the stored groups from local storage
            /** @type {StoredGroup[]} */
            let storedGroups = await chrome.storage.local.get('groups');

            // Remove a level of indirection
            if (!storedGroups || !storedGroups.groups) {
                storedGroups = [];
            } else {
                storedGroups = storedGroups.groups;
            }

            // If the tab is already grouped, do nothing
            if (updatedTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
                return;
            }

            // Check if there are any groups stored
            if (!storedGroups || !storedGroups.groups || storedGroups.groups.length <= 0) {
                return;
            }

            /* @type {boolean} */
            let isGrouped = false;

            // Check whether the updated tab's URL matches any of the stored groups
            for (const group of storedGroups.groups) {
                for (const url of group.urls) {
                    if (updatedTab.url && updatedTab.url.startsWith(url.replace('*', ''))) {
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
});
