/**
 * @typedef {import('../types/types.js').StoredGroup} StoredGroup
 */

// Function to store groups in local storage
/** * 
 * @param {StoredGroup[]} groups - An array of stored groups to save
 * @returns {Promise<void>} - A promise that resolves when the groups are saved
 */
export async function storeGroups(groups) {
    // Validate the input to ensure it is an array of StoredGroup objects
    if (!Array.isArray(groups) || !groups.every(group => group && typeof group.name === 'string' && Array.isArray(group.urls) && group.urls.every(url => typeof url === 'string') && typeof group.colour === 'string')) {
        console.error("Invalid groups format. Expected an array of StoredGroup objects.");
        return
    }

    // Save the groups to chrome storage
    try {
        await chrome.storage.sync.set({ tab_groups: groups });
    } catch (error) {
        // If there is an error accessing storage, log it and throw an error
        console.error("Error accessing storage:", error);
    }
}


// Function to get the stored groups from local storage or initialise with an empty array
/**
 * 
 * @returns {Promise<StoredGroup[]>} - A promise that resolves to an array of stored groups
 */
export async function getStoredGroups() {
    // Load options from storage
    let result;
    try {
        // Attempt to get the stored groups from chrome storage
        result = await chrome.storage.sync.get('tab_groups');
    } catch (error) {
        // If there is an error accessing storage, log it and return an empty array
        console.error("Error accessing storage:", error);
        return [];
    }

    /** @type {StoredGroup[]} */
    let tab_groups = Array.isArray(result.tab_groups) ? result.tab_groups : [];

    // If no groups are stored, initialise with an empty array
    if (!tab_groups) {
        tab_groups = [];
    }

    // Return the stored groups
    return tab_groups;
}

