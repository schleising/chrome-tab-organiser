/**
 * @typedef {import('../types/types.js').StoredGroup} StoredGroup
 */

import { storeGroups, getStoredGroups, organiseTab, deleteGroup, arrangeTabGroups } from '../shared/tab-grouper.js';

const ERROR_TIMEOUT_MS = 5000;
const DEFAULT_GROUP_COLOUR = 'blue';
const CREATE_GROUP_LABEL = 'Create Group';
const REORDER_ANIMATION_DURATION_MS = 480;
const REORDER_ANIMATION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

const byId = (id) => document.querySelector(`#${id}`);

/** @type {string[]} */
let pendingGroupUrls = [];

function isRegexEntry(entry) {
    const trimmed = entry.trim();
    if (trimmed.startsWith('re:')) {
        return true;
    }

    if (trimmed.startsWith('/')) {
        const lastSlash = trimmed.lastIndexOf('/');
        return lastSlash > 0;
    }

    return false;
}

function isValidRegexEntry(entry) {
    const trimmed = entry.trim();

    try {
        if (trimmed.startsWith('re:')) {
            const pattern = trimmed.slice(3).trim();
            if (!pattern) {
                return false;
            }
            new RegExp(pattern, 'i');
            return true;
        }

        if (trimmed.startsWith('/')) {
            const lastSlash = trimmed.lastIndexOf('/');
            if (lastSlash <= 0) {
                return false;
            }
            const pattern = trimmed.slice(1, lastSlash);
            const flags = trimmed.slice(lastSlash + 1);
            new RegExp(pattern, flags);
            return true;
        }
    } catch {
        return false;
    }

    return true;
}

function normaliseHostnames(rawValue) {
    return rawValue
        .split(',')
        .map(url => url.trim())
        .filter(url => url.length > 0)
        .map(url => isRegexEntry(url) ? url : url.toLowerCase());
}

function renderPendingHostnames() {
    const hostList = byId('group-host-list');
    hostList.innerHTML = '';

    pendingGroupUrls.forEach((hostname, index) => {
        const item = document.createElement('li');
        item.className = 'group-host-item';

        const hostText = document.createElement('span');
        hostText.textContent = hostname;
        if (isRegexEntry(hostname)) {
            hostText.classList.add('regex-hostname');
        }
        item.appendChild(hostText);

        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'host-remove-button';
        removeButton.setAttribute('aria-label', `Remove ${hostname}`);
        removeButton.textContent = '×';
        removeButton.addEventListener('click', () => {
            pendingGroupUrls.splice(index, 1);
            renderPendingHostnames();
        });

        item.appendChild(removeButton);
        hostList.appendChild(item);
    });
}

function addHostnamesFromInput() {
    const hostInput = byId('group-urls');
    const groupError = byId('group-error');
    const parsedHostnames = normaliseHostnames(hostInput.value);

    for (const hostname of parsedHostnames) {
        if (!isValidRegexEntry(hostname)) {
            groupError.textContent = `Invalid regex: ${hostname}`;
            groupError.hidden = false;
            return false;
        }
    }

    groupError.textContent = '';
    groupError.hidden = true;

    for (const hostname of parsedHostnames) {
        if (!pendingGroupUrls.includes(hostname)) {
            pendingGroupUrls.push(hostname);
        }
    }

    hostInput.value = '';
    renderPendingHostnames();
    return true;
}

function showGroupError(message) {
    const groupError = byId('group-error');
    groupError.textContent = message;
    groupError.hidden = false;

    setTimeout(() => {
        groupError.textContent = '';
        groupError.hidden = true;
    }, ERROR_TIMEOUT_MS);
}

function clearGroupError() {
    const groupError = byId('group-error');
    groupError.textContent = '';
    groupError.hidden = true;
}

function resetCreateButtonState() {
    const createGroupButton = byId('create-group');
    createGroupButton.textContent = CREATE_GROUP_LABEL;
    createGroupButton.classList.remove('btn-save');
    createGroupButton.classList.add('btn-create');
}

