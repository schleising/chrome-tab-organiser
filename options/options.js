/**
 * @typedef {import('../types/types.js').StoredGroup} StoredGroup
 */

import { storeGroups, getStoredGroups, organiseTab, deleteGroup, arrangeTabGroups } from '../shared/tab-grouper.js';

const ERROR_TIMEOUT_MS = 5000;
const DEFAULT_GROUP_COLOUR = 'blue';
const CREATE_GROUP_LABEL = 'Create Group';
const EXPORT_FILE_TYPE = 'application/json';
const DATA_TOOLS_STATUS_TIMEOUT_MS = 3000;
const PENDING_GROUP_DRAFT_KEY = 'pending_tab_group_draft';
const REORDER_ANIMATION_DURATION_MS = 480;
const REORDER_ANIMATION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const CHIP_REORDER_ANIMATION_DURATION_MS = 220;
const CHIP_REORDER_ANIMATION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const GROUP_CARD_REORDER_ANIMATION_DURATION_MS = 260;
const GROUP_CARD_REORDER_ANIMATION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

const byId = (id) => document.querySelector(`#${id}`);

/** @type {string[]} */
let pendingGroupUrls = [];
let editingHostnameIndex = null;
let draggingHostnameIndex = null;
let draggingGroupName = null;

let dataToolsStatusTimeoutId = null;

function isRegexEntry(entry) {
    const trimmed = entry.trim();
    return trimmed.startsWith('re:');
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
        item.draggable = true;
        item.dataset.hostIndex = String(index);
        item.dataset.hostValue = hostname;
        if (editingHostnameIndex === index) {
            item.classList.add('is-editing');
        }

        item.addEventListener('dragstart', (event) => {
            draggingHostnameIndex = index;
            item.classList.add('is-dragging');
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', String(index));
            }
        });

        item.addEventListener('dragover', (event) => {
            event.preventDefault();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = 'move';
            }

            const draggingChip = hostList.querySelector('.group-host-item.is-dragging');
            if (!draggingChip || draggingChip === item) {
                return;
            }

            const targetRect = item.getBoundingClientRect();
            const pointerRatioY = (event.clientY - targetRect.top) / Math.max(targetRect.height, 1);
            const pointerRatioX = (event.clientX - targetRect.left) / Math.max(targetRect.width, 1);
            const isNearVerticalMidline = Math.abs(event.clientY - (targetRect.top + targetRect.height / 2)) <= 8;

            // Use wider trigger bands so users don't need pinpoint midline dragging.
            const insertBefore = isNearVerticalMidline
                ? pointerRatioX < 0.55
                : pointerRatioY < 0.72;
            const referenceNode = insertBefore ? item : item.nextElementSibling;

            if (referenceNode === draggingChip) {
                return;
            }

            animateChipReflow(hostList, () => {
                hostList.insertBefore(draggingChip, referenceNode);
            });
        });

        item.addEventListener('dragend', () => {
            const editingHostnameValue = editingHostnameIndex !== null
                ? pendingGroupUrls[editingHostnameIndex]
                : null;

            const domOrder = Array.from(hostList.querySelectorAll('.group-host-item'))
                .map((chip) => chip.dataset.hostValue)
                .filter((value) => typeof value === 'string');

            if (domOrder.length === pendingGroupUrls.length) {
                pendingGroupUrls = domOrder;
                if (editingHostnameValue !== null) {
                    editingHostnameIndex = pendingGroupUrls.indexOf(editingHostnameValue);
                    if (editingHostnameIndex === -1) {
                        editingHostnameIndex = null;
                        setHostnameInputButtonMode(false);
                    }
                }
            }

            draggingHostnameIndex = null;
            void persistChipOrderForEditedGroup();
            renderPendingHostnames();
        });

        const hostText = document.createElement('span');
        hostText.textContent = hostname;
        if (isRegexEntry(hostname)) {
            hostText.classList.add('regex-hostname');
        }
        item.appendChild(hostText);

        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'host-edit-button';
        editButton.setAttribute('aria-label', `Edit ${hostname}`);
        editButton.setAttribute('title', 'Edit hostname');
        editButton.textContent = '';
        editButton.addEventListener('click', () => {
            editingHostnameIndex = index;
            setHostnameInputButtonMode(true);

            const hostInput = byId('group-urls');
            hostInput.value = hostname;
            hostInput.focus();
            hostInput.select();

            renderPendingHostnames();
        });
        item.appendChild(editButton);

        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'host-remove-button';
        removeButton.setAttribute('aria-label', `Remove ${hostname}`);
        removeButton.textContent = '×';
        removeButton.addEventListener('click', () => {
            pendingGroupUrls.splice(index, 1);
            if (editingHostnameIndex === index) {
                editingHostnameIndex = null;
                setHostnameInputButtonMode(false);
                byId('group-urls').value = '';
            } else if (editingHostnameIndex !== null && editingHostnameIndex > index) {
                editingHostnameIndex -= 1;
            }
            renderPendingHostnames();
        });

        item.appendChild(removeButton);
        hostList.appendChild(item);
    });
}

