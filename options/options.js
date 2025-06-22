/**
 * @typedef {import('../types/types.js').StoredGroup} StoredGroup
 */

import { organiseTab } from '../shared/tab-grouper.js';

document.addEventListener("DOMContentLoaded", async () => {
    await getStoredGroups();

    // Add event listener for the "Create Group" button
    const createGroupButton = document.getElementById('create-group');
    createGroupButton.addEventListener('click', async () => {
        // Clear any previous error messages
        document.getElementById('group-error').textContent = "";
        document.getElementById('group-error').hidden = true;

        // Get the group name and colour from the input fields
        const groupName = document.getElementById('group-name').value.trim();
        const groupColour = document.getElementById('group-colour').value.trim();
        const groupUrls = document.getElementById('group-urls').value.trim();

        // Validate inputs
        if (!groupName || !groupColour || !groupUrls) {
            // Show error message if inputs are invalid
            document.getElementById('group-error').textContent = "Invalid input: group name, colour, and URLs are required.";
            document.getElementById('group-error').hidden = false;

            // Clear the error message after 5 seconds
            setTimeout(() => {
                document.getElementById('group-error').textContent = "";
                document.getElementById('group-error').hidden = true;
            }, 5000);
            return;
        }

        // Create a new group object
        /** @type {StoredGroup} */
        const newGroup = {
            name: groupName,
            urls: groupUrls.split(',').map(url => url.trim().toLowerCase()), // Split URLs by comma and trim whitespace
            colour: groupColour
        };

        // Store the new group in local storage
        let storedGroups = await chrome.storage.sync.get('tab_groups');
        storedGroups = storedGroups.tab_groups || [];

        // Check whether we are updating an existing group or creating a new one
        if (createGroupButton.textContent.startsWith('Update')) {
            // If the button text starts with "Update", we are editing an existing group
            const existingGroupName = createGroupButton.textContent.replace('Update ', '').trim();

            if (existingGroupName !== newGroup.name) {
                // Check if the new group name already exists
                const existingGroupIndex = storedGroups.findIndex(g => g.name === newGroup.name);
                if (existingGroupIndex !== -1) {
                    // If a group with the new name already exists, show an error message
                    document.getElementById('group-error').textContent = "A group with this name already exists, edit that one instead.";
                    document.getElementById('group-error').hidden = false;

                    // Clear the error message after 5 seconds
                    setTimeout(() => {
                        document.getElementById('group-error').textContent = "";
                        document.getElementById('group-error').hidden = true;
                    }, 5000);
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
            createGroupButton.textContent = 'Create Group';
            // Hide the Cancel button
            const cancelButton = document.getElementById('cancel-edit');
            cancelButton.hidden = true;
        } else {
            // If the button text does not start with "Update", we are creating a new group
            // Check if a group with the same name already exists
            const existingGroupIndex = storedGroups.findIndex(g => g.name === newGroup.name);
            if (existingGroupIndex !== -1) {
                // If a group with the same name exists, show an error message
                document.getElementById('group-error').textContent = "A group with this name already exists, edit it instead.";
                document.getElementById('group-error').hidden = false;

                // Clear the error message after 5 seconds
                setTimeout(() => {
                    document.getElementById('group-error').textContent = "";
                    document.getElementById('group-error').hidden = true;
                }, 5000);
                return;
            } else {
                // If the group does not exist, add the new group to the stored groups
                storedGroups.push(newGroup);
            }
        }

        // Add the new group to the stored groups
        await chrome.storage.sync.set({ tab_groups: storedGroups });


        // Organise all tabs in the current window
        await organiseAllTabs();

        // Refresh the options UI to show the new group
        await getStoredGroups();

        // Clear input fields
        document.getElementById('group-name').value = '';
        document.getElementById('group-colour').value = 'blue';
        document.getElementById('group-urls').value = '';
    });
});

async function getStoredGroups() {
    // Load options from storage
    /** @type {StoredGroup[]} */
    let storedGroups = await chrome.storage.sync.get('tab_groups');
    storedGroups = storedGroups.tab_groups || [];

    // Populate the options UI with the stored groups
    const optionsContainer = document.getElementById('existing-group-container');
    optionsContainer.innerHTML = ''; // Clear existing content

    // Build the UI for each stored group
    storedGroups.forEach(group => {
        // Create a new element for the group
        const groupElement = document.createElement('div');
        groupElement.className = 'existing-group';

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
        deleteButton.className = 'options-button';
        deleteButton.textContent = 'Delete Group';

        // Add an event listener to the delete button
        deleteButton.addEventListener('click', async () => {
            // Remove the group from storage
            let storedGroups = await chrome.storage.sync.get('tab_groups');
            storedGroups = storedGroups.tab_groups || [];
            storedGroups = storedGroups.filter(g => g.name !== group.name);
            await chrome.storage.sync.set({ tab_groups: storedGroups });

            // Refresh the options UI
            await getStoredGroups();

            // Organise all tabs in the current window
            await organiseAllTabs();
        });

        // Append the delete button to the group buttons
        editDeleteButtonElement.appendChild(deleteButton);

        // Create the edit button
        const editButton = document.createElement('button');
        editButton.className = 'options-button';
        editButton.textContent = 'Edit Group';

        // Add an event listener to the edit button
        editButton.addEventListener('click', () => {
            // Populate the input fields with the group's data for editing
            document.getElementById('group-name').value = group.name;
            document.getElementById('group-colour').value = group.colour;
            document.getElementById('group-urls').value = group.urls.join(', ');

            // Set the button text to "Update <Group Name>"
            const createGroupButton = document.getElementById('create-group');
            createGroupButton.textContent = `Update ${group.name}`;

            // Unhide the Cancel button
            const cancelButton = document.getElementById('cancel-edit');
            cancelButton.hidden = false;

            // Add an event listener to the Cancel button to reset the form
            cancelButton.addEventListener('click', () => {
                // Clear the input fields
                document.getElementById('group-name').value = '';
                document.getElementById('group-colour').value = 'blue';
                document.getElementById('group-urls').value = '';

                // Reset the button text to "Create Group"
                createGroupButton.textContent = 'Create Group';

                // Hide the Cancel button
                cancelButton.hidden = true;

                // Remove this event listener
                cancelButton.removeEventListener('click', arguments.callee);
            });

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
        upButton.className = 'options-button';
        upButton.textContent = '▲';

        // Disable the up button if this is the first group
        if (storedGroups.indexOf(group) === 0) {
            upButton.disabled = true;
        }

        // Add an event listener to the up button
        upButton.addEventListener('click', async () => {
            // Get the stored groups from local storage
            let storedGroups = await chrome.storage.sync.get('tab_groups');
            storedGroups = storedGroups.tab_groups || [];

            // Find the index of the current group
            const groupIndex = storedGroups.findIndex(g => g.name === group.name);
            if (groupIndex > 0) {
                // Swap with the previous group
                [storedGroups[groupIndex - 1], storedGroups[groupIndex]] = [storedGroups[groupIndex], storedGroups[groupIndex - 1]];
                await chrome.storage.sync.set({ tab_groups: storedGroups });

                // Refresh the options UI
                await getStoredGroups();

                // Reorganise all tabs in the current window
                await organiseAllTabs();
            }
        });

        // Append the up button to the up/down button element
        upDownButtonElement.appendChild(upButton);

        // Create the down button
        const downButton = document.createElement('button');
        downButton.className = 'options-button';
        downButton.textContent = '▼';

        // Disable the down button if this is the last group
        if (storedGroups.indexOf(group) === storedGroups.length - 1) {
            downButton.disabled = true;
        }

        // Add an event listener to the down button
        downButton.addEventListener('click', async () => {
            // Get the stored groups from local storage
            let storedGroups = await chrome.storage.sync.get('tab_groups');
            storedGroups = storedGroups.tab_groups || [];

            // Find the index of the current group
            const groupIndex = storedGroups.findIndex(g => g.name === group.name);
            if (groupIndex < storedGroups.length - 1) {
                // Swap with the next group
                [storedGroups[groupIndex + 1], storedGroups[groupIndex]] = [storedGroups[groupIndex], storedGroups[groupIndex + 1]];
                await chrome.storage.sync.set({ tab_groups: storedGroups });

                // Refresh the options UI
                await getStoredGroups();

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
        await organiseTab(tab.id, tab);
    }
}

// Add an event listener for the "Organise All Tabs" button
document.getElementById('organise-all-tabs').addEventListener('click', async () => {
    await organiseAllTabs();
});