// Add a listener for tab updates
export async function organiseTab(updatedTabId, updatedTab) {
    // Get the stored groups from local storage
    /** @type {StoredGroup[]} */
    let storedGroups = await getStoredGroups();

    // Return if no groups are stored
    if (storedGroups.length === 0) {
        return;
    }

    // Return if the updated tab is pinned
    if (updatedTab.pinned) {
        // If the tab is pinned, we do not want to group it, so return
        return;
    }

    // Check which group the updated tab belongs to by finding the best match by percentage of URL match
    const storedGroup = calculateBestGroupMatch(storedGroups, updatedTab.url);

    // If no group is found and the tab is to the left of grouped tabs, set the index to -1 and return
    if (!storedGroup) {
        // Ungroup the tab if it is currently grouped
        if (updatedTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
            try {
                await chrome.tabs.ungroup(updatedTabId);
            } catch (error) {
                console.error(`Error ungrouping tab ${updatedTab.url}:`, error);
            }
        }

        // Get all tabs in the current window
        let allTabs;
        try {
            allTabs = await chrome.tabs.query({ currentWindow: true });
        } catch (error) {
            console.error(`Error querying tabs in current window ${updatedTab.url}:`, error);
            return;
        }

        // Get the maximum index of tabs which are in a group
        const maxIndex = allTabs.reduce((max, tab) => {
            return tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE ? Math.max(max, tab.index) : max;
        }, -1);

        // If the current tab index is less than or equal to the maximum index, move it to the end
        if (updatedTab.index <= maxIndex) {
            try {
                await chrome.tabs.move(updatedTabId, {
                    index: -1 // Move to the end of the tab list
                });
            } catch (error) {
                console.error(`Error moving tab ${updatedTab.url} to the end:`, error);
            }
        }

        // Nothing to group, so return
        return;
    }

    // Get the group ID of the stored group
    let expectedGroup;
    try {
        expectedGroup = await chrome.tabGroups.query({
            title: storedGroup.name,
            windowId: chrome.windows.WINDOW_ID_CURRENT
        });
    } catch (error) {
        console.error(`Error querying group ${storedGroup.name}, ${updatedTab.url}:`, error);
        return;
    }

    let expectedGroupId = null;
    if (expectedGroup.length > 0) {
        expectedGroupId = expectedGroup[0].id;
    }

    // Get the initial group ID of the updated tab
    const initialGroupId = updatedTab.groupId;

    // Group the tab if it is not already in the correct group
    let newGroupId;
    try {
        newGroupId = await chrome.tabs.group({
            tabIds: [updatedTabId],
            groupId: expectedGroupId
        });
    } catch (error) {
        console.info(`Error grouping tab ${updatedTab.url} under group ${storedGroup.name}:`, error);
        console.info("This is a race condition in the tab grouping API, the tab is probably closing or has been closed.");
        return;
    }

    // Set the title and colour of the group
    if (newGroupId) {
        try {
            await chrome.tabGroups.update(newGroupId, {
                title: storedGroup.name,
                color: storedGroup.colour
            });
        } catch (error) {
            console.error(`Error updating group ${storedGroup.name} with colour ${storedGroup.colour} for url ${updatedTab.url}:`, error);
            return;
        }
    } else {
        console.error(`Failed to group tab ${updatedTabId} under ${storedGroup.name}`);
        return;
    }

    // If the initial group ID is not the same as the expected group ID, move the tab to the end of the new group
    if (initialGroupId !== expectedGroupId) {
        try {
            const tabsInGroup = await chrome.tabs.query({
                currentWindow: true,
                groupId: newGroupId
            });
            if (tabsInGroup.length > 0) {
                const lastTabIndex = Math.max(...tabsInGroup.map(tab => tab.index));
                try {
                    await chrome.tabs.move(updatedTabId, { index: lastTabIndex });
                } catch (error) {
                    console.error(`Error moving tab ${updatedTab.url} to the end of group ${storedGroup.name}:`, error);
                }
            }
        } catch (error) {
            console.error(`Error querying tab ${updatedTab.url}:`, error);
            return;
        }
    }

    // If the group is newly created, move it to the end of the tab list
    if (expectedGroupId === null) {
        // Get all tabs in the current window
        try {
            const allTabs = await chrome.tabs.query({ currentWindow: true });

            // Find the maximum index of tabs which are in a group
            const maxIndex = allTabs.reduce((max, tab) => {
                return tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE ? Math.max(max, tab.index) : max;
            }, -1);

            try {
                // Move the new group to the end of the tab list
                await chrome.tabGroups.move(newGroupId, { index: maxIndex + 1 });
            } catch (error) {
                console.error(`Error moving new group ${storedGroup.name} to the end of the tab list:`, error);
                return;
            }
        } catch (error) {
            console.error(`Error querying tabs in current window for grouping ${updatedTab.url}:`, error);
            return;
        }
    }
}

