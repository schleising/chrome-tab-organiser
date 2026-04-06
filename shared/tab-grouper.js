/**
 * @typedef {import('../types/types.js').StoredGroup} StoredGroup
 */

/** @type {Map<string, RegExp|null>} */
const regexCache = new Map();
const MAX_REGEX_PATTERN_LENGTH = 180;

function getRegexSafetyIssue(pattern) {
    if (!pattern) {
        return 'empty-pattern';
    }

    if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
        return 'pattern-too-long';
    }

    if (/\\[1-9]/.test(pattern)) {
        return 'backreference-not-allowed';
    }

    if (/\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)\s*[+*{]/.test(pattern)) {
        return 'nested-quantifier';
    }

    if (/(?:\.\*|\.\+)\s*(?:\.\*|\.\+|[+*{])/.test(pattern)) {
        return 'repeated-wildcard';
    }

    return null;
}

function getCachedRegex(groupEntry) {
    if (regexCache.has(groupEntry)) {
        return regexCache.get(groupEntry);
    }

    let compiledRegex = null;

    try {
        if (groupEntry.startsWith('re:')) {
            const pattern = groupEntry.slice(3).trim();
            const safetyIssue = getRegexSafetyIssue(pattern);
            if (!safetyIssue) {
                compiledRegex = new RegExp(pattern, 'i');
            } else {
                console.warn(`Skipping unsafe regex rule (${safetyIssue}):`, groupEntry);
            }
        }
    } catch {
        compiledRegex = null;
    }

    regexCache.set(groupEntry, compiledRegex);
    return compiledRegex;
}

function parseUrlSafely(url) {
    try {
        return new URL(url);
    } catch {
        return null;
    }
}

function hostnameMatches(urlHostname, hostPattern) {
    return urlHostname === hostPattern || urlHostname.endsWith(`.${hostPattern}`);
}

function looksLikeHostnamePattern(entry) {
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(entry);
}

function evaluateGroupEntryMatch(tabUrl, parsedTabUrl, groupEntryRaw) {
    const groupEntry = groupEntryRaw.trim();
    if (!groupEntry) {
        return { isMatch: false, tier: 0, score: 0 };
    }

    // Advanced regex support: `re:pattern`.
    if (groupEntry.startsWith('re:')) {
        const matcher = getCachedRegex(groupEntry);
        if (!matcher) {
            return { isMatch: false, tier: 0, score: 0 };
        }

        return matcher.test(tabUrl)
            ? { isMatch: true, tier: 5, score: groupEntry.length }
            : { isMatch: false, tier: 0, score: 0 };
    }

    const normalizedEntry = groupEntry.toLowerCase();
    const normalizedUrl = tabUrl.toLowerCase();

    if (parsedTabUrl) {
        const urlHostname = parsedTabUrl.hostname.toLowerCase();
        const urlPath = parsedTabUrl.pathname.toLowerCase();

        // Host + path rule, e.g. "bbc.co.uk/sport".
        const slashIndex = normalizedEntry.indexOf('/');
        if (slashIndex > 0) {
            const hostPart = normalizedEntry.slice(0, slashIndex).trim();
            const pathPart = `/${normalizedEntry.slice(slashIndex + 1).replace(/^\/+/, '')}`;
            if (hostPart && pathPart !== '/' && hostnameMatches(urlHostname, hostPart) && urlPath.startsWith(pathPart)) {
                return { isMatch: true, tier: 4, score: hostPart.length + pathPart.length };
            }
        }

        // Host-only rule, e.g. "theguardian.com".
        if (looksLikeHostnamePattern(normalizedEntry) && hostnameMatches(urlHostname, normalizedEntry)) {
            return { isMatch: true, tier: 3, score: normalizedEntry.length };
        }

        // Path token rule, e.g. "sport" (prefer path semantics over generic substring).
        if (urlPath.includes(normalizedEntry)) {
            return { isMatch: true, tier: 2, score: normalizedEntry.length };
        }
    }

    // Generic fallback for backward compatibility.
    if (normalizedUrl.includes(normalizedEntry)) {
        return { isMatch: true, tier: 1, score: normalizedEntry.length };
    }

    return { isMatch: false, tier: 0, score: 0 };
}

