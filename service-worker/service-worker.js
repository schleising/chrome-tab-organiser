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
    // Check if the updated tab is the one we are interested in
    if (changeInfo.status === 'complete') {
        // Get the stored groups from local storage
        /** @type {StoredGroup[]} */
        let storedGroups = await chrome.storage.sync.get('tab_groups');
        storedGroups = storedGroups.tab_groups || [];

        // Return if no groups are stored
        if (storedGroups.length === 0) {
            return;
        }

        // Return if the updated tab is pinned
        if (updatedTab.pinned) {
            // Rearrange the tab groups to make them contiguous
            await arrangeTabGroups();

            // If the tab is pinned, we do not want to group it, so return
            return;
        }

        // Check which group the updated tab belongs to
        const storedGroup = storedGroups.find(g => g.urls.some(url => updatedTab.url && updatedTab.url.toLowerCase().includes(url.toLowerCase())));

        // If no group is found and the tab is to the left of grouped tabs, set the index to -1 and return
        if (!storedGroup) {
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

            // Rearrange the tab groups to make them contiguous
            await arrangeTabGroups();

            // Nothing to group, so return
            return;
        }

        // Get the group ID of the stored group
        const expectedGroup = await chrome.tabGroups.query({
            title: storedGroup.name,
            windowId: chrome.windows.WINDOW_ID_CURRENT
        });

        let expectedGroupId = null;
        if (expectedGroup.length > 0) {
            expectedGroupId = expectedGroup[0].id;
        }

        // Group the tab if it is not already in the correct group
        const newGroupId = await chrome.tabs.group({
            tabIds: [updatedTabId],
            groupId: expectedGroupId
        });

        // Set the title and colour of the group
        if (newGroupId) {
            await chrome.tabGroups.update(newGroupId, {
                title: storedGroup.name,
                color: storedGroup.colour
            });
        } else {
            console.error(`Failed to group tab ${updatedTabId} under ${storedGroup.name}`);
            return;
        }

        // If the group is newly created, move it to the end of the tab list
        if (expectedGroupId === null) {
            // Get all tabs in the current window
            const allTabs = await chrome.tabs.query({ currentWindow: true });

            // Find the maximum index of tabs which are in a group
            const maxIndex = allTabs.reduce((max, tab) => {
                return tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE ? Math.max(max, tab.index) : max;
            }, -1);

            // Move the new group to the end of the tab list
            await chrome.tabGroups.move(newGroupId, { index: maxIndex + 1 });
        }

        // Rearrange the tab groups to make them contiguous
        await arrangeTabGroups();

        // Move the grouped tab to the end of the group
        const tabsInGroup = await chrome.tabs.query({
            currentWindow: true,
            groupId: newGroupId
        });
        if (tabsInGroup.length > 0) {
            const lastTabIndex = Math.max(...tabsInGroup.map(tab => tab.index));
            await chrome.tabs.move(updatedTabId, { index: lastTabIndex });
        }
    }
});

// Function to calculate the start and end indices for each tab group and move them to make them contiguous
async function arrangeTabGroups() {
    // Get all tab groups
    const tabGroups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });

    // Create an object to hold the start and end indices for each group
    const groupIndices = {};

    // Iterate through each tab group
    for (const group of tabGroups) {
        // Get all tabs in the current group
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
    }

    // Sort the groups by start index, just sorting the keys of the groupIndices object
    // This will ensure that the groups are processed in the order of their start indices
    // In JavaScript objects do not maintain order
    const sortedGroupIds = Object.keys(groupIndices).sort((a, b) => groupIndices[a].start - groupIndices[b].start).map(Number);

    // Make the groups contiguous by adjusting the start and end indices, the number of tabs in each group will be preserved
    // Initialize the current index to the number of pinned tabs
    const pinnedTabs = await chrome.tabs.query({
        currentWindow: true,
        pinned: true
    });
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
        await chrome.tabGroups.move(groupId, {
            index: groupIndices[groupId].start
        });
    }
}