function animateChipReflow(container, mutateLayout) {
    const chipsBefore = Array.from(container.querySelectorAll('.group-host-item'));
    const beforeRects = new Map(chipsBefore.map((chip) => [chip, chip.getBoundingClientRect()]));

    mutateLayout();

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
        return;
    }

    const chipsAfter = Array.from(container.querySelectorAll('.group-host-item'));
    for (const chip of chipsAfter) {
        if (chip.classList.contains('is-dragging')) {
            continue;
        }

        const before = beforeRects.get(chip);
        if (!before) {
            continue;
        }

        const after = chip.getBoundingClientRect();
        const deltaX = before.left - after.left;
        const deltaY = before.top - after.top;

        if (deltaX !== 0 || deltaY !== 0) {
            chip.animate(
                [
                    { transform: `translate(${deltaX}px, ${deltaY}px)` },
                    { transform: 'translate(0, 0)' }
                ],
                {
                    duration: CHIP_REORDER_ANIMATION_DURATION_MS,
                    easing: CHIP_REORDER_ANIMATION_EASING,
                    fill: 'both'
                }
            );
        }
    }
}

function animateGroupCardReflow(container, mutateLayout) {
    const cardsBefore = Array.from(container.querySelectorAll('.existing-group'));
    const beforeRects = new Map(cardsBefore.map((card) => [card, card.getBoundingClientRect()]));

    mutateLayout();

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
        return;
    }

    const cardsAfter = Array.from(container.querySelectorAll('.existing-group'));
    for (const card of cardsAfter) {
        if (card.classList.contains('is-dragging')) {
            continue;
        }

        const before = beforeRects.get(card);
        if (!before) {
            continue;
        }

        const after = card.getBoundingClientRect();
        const deltaY = before.top - after.top;
        if (deltaY !== 0) {
            card.animate(
                [
                    { transform: `translateY(${deltaY}px)` },
                    { transform: 'translateY(0)' }
                ],
                {
                    duration: GROUP_CARD_REORDER_ANIMATION_DURATION_MS,
                    easing: GROUP_CARD_REORDER_ANIMATION_EASING,
                    fill: 'both'
                }
            );
        }
    }
}

async function persistDraggedGroupOrder(optionsContainer) {
    const orderedGroupNames = Array.from(optionsContainer.querySelectorAll('.existing-group'))
        .map((card) => card.dataset.groupName)
        .filter((name) => typeof name === 'string');

    if (orderedGroupNames.length === 0) {
        return;
    }

    let storedGroups = await getStoredGroups();
    const byName = new Map(storedGroups.map((group) => [group.name, group]));
    const reorderedGroups = orderedGroupNames
        .map((name) => byName.get(name))
        .filter((group) => Boolean(group));

    if (reorderedGroups.length !== storedGroups.length) {
        return;
    }

    const hasChanged = reorderedGroups.some((group, index) => group.name !== storedGroups[index].name);
    if (!hasChanged) {
        return;
    }

    storedGroups = reorderedGroups;
    await storeGroups(storedGroups);
    await organiseAllTabs({ arrangeOnly: true });
}

function setHostnameInputButtonMode(isUpdate) {
    const addHostnameButton = byId('add-hostname');
    if (!addHostnameButton) {
        return;
    }

    addHostnameButton.textContent = isUpdate ? 'Update' : 'Add';
    addHostnameButton.classList.toggle('btn-save', isUpdate);
    addHostnameButton.classList.toggle('btn-add', !isUpdate);
}

