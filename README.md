# Fleeting Notes Plugin

This is a plugin to sync [Fleeting Notes](https://fleetingnotes.app/) with Obsidian

Full guide on using the plugin: https://fleetingnotes.app/posts/sync-fleeting-notes-with-obsidian

## Installation
1. Go to Settings > Community Plugin and turn off Restricted mode
2. Click "Browse" and search for "Fleeting Notes Sync"
3. Install the plugin and ensure you have it enabled
4. Once enabled click "Fleeting Notes Sync" under Plugin Options > Fleeting Notes Sync. Under here, fill in your username, password, and desired folder location to sync your notes. Additionally, you can toggle the "Sync notes on startup", to run the sync whenever Obsidian is opened.

## Usage
1. Now open the [command palette](https://help.obsidian.md/Plugins/Command+palette) and run `Fleeting Notes: Pull All Notes from Fleeting Notes`
2. Your notes will be synced with Fleeting Notes and you will get a notification!

## Release Steps
1. Checkout new branch
```
git checkout -b version-X.X.X
```
2. Run bumpversion script `./bumpversion X.X.X`
3. Push commit and tags to new branch
```
git push
git push --tags
```
4. Add changes to releases in github (https://github.com/fleetingnotes/fleeting-notes-obsidian/releases)
5. Publish release and merge PR.