function clearGroupForm() {
    byId('group-name').value = '';
    byId('group-colour').value = DEFAULT_GROUP_COLOUR;
    byId('group-urls').value = '';
    pendingGroupUrls = [];
    renderPendingHostnames();
}

function scrollGroupCardIntoView(groupName) {
    const groupCards = document.querySelectorAll('.existing-group');
    const targetCard = Array.from(groupCards).find(card => card.dataset.groupName === groupName);

    if (targetCard) {
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function ensureCardStaysVisible(card) {
    if (!card) {
        return;
    }

    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function followCardDuringAnimation(card, durationMs) {
    if (!card) {
        return;
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
        ensureCardStaysVisible(card);
        return;
    }

    const VIEWPORT_MARGIN = 56;
    const MAX_SCROLL_PER_FRAME = 18;
    const startTime = performance.now();

    const tick = (now) => {
        const elapsed = now - startTime;
        const rect = card.getBoundingClientRect();

        if (rect.top < VIEWPORT_MARGIN) {
            const overflow = VIEWPORT_MARGIN - rect.top;
            const delta = Math.min(MAX_SCROLL_PER_FRAME, overflow);
            window.scrollBy(0, -delta);
        } else if (rect.bottom > window.innerHeight - VIEWPORT_MARGIN) {
            const overflow = rect.bottom - (window.innerHeight - VIEWPORT_MARGIN);
            const delta = Math.min(MAX_SCROLL_PER_FRAME, overflow);
            window.scrollBy(0, delta);
        }

        if (elapsed < durationMs + 120) {
            requestAnimationFrame(tick);
            return;
        }

        ensureCardStaysVisible(card);
    };

    requestAnimationFrame(tick);
}

function updateReorderButtonStates() {
    const groupCards = Array.from(document.querySelectorAll('.existing-group'));

    groupCards.forEach((card, index) => {
        const upButton = card.querySelector('.btn-up');
        const downButton = card.querySelector('.btn-down');

        if (upButton) {
            upButton.disabled = index === 0;
        }

        if (downButton) {
            downButton.disabled = index === groupCards.length - 1;
        }
    });
}

function animateGroupReorder(container, movedGroupName, direction) {
    const cards = Array.from(container.querySelectorAll('.existing-group'));
    const movedIndex = cards.findIndex((card) => card.dataset.groupName === movedGroupName);
    if (movedIndex === -1) {
        return null;
    }

    const targetIndex = direction === 'up' ? movedIndex - 1 : movedIndex + 1;
    if (targetIndex < 0 || targetIndex >= cards.length) {
        return null;
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const firstRects = new Map(cards.map((card) => [card, card.getBoundingClientRect()]));
    const movedCard = cards[movedIndex];

    if (direction === 'up') {
        container.insertBefore(movedCard, cards[targetIndex]);
    } else {
        container.insertBefore(cards[targetIndex], movedCard);
    }

    updateReorderButtonStates();

    if (prefersReducedMotion) {
        return movedCard;
    }

    const updatedCards = Array.from(container.querySelectorAll('.existing-group'));
    updatedCards.forEach((card) => {
        const firstRect = firstRects.get(card);
        if (!firstRect) {
            return;
        }

        const lastRect = card.getBoundingClientRect();
        const translateY = firstRect.top - lastRect.top;

        if (translateY !== 0) {
            card.animate(
                [
                    { transform: `translateY(${translateY}px)` },
                    { transform: 'translateY(0)' }
                ],
                {
                    duration: REORDER_ANIMATION_DURATION_MS,
                    easing: REORDER_ANIMATION_EASING,
                    fill: 'both'
                }
            );
        }
    });

    followCardDuringAnimation(movedCard, REORDER_ANIMATION_DURATION_MS);

    return movedCard;
}

document.addEventListener("DOMContentLoaded", async () => {
    const addHostnameButton = byId('add-hostname');
    const hostInput = byId('group-urls');

    addHostnameButton.addEventListener('click', addHostnamesFromInput);
    hostInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            addHostnamesFromInput();
        }
    });

    renderPendingHostnames();
    await initialiseOptionsDialog();

    // Add event listener for the "Create Group" button
    const createGroupButton = byId('create-group');
    createGroupButton.addEventListener('click', async () => {
        clearGroupError();

        // Get the group name and colour from the input fields
        const groupName = byId('group-name').value.trim();
        const groupColour = byId('group-colour').value.trim();
        if (!addHostnamesFromInput()) {
            return;
        }

        // Validate inputs
        if (!groupName || !groupColour || pendingGroupUrls.length === 0) {
            showGroupError("Invalid input: group name, colour, and URLs are required.");
            return;
        }

        // Create a new group object
        /** @type {StoredGroup} */
        const newGroup = {
            name: groupName,
            urls: [...pendingGroupUrls],
            colour: groupColour
        };

        // Store the new group in local storage
        /** @type {StoredGroup[]} */
        let storedGroups = await getStoredGroups();

        // Check whether we are updating an existing group or creating a new one
        if (createGroupButton.textContent.startsWith('Update')) {
            // If the button text starts with "Update", we are editing an existing group
            const existingGroupName = createGroupButton.textContent.replace('Update ', '').trim();

            if (existingGroupName !== newGroup.name) {
                // Check if the new group name already exists
                const existingGroupIndex = storedGroups.findIndex(g => g.name === newGroup.name);
                if (existingGroupIndex !== -1) {
                    showGroupError("A group with this name already exists, edit that one instead.");
                    return;
                } else {
                    // If the group name has changed, replace the old group with the new one
                    // If the group name has not changed, just update the existing group
                    const existingGroupIndex = storedGroups.findIndex(g => g.name === existingGroupName);
                    if (existingGroupIndex !== -1) {
                        storedGroups[existingGroupIndex] = newGroup;
                    } else {
                        // If the group does not exist, treat it as a new group
                        storedGroups.push(newGroup);
                    }
                }
            } else {
                // If the group name has not changed, just update the existing group
                const existingGroupIndex = storedGroups.findIndex(g => g.name === existingGroupName);
                if (existingGroupIndex !== -1) {
                    storedGroups[existingGroupIndex] = newGroup;
                } else {
                    // If the group does not exist, treat it as a new group
                    storedGroups.push(newGroup);
                }
            }

            // Reset the button text to "Create Group"
            resetCreateButtonState();
            // Hide the Cancel button
            const cancelButton = byId('cancel-edit');
            cancelButton.hidden = true;
            cancelButton.onclick = null;
        } else {
            // If the button text does not start with "Update", we are creating a new group
            // Check if a group with the same name already exists
            const existingGroupIndex = storedGroups.findIndex(g => g.name === newGroup.name);
            if (existingGroupIndex !== -1) {
                showGroupError("A group with this name already exists, edit it instead.");
                return;
            } else {
                // If the group does not exist, add the new group to the stored groups
                storedGroups.push(newGroup);
            }
        }

        // Add the new group to the stored groups
        await storeGroups(storedGroups);

        // Organise all tabs in the current window
        await organiseAllTabs();

        // Refresh the options UI to show the new group
        await initialiseOptionsDialog();

        clearGroupForm();
    });
});

async function initialiseOptionsDialog() {
    // Load options from storage
    /** @type {StoredGroup[]} */
    let storedGroups = await getStoredGroups();

    // Populate the options UI with the stored groups
    const optionsContainer = byId('existing-group-container');
    optionsContainer.innerHTML = ''; // Clear existing content before re-render

    // Build the UI for each stored group
    storedGroups.forEach((group, groupPosition) => {
        // Create a new element for the group
        const groupElement = document.createElement('div');
        groupElement.className = `existing-group ${group.colour}`;
        groupElement.dataset.groupName = group.name;

        // Create the header for the group
        const groupHeaderElement = document.createElement('div');
        groupHeaderElement.className = 'existing-group-header';

        // Create the group name element
        const groupNameElement = document.createElement('h3');
        groupNameElement.textContent = group.name;
        groupHeaderElement.appendChild(groupNameElement);

        // Create the group colour element
        const groupColourElement = document.createElement('p');
        groupColourElement.className = 'group-colour';

        // Get the colour text and set it to title case
        const groupColour = group.colour.charAt(0).toUpperCase() + group.colour.slice(1).toLowerCase();
        groupColourElement.textContent = `Colour: ${groupColour}`;

        // Create a span for the colour dot
        const groupColourSpan = document.createElement('span');
        groupColourSpan.className = group.colour;
        groupColourSpan.textContent = ' ●';
        groupColourElement.appendChild(groupColourSpan);

        // Append the colour element to the header
        groupHeaderElement.appendChild(groupColourElement);

        // Append the header to the group element
        groupElement.appendChild(groupHeaderElement);

        // Create a list of URLs for the group
        const groupUrlsElement = document.createElement('ul');
        group.urls.forEach(url => {
            const urlElement = document.createElement('li');
            urlElement.textContent = url;
            groupUrlsElement.appendChild(urlElement);
        });
        groupElement.appendChild(groupUrlsElement);

        // Create buttons for the group
        const groupButtonElement = document.createElement('div');
        groupButtonElement.className = 'existing-group-buttons';

        const editDeleteButtonElement = document.createElement('div');
        editDeleteButtonElement.className = 'edit-delete-buttons';

        // Create the delete button
        const deleteButton = document.createElement('button');
        deleteButton.className = 'options-button btn-delete';
        deleteButton.textContent = 'Delete Group';

        // Add an event listener to the delete button
        deleteButton.addEventListener('click', async () => {
            // Create a confirmation dialog
            const dialog = byId('confirm-dialog');
            const message = byId('confirm-message');
            message.textContent = `Are you sure you want to delete the group "${group.name}"?`;
            dialog.showModal();

            dialog.returnValue = ''; // Reset previous value

            dialog.addEventListener('close', async function dialogHandler() {
                if (dialog.returnValue === 'ok') {
                    // Remove the group from storage
                    /** @type {StoredGroup[]} */
                    let storedGroups = await getStoredGroups();
                    storedGroups = storedGroups.filter(g => g.name !== group.name);
                    await storeGroups(storedGroups);

                    // Refresh the options UI
                    await initialiseOptionsDialog();

                    // Organise all tabs in the current window
                    await deleteGroup(group.name);

                    // Organise all tabs in the current window
                    await organiseAllTabs();
                }
                dialog.removeEventListener('close', dialogHandler); // Clean up
            });
        });

        // Append the delete button to the group buttons
        editDeleteButtonElement.appendChild(deleteButton);

        // Create the edit button
        const editButton = document.createElement('button');
        editButton.className = 'options-button btn-edit';
        editButton.textContent = 'Edit Group';

        // Add an event listener to the edit button
        editButton.addEventListener('click', () => {
            // Populate the input fields with the group's data for editing
            byId('group-name').value = group.name;
            byId('group-colour').value = group.colour;
            byId('group-urls').value = '';
            pendingGroupUrls = [...group.urls];
            renderPendingHostnames();

            // Set the button text to "Update <Group Name>"
            const createGroupButton = byId('create-group');
            createGroupButton.textContent = `Update ${group.name}`;
            createGroupButton.classList.remove('btn-create');
            createGroupButton.classList.add('btn-save');

            // Unhide the Cancel button
            const cancelButton = byId('cancel-edit');
            cancelButton.hidden = false;

            // Use a single click handler so repeated edits do not stack listeners.
            cancelButton.onclick = function cancelEditHandler() {
                // Clear the input fields
                clearGroupForm();

                // Reset the button text to "Create Group"
                resetCreateButtonState();

                // Hide the Cancel button
                cancelButton.hidden = true;
                cancelButton.onclick = null;
            };

            // Scroll to the top of the page to show the input fields
            window.scrollTo(0, 0);
        });

        // Append the edit button to the group buttons
        editDeleteButtonElement.appendChild(editButton);

        // Append the edit/delete buttons to the group button element
        groupButtonElement.appendChild(editDeleteButtonElement);

        // Create the up/down button element
        const upDownButtonElement = document.createElement('div');
        upDownButtonElement.className = 'up-down-buttons';

        // Create the up button
        const upButton = document.createElement('button');
        upButton.className = 'options-button btn-up btn-icon-only';
        upButton.textContent = '';
        upButton.setAttribute('aria-label', 'Move group up');

        // Disable the up button if this is the first group
        if (groupPosition === 0) {
            upButton.disabled = true;
        }

        // Add an event listener to the up button
        upButton.addEventListener('click', async () => {
            // Get the stored groups from local storage
            /** @type {StoredGroup[]} */
            let storedGroups = await getStoredGroups();

            // Find the index of the current group
            const groupIndex = storedGroups.findIndex(g => g.name === group.name);
            if (groupIndex > 0) {
                // Swap with the previous group
                [storedGroups[groupIndex - 1], storedGroups[groupIndex]] = [storedGroups[groupIndex], storedGroups[groupIndex - 1]];
                await storeGroups(storedGroups);

                // Animate the DOM reorder in-place for smoother movement feedback.
                const movedCard = animateGroupReorder(optionsContainer, group.name, 'up');
                ensureCardStaysVisible(movedCard);

                // Reorganise all tabs in the current window
                await organiseAllTabs();
            }
        });

        // Append the up button to the up/down button element
        upDownButtonElement.appendChild(upButton);

        // Create the down button
        const downButton = document.createElement('button');
        downButton.className = 'options-button btn-down btn-icon-only';
        downButton.textContent = '';
        downButton.setAttribute('aria-label', 'Move group down');

        // Disable the down button if this is the last group
        if (groupPosition === storedGroups.length - 1) {
            downButton.disabled = true;
        }

        // Add an event listener to the down button
        downButton.addEventListener('click', async () => {
            // Get the stored groups from local storage
            /** @type {StoredGroup[]} */
            let storedGroups = await getStoredGroups();

            // Find the index of the current group
            const groupIndex = storedGroups.findIndex(g => g.name === group.name);
            if (groupIndex < storedGroups.length - 1) {
                // Swap with the next group
                [storedGroups[groupIndex + 1], storedGroups[groupIndex]] = [storedGroups[groupIndex], storedGroups[groupIndex + 1]];
                await storeGroups(storedGroups);

                // Animate the DOM reorder in-place for smoother movement feedback.
                const movedCard = animateGroupReorder(optionsContainer, group.name, 'down');
                ensureCardStaysVisible(movedCard);

                // Reorganise all tabs in the current window
                await organiseAllTabs();
            }
        });

        // Append the down button to the up/down button element
        upDownButtonElement.appendChild(downButton);

        // Append the up/down buttons to the group button element
        groupButtonElement.appendChild(upDownButtonElement);

        // Append the buttons to the group element
        groupElement.appendChild(groupButtonElement);

        // Append the group element to the options container
        optionsContainer.appendChild(groupElement);
    });
}

// This function will be called to organise all tabs in the current window
async function organiseAllTabs() {
    // Get all tabs in the current window
    const allTabs = await chrome.tabs.query({ currentWindow: true });

    // Iterate through each tab and organise it
    for (const tab of allTabs) {
        if (!tab.url) {
            continue;
        }

        // Skip any chrome: tabs
        let tabUrl;
        try {
            tabUrl = new URL(tab.url);
        } catch {
            continue;
        }

        if (tabUrl.protocol === 'chrome:') {
            continue;
        }

        // Skip if the window type is not normal
        const windowInfo = await chrome.windows.get(tab.windowId);
        if (windowInfo.type !== 'normal') {
            continue;
        }

        // Call the organiseTab function to handle the tab grouping logic
        await organiseTab(tab.id, tab);
    }

    // After organising all tabs, arrange the tab groups
    await arrangeTabGroups(null);
}

// Add an event listener for the "Organise All Tabs" button
byId('organise-all-tabs').addEventListener('click', async () => {
    await organiseAllTabs();
});