function addHostnamesFromInput() {
    const hostInput = byId('group-urls');
    const groupError = byId('group-error');
    const parsedHostnames = normaliseHostnames(hostInput.value);

    if (editingHostnameIndex !== null && parsedHostnames.length !== 1) {
        groupError.textContent = 'Update mode expects exactly one hostname.';
        groupError.hidden = false;
        return false;
    }

    for (const hostname of parsedHostnames) {
        if (!isValidRegexEntry(hostname)) {
            groupError.textContent = `Invalid regex: ${hostname}`;
            groupError.hidden = false;
            return false;
        }
    }

    groupError.textContent = '';
    groupError.hidden = true;

    if (editingHostnameIndex !== null) {
        const updatedHostname = parsedHostnames[0];
        const duplicateIndex = pendingGroupUrls.findIndex((hostname, index) => hostname === updatedHostname && index !== editingHostnameIndex);
        if (duplicateIndex !== -1) {
            groupError.textContent = 'That hostname already exists in this group.';
            groupError.hidden = false;
            return false;
        }

        pendingGroupUrls[editingHostnameIndex] = updatedHostname;
        editingHostnameIndex = null;
        setHostnameInputButtonMode(false);
    } else {
        for (const hostname of parsedHostnames) {
            if (!pendingGroupUrls.includes(hostname)) {
                pendingGroupUrls.push(hostname);
            }
        }
    }

    hostInput.value = '';
    renderPendingHostnames();
    hostInput.focus();
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

    const groupFormTitle = byId('group-form-title');
    if (groupFormTitle) {
        groupFormTitle.textContent = 'Create New Group';
    }
}

function clearGroupForm() {
    byId('group-name').value = '';
    byId('group-colour').value = DEFAULT_GROUP_COLOUR;
    byId('group-urls').value = '';
    pendingGroupUrls = [];
    editingHostnameIndex = null;
    draggingHostnameIndex = null;
    setHostnameInputButtonMode(false);
    renderPendingHostnames();
}

function getEditingGroupName() {
    const createGroupButton = byId('create-group');
    if (!createGroupButton?.textContent?.startsWith('Update ')) {
        return null;
    }

    const groupName = createGroupButton.textContent.replace('Update ', '').trim();
    return groupName || null;
}

async function persistChipOrderForEditedGroup() {
    const editingGroupName = getEditingGroupName();
    if (!editingGroupName) {
        return;
    }

    const storedGroups = await getStoredGroups();
    const groupIndex = storedGroups.findIndex((group) => group.name === editingGroupName);
    if (groupIndex === -1) {
        return;
    }

    const existingOrder = storedGroups[groupIndex].urls;
    const hasChanged = existingOrder.length !== pendingGroupUrls.length
        || existingOrder.some((url, index) => url !== pendingGroupUrls[index]);

    if (!hasChanged) {
        return;
    }

    storedGroups[groupIndex].urls = [...pendingGroupUrls];
    await storeGroups(storedGroups);

    // Reorder tabs once after chip drag finishes; no live tab reorder during drag.
    await organiseAllTabs({ arrangeOnly: true });
}

function cancelCurrentGroupEdit() {
    clearGroupForm();
    resetCreateButtonState();

    const cancelButton = byId('cancel-edit');
    if (cancelButton) {
        cancelButton.hidden = true;
    }
}

function setDataToolsStatus(message, isError = false) {
    const statusElement = byId('data-tools-status');
    if (!statusElement) {
        return;
    }

    if (dataToolsStatusTimeoutId) {
        clearTimeout(dataToolsStatusTimeoutId);
        dataToolsStatusTimeoutId = null;
    }

    statusElement.hidden = !message;
    statusElement.textContent = message;
    statusElement.classList.toggle('data-tools-status-error', isError);

    if (message) {
        dataToolsStatusTimeoutId = setTimeout(() => {
            statusElement.hidden = true;
            statusElement.textContent = '';
            statusElement.classList.remove('data-tools-status-error');
            dataToolsStatusTimeoutId = null;
        }, DATA_TOOLS_STATUS_TIMEOUT_MS);
    }
}

