/**
 * @typedef {import('../types/types.js').StoredGroup} StoredGroup
 */

document.addEventListener("DOMContentLoaded", async () => {
    await getStoredGroups();

    // Add event listener for the "Create Group" button
    const createGroupButton = document.getElementById('create-group');
    createGroupButton.addEventListener('click', async () => {
        // Get the group name and colour from the input fields
        const groupName = document.getElementById('group-name').value.trim();
        const groupColour = document.getElementById('group-colour').value.trim();
        const groupUrls = document.getElementById('group-urls').value.trim();

        // Validate inputs
        if (!groupName || !groupColour || !groupUrls) {
            alert("Please enter a valid group name and colour.");
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
        storedGroups.push(newGroup);
        await chrome.storage.local.set({ tab_groups: storedGroups });

        // Refresh the options UI to show the new group
        await getStoredGroups();

        // Clear input fields
        document.getElementById('group-name').value = '';
        document.getElementById('group-colour').value = '';
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

        optionsContainer.appendChild(groupElement);
    });
}