function getMatchBucketIndex(groupUrls, tabUrl) {
    if (!tabUrl) {
        return Number.MAX_SAFE_INTEGER;
    }

    const parsedTabUrl = parseUrlSafely(tabUrl);
    let bestBucketIndex = Number.MAX_SAFE_INTEGER;
    let bestTier = 0;
    let bestScore = 0;

    for (let i = 0; i < groupUrls.length; i += 1) {
        const evaluation = evaluateGroupEntryMatch(tabUrl, parsedTabUrl, groupUrls[i]);
        if (!evaluation.isMatch) {
            continue;
        }

        if (
            evaluation.tier > bestTier
            || (evaluation.tier === bestTier && evaluation.score > bestScore)
            || (evaluation.tier === bestTier && evaluation.score === bestScore && i < bestBucketIndex)
        ) {
            bestTier = evaluation.tier;
            bestScore = evaluation.score;
            bestBucketIndex = i;
        }
    }

    return bestBucketIndex;
}

async function arrangeTabsWithinGroup(windowId, groupId, groupUrls, groupStartIndex) {
    let tabsInGroup;
    try {
        tabsInGroup = await chrome.tabs.query({ groupId, windowId });
    } catch (error) {
        console.error(`Error querying tabs in group ${groupId} for intra-group arrange:`, error);
        return;
    }

    if (tabsInGroup.length < 2) {
        return;
    }

    const orderedTabs = tabsInGroup
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((tab, originalOrder) => ({
            tab,
            originalOrder,
            bucket: getMatchBucketIndex(groupUrls, tab.url)
        }))
        .sort((a, b) => {
            if (a.bucket !== b.bucket) {
                return a.bucket - b.bucket;
            }
            return a.originalOrder - b.originalOrder;
        })
        .map((entry) => entry.tab);

    for (let i = 0; i < orderedTabs.length; i += 1) {
        const targetIndex = groupStartIndex + i;

        let currentIndex = orderedTabs[i].index;
        try {
            const liveTab = await chrome.tabs.get(orderedTabs[i].id);
            currentIndex = liveTab.index;
        } catch {
            // If tab disappeared mid-reorder, skip quietly.
            continue;
        }

        if (currentIndex === targetIndex) {
            continue;
        }

        try {
            await chrome.tabs.move(orderedTabs[i].id, { index: targetIndex });
        } catch (error) {
            console.error(`Error moving tab ${orderedTabs[i].id} inside group ${groupId}:`, error);
        }
    }
}

// Function to store groups in local storage
/** * 
 * @param {StoredGroup[]} groups - An array of stored groups to save
 * @returns {Promise<void>} - A promise that resolves when the groups are saved
 */
export async function storeGroups(groups) {
    // Validate the input to ensure it is an array of StoredGroup objects
    if (!Array.isArray(groups) || !groups.every(group => group && typeof group.name === 'string' && Array.isArray(group.urls) && group.urls.every(url => typeof url === 'string') && typeof group.colour === 'string')) {
        throw new Error('Invalid groups format. Expected an array of StoredGroup objects.');
    }

    // Save the groups to chrome storage
    try {
        await chrome.storage.sync.set({ tab_groups: groups });
    } catch (error) {
        // If there is an error accessing storage, log it and rethrow so callers can react.
        console.error("Error accessing storage:", error);
        throw error;
    }
}


// Function to get the stored groups from local storage or initialise with an empty array
/**
 * 
 * @returns {Promise<StoredGroup[]>} - A promise that resolves to an array of stored groups
 */
export async function getStoredGroups() {
    try {
        // Attempt to get the stored groups from chrome storage
        const result = await chrome.storage.sync.get('tab_groups');
        return Array.isArray(result.tab_groups) ? result.tab_groups : [];
    } catch (error) {
        // If there is an error accessing storage, log it and return an empty array
        console.error("Error accessing storage:", error);
        return [];
    }
}