async function applyPendingTabDraftToForm() {
    const draftResult = await chrome.storage.local.get(PENDING_GROUP_DRAFT_KEY);
    const draft = draftResult?.[PENDING_GROUP_DRAFT_KEY];
    if (!draft || typeof draft.url !== 'string') {
        return;
    }

    const suggestedName = typeof draft.nameSuggestion === 'string' ? draft.nameSuggestion.trim() : '';
    byId('group-name').value = suggestedName;

    const normalisedDraftUrl = isRegexEntry(draft.url) ? draft.url.trim() : draft.url.trim().toLowerCase();
    pendingGroupUrls = normalisedDraftUrl ? [normalisedDraftUrl] : [];
    editingHostnameIndex = null;
    setHostnameInputButtonMode(false);
    renderPendingHostnames();

    byId('group-urls').value = '';
    byId('group-urls').focus();
    window.scrollTo(0, 0);
    setDataToolsStatus('Loaded tab into Create New Group.', false);

    await chrome.storage.local.remove(PENDING_GROUP_DRAFT_KEY);
}

function getExportPayload(groups) {
    return {
        schema: 'chrome-tab-organiser/v1',
        exportedAt: new Date().toISOString(),
        groups
    };
}

function validateImportedGroups(data) {
    const allowedColours = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);
    const groupsCandidate = Array.isArray(data) ? data : data?.groups;
    if (!Array.isArray(groupsCandidate)) {
        throw new Error('JSON must be an array of groups or an object with a groups array.');
    }

    const normalisedGroups = groupsCandidate.map((group) => {
        if (!group || typeof group.name !== 'string' || typeof group.colour !== 'string' || !Array.isArray(group.urls)) {
            throw new Error('JSON groups are malformed. Expected {name, colour, urls[]} entries.');
        }

        const name = group.name.trim();
        const colour = group.colour.trim().toLowerCase();
        if (!name) {
            throw new Error('Group names must be non-empty.');
        }
        if (!allowedColours.has(colour)) {
            throw new Error(`Unsupported group colour: ${group.colour}`);
        }

        const urls = group.urls
            .map((url) => {
                if (typeof url !== 'string') {
                    throw new Error('Each URL entry must be a string.');
                }
                const trimmedUrl = url.trim();
                if (!trimmedUrl) {
                    throw new Error('URL entries must be non-empty.');
                }
                return isRegexEntry(trimmedUrl) ? trimmedUrl : trimmedUrl.toLowerCase();
            });

        if (urls.length === 0) {
            throw new Error(`Group "${name}" must contain at least one URL entry.`);
        }

        return {
            name,
            colour,
            urls: Array.from(new Set(urls))
        };
    });

    return normalisedGroups;
}

function mergeGroupsByName(existingGroups, importedGroups) {
    const mergedMap = new Map(existingGroups.map((group) => [group.name, { ...group, urls: [...group.urls] }]));

    importedGroups.forEach((importedGroup) => {
        const existingGroup = mergedMap.get(importedGroup.name);
        if (!existingGroup) {
            mergedMap.set(importedGroup.name, { ...importedGroup, urls: [...importedGroup.urls] });
            return;
        }

        // Merge keeps URLs added after export while still applying imported updates.
        const mergedUrls = Array.from(new Set([...existingGroup.urls, ...importedGroup.urls]));
        mergedMap.set(importedGroup.name, {
            ...existingGroup,
            ...importedGroup,
            urls: mergedUrls
        });
    });

    return Array.from(mergedMap.values());
}

function requestImportMode() {
    return new Promise((resolve) => {
        const importDialog = byId('import-dialog');
        if (!importDialog) {
            resolve('overwrite');
            return;
        }

        importDialog.returnValue = '';
        importDialog.showModal();

        const onClose = () => {
            importDialog.removeEventListener('close', onClose);
            const chosenMode = importDialog.returnValue;
            if (chosenMode === 'merge' || chosenMode === 'overwrite') {
                resolve(chosenMode);
                return;
            }
            resolve('cancel');
        };

        importDialog.addEventListener('close', onClose);
    });
}

function downloadTextFile(content, fileName) {
    const blob = new Blob([content], { type: EXPORT_FILE_TYPE });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
}

