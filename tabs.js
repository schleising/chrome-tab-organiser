// Get all tabs in the current window
const tabs = await chrome.tabs.query({});

// Count the number of pinned tabs
const pinnedTabsCount = tabs.filter(tab => tab.pinned).length;

// Get the tabs that match the specified URLs
const newScientistUrls = [
    "https://www.newscientist.com/*",
];

const newScientistTabs = await chrome.tabs.query({
    url: newScientistUrls
});

if (newScientistTabs.length > 0) {
    // Group the tabs into a single group
    const groupId = await chrome.tabs.group({
        tabIds: newScientistTabs.map(tab => tab.id),
    });

    // Get the group's current index
    const group = await chrome.tabGroups.get(groupId);
    const groupIndex = group.index;

    if (groupIndex !== pinnedTabsCount) {
        // Move the group to the first position
        await chrome.tabGroups.move(groupId, { index: pinnedTabsCount });
    }

    // Add a title to the group
    await chrome.tabGroups.update(groupId, { title: "NS" });

    // Set the group color
    await chrome.tabGroups.update(groupId, { color: "blue" });

    // Collapse the group
    await chrome.tabGroups.update(groupId, { collapsed: true });
} else {
    console.log("No tabs found matching the specified URLs.");
}