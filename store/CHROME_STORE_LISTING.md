# Chrome Web Store Listing Copy

## Extension Name
Auto Tab Grouper

## Short Description
Automatically organize Chrome tabs into named groups by hostname or advanced regex rules.

## Detailed Description
Auto Tab Grouper keeps your browser tidy by automatically grouping tabs as pages load.

Use simple hostname rules like `github.com` for everyday setup, or advanced regex rules for power use-cases:
- `re:^https://(www\.)?news\.`
- `/^https:\/\/(docs|developer)\./i`

### Key Features
- Automatically groups tabs by rule match.
- Create, edit, delete, and reorder tab groups.
- Color-code tab groups for quick visual scanning.
- Supports plain hostname matching for most users.
- Supports optional regex rules for advanced users.

### How It Works
1. Open extension options.
2. Create a group name and choose a color.
3. Add one or more hostname rules.
4. Tabs are grouped automatically as they update.

### Permissions Rationale
- `tabs`: needed to read tab URLs and move tabs into groups.
- `tabGroups`: needed to create, update, move, and remove tab groups.
- `storage`: needed to save your grouping rules.

### Privacy
Auto Tab Grouper does not send your browsing data to external servers. Rules are stored in Chrome sync/local extension storage.

## Category Suggestions
Productivity

## Support URL
[GitHub Issues](https://github.com/schleising/chrome-tab-organiser/issues)

## Homepage URL
[Repo in GitHub](https://github.com/schleising/chrome-tab-organiser)
