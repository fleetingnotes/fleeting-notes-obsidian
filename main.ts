import { App, Notice, Plugin, PluginSettingTab, Setting, request, Vault, MetadataCache, TFile } from 'obsidian';
import { stringify } from 'querystring';

// Remember to rename these classes and interfaces!

interface FleetingNotesSettings {
	fleeting_notes_folder: string;
	sync_on_startup: boolean;
	username: string;
	password: string;
}

const DEFAULT_SETTINGS: FleetingNotesSettings = {
	fleeting_notes_folder: '',
	sync_on_startup: false,
	username: '',
	password: '',
}

export default class FleetingNotesPlugin extends Plugin {
	settings: FleetingNotesSettings;

	async onload() {
		await this.loadSettings();
		// This forces fleeting notes to sync with obsidian
		this.addCommand({
			id: 'sync-fleeting-notes',
			name: 'Pull All Notes from Fleeting Notes',
			callback: async () => {
				this.syncFleetingNotes();
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new FleetingNotesSettingTab(this.app, this));

		// syncs on startup
		if (this.settings.sync_on_startup) {
			this.syncFleetingNotes();
		}
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async syncFleetingNotes () {
		var existingNotes = await this.getExistingFleetingNotes(this.settings.fleeting_notes_folder);
		try {
			let notes = await getAllNotesRealm(this.settings.username, this.settings.password);
			notes = notes.filter((note: Note) => !note._isDeleted);
			await this.writeNotes(notes, this.settings.fleeting_notes_folder);
			new Notice('Fleeting Notes sync success!');
		} catch (e) {
			console.error(e);
			new Notice('Fleeing Notes sync failed - please check settings');
		}
	}
	async getExistingFleetingNotes (dir: string) {
		var files = this.app.vault.getFiles();
		let noteMap: Map<string, TFile> = new Map<string, TFile>();
		for (var i = 0; i < files.length; i++) {
			var file = files[i];
			var file_id: string;
			var metadata = await this.app.metadataCache.getFileCache(file);
			if (metadata.frontmatter){
				file_id = metadata.frontmatter.id || null;
			} else {
				file_id = null
			}
			if (!file.path.startsWith(dir) || file_id == null) {
				continue
			}
			noteMap.set(file_id, file);
		}
		return noteMap;
	}
	// TODO: add templating in the future
	async writeNotes (notes: Array<Note>, folder: string) {
		var folderObj = this.app.vault.getAbstractFileByPath(folder);
		if (folderObj == null) {
			await this.app.vault.createFolder(folder);
		}
		var existingNotes = await this.getExistingFleetingNotes(folder);
		for (var i = 0; i < notes.length; i++) {
			var note = notes[i];
			var newTs = note.timestamp.replace(':', 'h').replace(':', 'm') + 's';
			var title = (note.title) ? `${note.title}.md` : `${newTs}.md`;
			var frontmatter = 
`---
id: ${note._id}
title: ${title.replace('.md', '')}
date: ${note.timestamp.substring(0, 10)}
---\n`
			var path = pathJoin([folder, title]);
			var mdContent = frontmatter + note.content + "\n\n---\n\n" + note.source;
			var file = existingNotes.get(note._id) || null;
			if (file != null) {
				// modify file if id exists in frontmatter
				await this.app.vault.modify(file, mdContent);
			} else {
				// recreate file otherwise
				var delFile = this.app.vault.getAbstractFileByPath(path);
				if (delFile != null) {
					await this.app.vault.delete(delFile);
				}
				await this.app.vault.create(path, mdContent);
			}
			
		}
	}

}

class FleetingNotesSettingTab extends PluginSettingTab {
	plugin: FleetingNotesPlugin;

	constructor(app: App, plugin: FleetingNotesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Fleeting Notes Sync Settings'});

		new Setting(containerEl)
			.setName('Fleeting Notes folder location')
			.setDesc('Files will be populated here from Fleeting Notes')
			.addText(text => text
				.setPlaceholder('Enter the folder location')
				.setValue(this.plugin.settings.fleeting_notes_folder)
				.onChange(async (value) => {
					this.plugin.settings.fleeting_notes_folder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Username / Email')
			.addText(text => text
				.setPlaceholder('Enter username/email')
				.setValue(this.plugin.settings.username)
				.onChange(async (value) => {
					this.plugin.settings.username = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Password')
			.addText(text => text
				.setPlaceholder('Enter password')
				.setValue(this.plugin.settings.password)
				.onChange(async (value) => {
					this.plugin.settings.password = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Sync notes on startup')
			.addToggle(tog => tog
				.setValue(this.plugin.settings.sync_on_startup)
				.onChange(async (val) => {
					this.plugin.settings.sync_on_startup = val;
					await this.plugin.saveSettings();
				}));
	}
}

// helper functions
// https://stackoverflow.com/a/29855282/13659833
function pathJoin(parts: Array<string>, sep: string = '/'){
  var separator = sep || '/';
  var replace   = new RegExp(separator+'{1,}', 'g');
  return parts.join(separator).replace(replace, separator);
}

// takes in API key & query
const getAllNotesRealm = async (email: string, password: string) => {
  const query = `{"query":"query {  notes {    _id    title    content    source    timestamp   _isDeleted}}"}'`
  let notes = [];
  const config = {
    method: 'post',
    url: 'https://realm.mongodb.com/api/client/v2.0/app/fleeting-notes-knojs/graphql',
    headers: { 
      'email': email,
      'password': password,
    },
    body: query,
  };
  const res = await request(config);
  notes = JSON.parse(res)["data"]["notes"]
  return notes;
}

interface Note {
	_id: string,
	title: string,
	content: string,
	timestamp: string,
	source: string,
	_isDeleted: boolean,
}