async function exportGroupsToJson() {
    try {
        const groups = await getStoredGroups();
        const exportPayload = getExportPayload(groups);
        const exportText = JSON.stringify(exportPayload, null, 2);
        const dateSuffix = new Date().toISOString().slice(0, 10);
        const fileName = `chrome-tab-organiser-groups-${dateSuffix}.json`;

        if ('showSaveFilePicker' in window) {
            const fileHandle = await window.showSaveFilePicker({
                suggestedName: fileName,
                types: [{
                    description: 'JSON Files',
                    accept: { [EXPORT_FILE_TYPE]: ['.json'] }
                }]
            });

            const writable = await fileHandle.createWritable();
            await writable.write(exportText);
            await writable.close();
        } else {
            downloadTextFile(exportText, fileName);
        }

        setDataToolsStatus(`Exported ${groups.length} group(s).`, false);
    } catch (error) {
        if (error?.name === 'AbortError') {
            setDataToolsStatus('Export cancelled.', false);
            return;
        }
        setDataToolsStatus(`Export failed: ${error?.message || error}`, true);
    }
}

async function applyImportedJsonText(rawText) {
    const parsed = JSON.parse(rawText);
    const importedGroups = validateImportedGroups(parsed);
    const existingGroups = await getStoredGroups();

    let groupsToStore = importedGroups;
    if (existingGroups.length > 0) {
        const importMode = await requestImportMode();
        if (importMode === 'cancel') {
            setDataToolsStatus('Import cancelled.', false);
            return;
        }

        if (importMode === 'merge') {
            groupsToStore = mergeGroupsByName(existingGroups, importedGroups);
        }
    }

    await storeGroups(groupsToStore);
    await initialiseOptionsDialog();
    await organiseAllTabs();
    setDataToolsStatus(`Imported ${groupsToStore.length} group(s).`, false);
}

async function importGroupsFromPicker() {
    try {
        if ('showOpenFilePicker' in window) {
            const [fileHandle] = await window.showOpenFilePicker({
                multiple: false,
                types: [{
                    description: 'JSON Files',
                    accept: { [EXPORT_FILE_TYPE]: ['.json'] }
                }]
            });

            const file = await fileHandle.getFile();
            const text = await file.text();
            await applyImportedJsonText(text);
            return;
        }

        byId('import-groups-file').click();
    } catch (error) {
        if (error?.name === 'AbortError') {
            setDataToolsStatus('Import cancelled.', false);
            return;
        }
        setDataToolsStatus(`Import failed: ${error?.message || error}`, true);
    }
}

