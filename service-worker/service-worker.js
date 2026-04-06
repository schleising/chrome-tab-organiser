/**
 * @typedef {import('../types/types.js').StoredGroup} StoredGroup
 */

import { organiseTab, arrangeTabGroups, getStoredGroups } from '../shared/tab-grouper.js';
import { storeGroups } from '../shared/tab-grouper.js';

const ARRANGE_DEBOUNCE_MS = 220;
const arrangeTimers = new Map();
const MENU_PARENT_ID = 'auto-tab-grouper:add';
const MENU_NEW_GROUP_ID = 'auto-tab-grouper:new-group';
const MENU_GROUP_PREFIX = 'auto-tab-grouper:group:';
const PENDING_GROUP_DRAFT_KEY = 'pending_tab_group_draft';
const MENU_CONTEXTS = ['page', 'action'];
let contextMenuRebuildInFlight = Promise.resolve();
const lastProcessedTabUrls = new Map();

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

function extractHostnameRule(tabUrl) {
    try {
        const parsedUrl = new URL(tabUrl);
        if (!parsedUrl.hostname || parsedUrl.protocol === 'chrome:') {
            return null;
        }
        return parsedUrl.hostname.toLowerCase();
    } catch {
        return null;
    }
}

function createContextMenuItem(props) {
    return new Promise((resolve, reject) => {
        chrome.contextMenus.create(props, () => {
            const { lastError } = chrome.runtime;
            if (lastError) {
                reject(new Error(lastError.message));
                return;
            }
            resolve();
        });
    });
}

async function rebuildTabContextMenu() {
    await new Promise((resolve) => chrome.contextMenus.removeAll(() => resolve()));

    await createContextMenuItem({
        id: MENU_PARENT_ID,
        title: 'Add to Auto Tab Grouper',
        contexts: MENU_CONTEXTS
    });

    await createContextMenuItem({
        id: MENU_NEW_GROUP_ID,
        parentId: MENU_PARENT_ID,
        title: 'New Group from This Tab',
        contexts: MENU_CONTEXTS
    });

    const storedGroups = await getStoredGroups();
    for (const group of storedGroups) {
        await createContextMenuItem({
            id: `${MENU_GROUP_PREFIX}${encodeURIComponent(group.name)}`,
            parentId: MENU_PARENT_ID,
            title: `Add to ${group.name}`,
            contexts: MENU_CONTEXTS
        });
    }
}

function queueContextMenuRebuild() {
    contextMenuRebuildInFlight = contextMenuRebuildInFlight
        .catch(() => undefined)
        .then(async () => {
            try {
                await rebuildTabContextMenu();
            } catch (error) {
                console.error('Failed to build tab context menu:', error);
            }
        });

    return contextMenuRebuildInFlight;
}

async function addTabToExistingGroup(groupName, tab) {
    if (!tab?.id || !tab.url) {
        return;
    }

    const hostnameRule = extractHostnameRule(tab.url);
    if (!hostnameRule) {
        return;
    }

    const storedGroups = await getStoredGroups();
    const groupIndex = storedGroups.findIndex((group) => group.name === groupName);
    if (groupIndex === -1) {
        return;
    }

    if (!storedGroups[groupIndex].urls.includes(hostnameRule)) {
        storedGroups[groupIndex].urls.push(hostnameRule);
        await storeGroups(storedGroups);
    }

    await organiseTab(tab.id, tab, storedGroups);
    scheduleArrangeTabGroups(tab.windowId);
}

async function startNewGroupFromTab(tab) {
    if (!tab?.url) {
        return;
    }

    const hostnameRule = extractHostnameRule(tab.url);
    if (!hostnameRule) {
        return;
    }

    const nameSuggestion = hostnameRule.replace(/^www\./, '');
    await chrome.storage.local.set({
        [PENDING_GROUP_DRAFT_KEY]: {
            nameSuggestion,
            url: hostnameRule
        }
    });

    await chrome.runtime.openOptionsPage();
}

chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        // Open the options page when the extension is installed
        await chrome.runtime.openOptionsPage();
    }

    await queueContextMenuRebuild();
});

chrome.runtime.onStartup.addListener(() => {
    void queueContextMenuRebuild();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes.tab_groups) {
        void queueContextMenuRebuild();
    }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_NEW_GROUP_ID) {
        void startNewGroupFromTab(tab);
        return;
    }

    if (typeof info.menuItemId === 'string' && info.menuItemId.startsWith(MENU_GROUP_PREFIX)) {
        const encodedName = info.menuItemId.slice(MENU_GROUP_PREFIX.length);
        const groupName = decodeURIComponent(encodedName);
        void addTabToExistingGroup(groupName, tab);
    }
});

// Ensure menus exist whenever the service worker spins up, not only on install/startup events.
void queueContextMenuRebuild();

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

    // Avoid reprocessing identical completed URL updates for the same tab.
    if (lastProcessedTabUrls.get(updatedTabId) === updatedTab.url) {
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
    lastProcessedTabUrls.set(updatedTabId, updatedTab.url);

    // Arrange tab groups after updates settle to avoid repeated churn.
    scheduleArrangeTabGroups(updatedTab.windowId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
    lastProcessedTabUrls.delete(tabId);
});