// Function to calculate the start and end indices for each tab group and move them to make them contiguous
export async function arrangeTabGroups() {
    // Get all tab groups
    let tabGroups;
    try {
        tabGroups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    } catch (error) {
        console.error("Error querying tab groups:", error);
        return;
    }

    // Create an object to hold the start and end indices for each group
    const groupIndices = {};

    // Iterate through each tab group
    for (const group of tabGroups) {
        // Get all tabs in the current group
        try {
            const tabsInGroup = await chrome.tabs.query({
                currentWindow: true,
                groupId: group.id
            });

            // If there are no tabs in the group, continue to the next group
            if (tabsInGroup.length === 0) {
                continue;
            }

            // Calculate the start and end indices
            const startIndex = Math.min(...tabsInGroup.map(tab => tab.index));
            const endIndex = Math.max(...tabsInGroup.map(tab => tab.index));

            // Store the indices in the object
            groupIndices[group.id] = { start: startIndex, end: endIndex };
        } catch (error) {
            console.error(`Error querying tabs in group ${group.title}:`, error);
            continue;
        }
    }

    // Sort the group IDs based on the order of the stored groups
    /** @type {StoredGroup[]} */
    let storedGroups = await getStoredGroups();

    const sortedGroupIds = storedGroups
        .map(group => group.name)
        .map(name => tabGroups.find(g => g.title === name)?.id)
        .filter(id => id !== undefined);

    // Make the groups contiguous by adjusting the start and end indices, the number of tabs in each group will be preserved
    // Initialize the current index to the number of pinned tabs
    let pinnedTabs;
    try {
        pinnedTabs = await chrome.tabs.query({
            currentWindow: true,
            pinned: true
        });
    } catch (error) {
        console.error("Error querying pinned tabs:", error);
        return;
    }
    let currentIndex = pinnedTabs.length;

    for (const groupId of sortedGroupIds) {
        const group = groupIndices[groupId];
        const groupSize = group.end - group.start + 1;

        // Adjust the start index to the current index
        group.start = currentIndex;
        group.end = currentIndex + groupSize - 1;

        // Update the current index for the next group
        currentIndex += groupSize;
    }

    // Move the tab groups to the start indices calculated
    for (const groupId of sortedGroupIds) {
        try {
            await chrome.tabGroups.move(groupId, {
                index: groupIndices[groupId].start
            });
        } catch (error) {
            console.error(`Error moving group ${groupId} to index ${groupIndices[groupId].start}:`, error);
            continue;
        }
    }

    // Delete any empty groups
    for (const group of tabGroups) {
        let tabsInGroup;
        try {
            tabsInGroup = await chrome.tabs.query({
                currentWindow: true,
                groupId: group.id
            });
        } catch (error) {
            console.error(`Error querying tabs in group ${group.title}:`, error);
            continue;
        }

        try {
            // If there are no tabs in the group, remove the group
            if (tabsInGroup.length === 0) {
                await chrome.tabGroups.remove(group.id);
            }
        } catch (error) {
            console.error(`Error removing empty group ${group.title}:`, error);
        }
    }
}

// Function to delete a group, the tabs in the group will be ungrouped and moved to the end of the tab list
export async function deleteGroup(groupName) {
    // Get all instances of the group by name in all windows\
    let groups;
    try {
        groups = await chrome.tabGroups.query({ title: groupName });
    } catch (error) {
        console.error(`Error querying groups with name ${groupName}:`, error);
        return;
    }

    for (const group of groups) {
        // Get all tabs in all windows
        let tabsInGroup;
        try {
            tabsInGroup = await chrome.tabs.query({ groupId: group.id });
        } catch (error) {
            console.error(`Error querying tabs in group ${groupName}:`, error);
            continue;
        }

        // Ungroup the tabs and move them to the end of the tab list
        for (const tab of tabsInGroup) {
            try {
                // Ungroup the tab
                await chrome.tabs.ungroup(tab.id);
            } catch (error) {
                console.error(`Error ungrouping tab ${tab.id} in group ${groupName}:`, error);
                continue;
            }

            try {
                // Move the tab to the end of the tab list
                await chrome.tabs.move(tab.id, { index: -1 });
            } catch (error) {
                console.error(`Error moving tab ${tab.id} to the end of the tab list:`, error);
                continue;
            }
        }
    }

    // Arrange the tab groups to make them contiguous after deletion
    await arrangeTabGroups();
}

// Function to calculate the best group match based on number of characters in each URL matching
function calculateBestGroupMatch(storedGroups, url) {
    let bestMatch = null;
    let bestMatchCount = 0;

    // Iterate through each stored group
    for (const group of storedGroups) {
        for (const groupUrl of group.urls) {
            // Check if the URL includes the group URL
            if (url.includes(groupUrl)) {
                // Get the length of the group URL
                const matchCount = groupUrl.length;

                // If this is the best match so far, update the best match
                if (matchCount > bestMatchCount) {
                    bestMatchCount = matchCount;
                    bestMatch = group;
                }
            }
        }
    }

    // Return the best match group or null if no match is found
    return bestMatch;
}
