/**
 * @typedef {import('../types/types.js').StoredGroup} StoredGroup
 */

document.addEventListener("DOMContentLoaded", async () => {
    await getStoredGroups();

    // Add event listener for the "Create Group" button
    const createGroupButton = document.getElementById('create-group');
    createGroupButton.addEventListener('click', async () => {
        // Clear any previous error messages
        document.getElementById('group-error').textContent = "";

        // Get the group name and colour from the input fields
        const groupName = document.getElementById('group-name').value.trim();
        const groupColour = document.getElementById('group-colour').value.trim();
        const groupUrls = document.getElementById('group-urls').value.trim();

        // Validate inputs
        if (!groupName || !groupColour || !groupUrls) {
            document.getElementById('group-error').textContent = "Invalid input: group name, colour, and URLs are required.";
            return;
        }

        // Create a new group object
        /** @type {StoredGroup} */
        const newGroup = {
            name: groupName,
            urls: groupUrls.split(',').map(url => url.trim()), // Split URLs by comma and trim whitespace
            colour: groupColour
        };

        // Store the new group in local storage
        let storedGroups = await chrome.storage.local.get('tab_groups');
        storedGroups = storedGroups.tab_groups || [];

        // If a group with the same name exists, update it instead of creating a new one
        const existingGroupIndex = storedGroups.findIndex(g => g.name === newGroup.name);
        if (existingGroupIndex !== -1) {
            // Update the existing group
            storedGroups[existingGroupIndex] = newGroup;
        } else {
            // Add the new group to the list
            storedGroups.push(newGroup);
        }
        await chrome.storage.local.set({ tab_groups: storedGroups });

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
    let storedGroups = await chrome.storage.local.get('tab_groups');
    storedGroups = storedGroups.tab_groups || [];

    // Populate the options UI with the stored groups
    const optionsContainer = document.getElementById('existing-group-container');
    optionsContainer.innerHTML = ''; // Clear existing content

    storedGroups.forEach(group => {
        const groupElement = document.createElement('div');
        groupElement.className = 'existing-group';

        const groupHeaderElement = document.createElement('div');
        groupHeaderElement.className = 'existing-group-header';

        const groupNameElement = document.createElement('h3');
        groupNameElement.textContent = group.name;
        groupHeaderElement.appendChild(groupNameElement);

        const groupColourElement = document.createElement('p');
        groupColourElement.textContent = `Colour: ${group.colour}`;
        groupHeaderElement.appendChild(groupColourElement);

        groupElement.appendChild(groupHeaderElement);

        const groupUrlsElement = document.createElement('ul');
        group.urls.forEach(url => {
            const urlElement = document.createElement('li');
            urlElement.textContent = url;
            groupUrlsElement.appendChild(urlElement);
        });
        groupElement.appendChild(groupUrlsElement);

        const groupButtonElement = document.createElement('div');
        groupButtonElement.className = 'existing-group-buttons';
        const deleteButton = document.createElement('button');
        deleteButton.textContent = 'Delete Group';
        deleteButton.addEventListener('click', async () => {
            // Remove the group from storage
            let storedGroups = await chrome.storage.local.get('tab_groups');
            storedGroups = storedGroups.tab_groups || [];
            storedGroups = storedGroups.filter(g => g.name !== group.name);
            await chrome.storage.local.set({ tab_groups: storedGroups });

            // Refresh the options UI
            await getStoredGroups();
        });
        groupButtonElement.appendChild(deleteButton);

        const editButton = document.createElement('button');
        editButton.textContent = 'Edit Group';
        editButton.addEventListener('click', () => {
            // Populate the input fields with the group's data for editing
            document.getElementById('group-name').value = group.name;
            document.getElementById('group-colour').value = group.colour;
            document.getElementById('group-urls').value = group.urls.join(', ');
        });
        groupButtonElement.appendChild(editButton);

        groupElement.appendChild(groupButtonElement);

        optionsContainer.appendChild(groupElement);
    });
}