// Add a listener for tab updates
export async function organiseTab(updatedTabId, updatedTab, storedGroupsOverride = null) {
    // Get the stored groups from local storage
    /** @type {StoredGroup[]} */
    const storedGroups = storedGroupsOverride ?? await getStoredGroups();

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
            allTabs = await chrome.tabs.query({ windowId: updatedTab.windowId });
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
                // If the move fails, retry after a short delay
                await new Promise(resolve => setTimeout(resolve, 100));
                try {
                    await chrome.tabs.move(updatedTabId, {
                        index: -1 // Move to the end of the tab list
                    });
                } catch (retryError) {
                    console.error(`Retry failed for moving tab ${updatedTab.url} to the end:`, retryError);
                }
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
            windowId: updatedTab.windowId
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
        if (expectedGroupId === null) {
            // If the expected group ID is null, create a new group
            newGroupId = await chrome.tabs.group({
                createProperties: {
                    windowId: updatedTab.windowId,
                },
                tabIds: [updatedTabId]
            });
        } else {
            // Otherwise, group the tab under the expected group ID
            newGroupId = await chrome.tabs.group({
                tabIds: [updatedTabId],
                groupId: expectedGroupId
            });
        }
    } catch (error) {
        console.warn(`Error grouping tab ${updatedTab.url} under group ${storedGroup.name}:`, error);
        console.warn("Likely transient tab-grouping race condition (tab closed/moving or browser starting).");
        return;
    }

    // Set the title and colour of the group
    if (newGroupId !== null && newGroupId !== undefined) {
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
                windowId: updatedTab.windowId,
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
            const allTabs = await chrome.tabs.query({ windowId: updatedTab.windowId });

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
export async function arrangeTabGroups(windowId = chrome.windows.WINDOW_ID_CURRENT) {

    // Get all tab groups
    let tabGroups;
    try {
        tabGroups = await chrome.tabGroups.query({ windowId });
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
                groupId: group.id,
                windowId
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
    const storedGroups = await getStoredGroups();

    const sortedGroupIds = storedGroups
        .map(group => group.name)
        .map(name => tabGroups.find(g => g.title === name)?.id)
        .filter(id => id !== undefined);

    // Make the groups contiguous by adjusting the start and end indices, the number of tabs in each group will be preserved
    // Initialize the current index to the number of pinned tabs
    let pinnedTabs;
    try {
        pinnedTabs = await chrome.tabs.query({
            pinned: true,
            windowId
        });
    } catch (error) {
        console.error("Error querying pinned tabs:", error);
        return;
    }
    let currentIndex = pinnedTabs.length;

    for (const groupId of sortedGroupIds) {
        const group = groupIndices[groupId];
        if (!group) {
            continue;
        }
        const groupSize = group.end - group.start + 1;

        // Adjust the start index to the current index
        group.start = currentIndex;
        group.end = currentIndex + groupSize - 1;

        // Update the current index for the next group
        currentIndex += groupSize;
    }

    // Move the tab groups to the start indices calculated
    for (const groupId of sortedGroupIds) {
        const targetGroup = groupIndices[groupId];
        if (!targetGroup) {
            continue;
        }

        try {
            await chrome.tabGroups.move(groupId, {
                index: targetGroup.start
            });
        } catch (error) {
            // Try again after a short delay
            await new Promise(resolve => setTimeout(resolve, 100));
            try {
                await chrome.tabGroups.move(groupId, {
                    index: targetGroup.start
                });
            } catch (retryError) {
                console.error(`Retry failed for moving group ${groupId} to index ${targetGroup.start}:`, retryError);
                continue;
            }
        }
    }

    // Within each group, keep tabs clustered by the URL pattern they matched.
    for (const groupId of sortedGroupIds) {
        const targetGroup = groupIndices[groupId];
        if (!targetGroup) {
            continue;
        }

        const tabGroup = tabGroups.find((group) => group.id === groupId);
        if (!tabGroup) {
            continue;
        }

        const matchingStoredGroup = storedGroups.find((group) => group.name === tabGroup.title);
        if (!matchingStoredGroup) {
            continue;
        }

        await arrangeTabsWithinGroup(windowId, groupId, matchingStoredGroup.urls, targetGroup.start);
    }

    // Delete any empty groups
    for (const group of tabGroups) {
        let tabsInGroup;
        try {
            tabsInGroup = await chrome.tabs.query({
                groupId: group.id,
                windowId: windowId
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
    if (!url) {
        return null;
    }

    const parsedTabUrl = parseUrlSafely(url);
    let bestMatch = null;
    let bestMatchTier = 0;
    let bestMatchScore = 0;

    // Iterate through each stored group
    for (const group of storedGroups) {
        for (const groupUrl of group.urls) {
            const evaluation = evaluateGroupEntryMatch(url, parsedTabUrl, groupUrl);
            if (!evaluation.isMatch) {
                continue;
            }

            if (
                evaluation.tier > bestMatchTier
                || (evaluation.tier === bestMatchTier && evaluation.score > bestMatchScore)
            ) {
                bestMatchTier = evaluation.tier;
                bestMatchScore = evaluation.score;
                bestMatch = group;
            }
        }
    }

    // Return the best match group or null if no match is found
    return bestMatch;
}