function ensureCardStaysVisible(card) {
    if (!card || !card.isConnected) {
        return;
    }

    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function getGroupCardByName(groupName) {
    if (!groupName) {
        return null;
    }

    return Array.from(document.querySelectorAll('.existing-group'))
        .find((card) => card.dataset.groupName === groupName) || null;
}

function ensureGroupCardStaysVisible(groupName) {
    const card = getGroupCardByName(groupName);
    if (!card) {
        return;
    }

    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function followGroupDuringAnimation(groupName, durationMs) {
    if (!groupName) {
        return;
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
        ensureGroupCardStaysVisible(groupName);
        return;
    }

    const VIEWPORT_MARGIN = 56;
    const MAX_SCROLL_PER_FRAME = 18;
    const startTime = performance.now();

    const tick = (now) => {
        const elapsed = now - startTime;
        const card = getGroupCardByName(groupName);

        if (card) {
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
        }

        if (elapsed < durationMs + 180) {
            requestAnimationFrame(tick);
            return;
        }

        ensureGroupCardStaysVisible(groupName);
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

    followGroupDuringAnimation(movedGroupName, REORDER_ANIMATION_DURATION_MS);

    return movedCard;
}

document.addEventListener("DOMContentLoaded", async () => {
    const addHostnameButton = byId('add-hostname');
    const hostInput = byId('group-urls');
    const cancelEditButton = byId('cancel-edit');
    const exportGroupsButton = byId('export-groups');
    const importGroupsButton = byId('import-groups');
    const importGroupsFileInput = byId('import-groups-file');

    addHostnameButton.addEventListener('click', addHostnamesFromInput);
    cancelEditButton?.addEventListener('click', cancelCurrentGroupEdit);
    hostInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            addHostnamesFromInput();
        }
    });

    renderPendingHostnames();
    setHostnameInputButtonMode(false);
    await initialiseOptionsDialog();
    await applyPendingTabDraftToForm();

    exportGroupsButton?.addEventListener('click', exportGroupsToJson);
    importGroupsButton?.addEventListener('click', importGroupsFromPicker);
    importGroupsFileInput?.addEventListener('change', async (event) => {
        try {
            const selectedFile = event.target.files?.[0];
            if (!selectedFile) {
                return;
            }

            const text = await selectedFile.text();
            await applyImportedJsonText(text);
        } catch (error) {
            setDataToolsStatus(`Import failed: ${error?.message || error}`, true);
        } finally {
            event.target.value = '';
        }
    });

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

    // Keep the options UI in sync when groups are changed outside this page (e.g. context menu actions).
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'sync' && changes.tab_groups) {
            void initialiseOptionsDialog();
        }

        if (areaName === 'local' && changes[PENDING_GROUP_DRAFT_KEY]?.newValue) {
            void applyPendingTabDraftToForm();
        }
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
        groupElement.draggable = true;

        groupElement.addEventListener('dragstart', (event) => {
            draggingGroupName = group.name;
            groupElement.classList.add('is-dragging');
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', group.name);
            }
        });

        groupElement.addEventListener('dragover', (event) => {
            event.preventDefault();
            if (!draggingGroupName) {
                return;
            }

            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = 'move';
            }

            const draggingCard = optionsContainer.querySelector('.existing-group.is-dragging');
            if (!draggingCard || draggingCard === groupElement) {
                return;
            }

            const targetRect = groupElement.getBoundingClientRect();
            const pointerRatio = (event.clientY - targetRect.top) / Math.max(targetRect.height, 1);
            const insertBefore = pointerRatio < 0.62;
            const referenceNode = insertBefore ? groupElement : groupElement.nextElementSibling;

            if (referenceNode === draggingCard) {
                return;
            }

            animateGroupCardReflow(optionsContainer, () => {
                optionsContainer.insertBefore(draggingCard, referenceNode);
            });
        });

        groupElement.addEventListener('dragend', () => {
            draggingGroupName = null;
            groupElement.classList.remove('is-dragging');
            void persistDraggedGroupOrder(optionsContainer);
            void initialiseOptionsDialog();
        });

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

        // Create a read-only chip list of URLs for the group.
        const groupUrlsElement = document.createElement('ul');
        groupUrlsElement.className = 'group-host-list group-host-list-readonly';
        group.urls.forEach((url) => {
            const urlElement = document.createElement('li');
            urlElement.className = 'group-host-item group-host-item-readonly';

            const urlText = document.createElement('span');
            urlText.textContent = url;
            if (isRegexEntry(url)) {
                urlText.classList.add('regex-hostname');
            }

            urlElement.appendChild(urlText);
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
            editingHostnameIndex = null;
            setHostnameInputButtonMode(false);
            renderPendingHostnames();

            // Set the button text to "Update <Group Name>"
            const createGroupButton = byId('create-group');
            createGroupButton.textContent = `Update ${group.name}`;
            createGroupButton.classList.remove('btn-create');
            createGroupButton.classList.add('btn-save');

            const groupFormTitle = byId('group-form-title');
            if (groupFormTitle) {
                groupFormTitle.textContent = `Editing ${group.name}`;
            }

            // Unhide the Cancel button
            const cancelButton = byId('cancel-edit');
            cancelButton.hidden = false;

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
                animateGroupReorder(optionsContainer, group.name, 'up');

                // Only ordering changed, so avoid a full re-match pass.
                await organiseAllTabs({ arrangeOnly: true });
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
                animateGroupReorder(optionsContainer, group.name, 'down');

                // Only ordering changed, so avoid a full re-match pass.
                await organiseAllTabs({ arrangeOnly: true });
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
async function organiseAllTabs({ arrangeOnly = false, windowIds = null } = {}) {
    const allNormalWindows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    const targetWindows = Array.isArray(windowIds)
        ? allNormalWindows.filter((windowInfo) => windowIds.includes(windowInfo.id))
        : allNormalWindows;

    if (targetWindows.length === 0) {
        return;
    }

    const storedGroups = await getStoredGroups();

    if (storedGroups.length === 0) {
        return;
    }

    // Iterate through each normal window and organise its tabs.
    for (const windowInfo of targetWindows) {
        if (arrangeOnly) {
            await arrangeTabGroups(windowInfo.id);
            continue;
        }

        const allTabs = await chrome.tabs.query({ windowId: windowInfo.id });

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

            // Call the organiseTab function to handle the tab grouping logic
            await organiseTab(tab.id, tab, storedGroups);
        }

        // After organising tabs in this window, arrange that window's groups.
        await arrangeTabGroups(windowInfo.id);
    }
}

