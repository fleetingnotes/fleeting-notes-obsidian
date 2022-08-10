import { App, Notice, Plugin, PluginSettingTab, Setting, request, TFile, parseYaml, MarkdownView, TextAreaComponent } from 'obsidian';
var CryptoJS = require("crypto-js");

// Remember to rename these classes and interfaces!

interface FleetingNotesSettings {
	fleeting_notes_folder: string;
	note_template: string;
	sync_type: string;
	sync_on_startup: boolean;
	last_sync_time: Date;
	username: string;
	password: string;
	encryption_key: string;
	sync_interval: NodeJS.Timer | undefined;
}

interface ObsidianNote {
	file: TFile,
	frontmatter: any,
	content: string
}

const DEFAULT_SETTINGS: FleetingNotesSettings = {
	fleeting_notes_folder: '/',
	note_template: '---\n# Metadata used for sync\nid: "${id}"\ntitle: "${title}"\ncreated: "${datetime}"\nsource: "${source}"\ndeleted: false\n---\n${content}',
	sync_on_startup: false,
	last_sync_time: new Date(0),
	sync_type: 'one-way',
	username: '',
	password: '',
	encryption_key: '',
	sync_interval: undefined,
}

export default class FleetingNotesPlugin extends Plugin {
	settings: FleetingNotesSettings;

	async onload() {
		await this.loadSettings();
		// This forces fleeting notes to sync with obsidian
		this.addCommand({
			id: 'sync-fleeting-notes',
			name: 'Sync Notes with Fleeting Notes',
			callback: async () => {
				this.syncFleetingNotes();
			}
		});

		this.addCommand({
			id: 'get-unprocessed-notes',
			name: 'Insert Unprocessed Notes',
			callback: async () => {
				this.insertUnprocessedNotes();
			}
		})

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new FleetingNotesSettingTab(this.app, this));

		// syncs on startup
		if (this.settings.sync_on_startup) {
			// Files might not be loaded yet
			this.app.workspace.onLayoutReady(() => {
				this.autoSync();
			})
		}
	}
	disableAutoSync() {
		if (this.settings.sync_interval) {
			clearInterval(this.settings.sync_interval);
		}
	}
	autoSync(syncIntervalMin: number = 30) {
		const syncIntervalMs = syncIntervalMin * 60 * 1000;
		this.disableAutoSync();
		this.syncFleetingNotes();
		this.settings.sync_interval = setInterval(this.syncFleetingNotes.bind(this), syncIntervalMs);
	}

	onunload() {
		this.disableAutoSync();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async insertUnprocessedNotes() {
		try {
			const unprocessedNotes = await this.getUnprocessedFleetingNotes(this.settings.fleeting_notes_folder);
			const unprocessedNoteString = this.unprocessedNotesToString(unprocessedNotes, this.app.workspace.getActiveFile().path);
			this.appendStringToActiveFile(unprocessedNoteString);
		} catch (e) {
			if (typeof e === 'string') {
				new Notice(e);
			} else {
				console.error(e);
				new Notice('Failed to insert unprocessed notes');
			}
		}
	}

	// syncs changes between obsidian and fleeting notes
	async syncFleetingNotes () {
		try {
			if (this.settings.sync_type === 'two-way') {
				await this.pushFleetingNotes();
			}
			// pull fleeting notes
			let notes = await getAllNotesFirebase(this.settings.username, this.settings.password, this.settings.encryption_key);
			notes = notes.filter((note: Note) => !note._isDeleted);
			await this.writeNotes(notes, this.settings.fleeting_notes_folder);
			if (this.settings.sync_type == 'one-way-delete') {
				await this.deleteFleetingNotes(notes);
			}
			this.settings.last_sync_time = new Date();

			new Notice('Fleeting Notes sync success!');
		} catch (e) {
			if (typeof e === 'string') {
				new Notice(e);
			} else {
				console.error(e);
				new Notice('Fleeing Notes sync failed - please check settings');
			}
		}
	}

	async appendStringToActiveFile(content: string) {
		const active_view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const editor = active_view.editor;
        const doc = editor.getDoc();
		doc.replaceSelection(content);
	}

	// returns the frontmatter and content from a note file
	async parseNoteFile(file: TFile): Promise<{ frontmatter: any, content: string }> {
		var frontmatter = {};
		var rawNoteContent = await this.app.vault.read(file)
		var	content = rawNoteContent;
		try {
			var m = rawNoteContent.match(/^---\n([\s\S]*?)\n---\n/m);
			if (m) {
				frontmatter = parseYaml(m[1]);
				content = content.replace(m[0], '');
			}
		} catch (e) {
			console.error(e, `Failed to parse metadata for: "${file.path}"`)
		}
		return { frontmatter, content };
	}

	// writes fleeting notes to firebase
	async pushFleetingNotes () {
		try {
			var modifiedNotes = await this.getUpdatedLocalNotes(this.settings.fleeting_notes_folder);
			var formattedNotes = await Promise.all(modifiedNotes.map(async (note) => {
				var { file, frontmatter, content } = note;
				return {
					'_id': frontmatter.id,
					'title': (frontmatter.title) ? file.basename : '',
					'content': content || '',
					'source': frontmatter.source || '',
					'_isDeleted': frontmatter.deleted || false,
				};
			}));
			if (formattedNotes.length > 0) {
				await updateNotesFirebase(this.settings.username, this.settings.password, this.settings.encryption_key, formattedNotes);
				this.settings.last_sync_time = new Date();
			}
		} catch (e) {
			throwError(e, 'Failed to push notes from Obsidian to Fleeting Notes');
		}
	}

	async deleteFleetingNotes (notes: Note[]) {
		try {
			var notesToDelete = await Promise.all(notes.map(async (note) => {
				return {
					'_id': note._id,
					'_isDeleted': true,
				}
			}));
			if (notesToDelete.length > 0) {
				await updateNotesFirebase(this.settings.username, this.settings.password, this.settings.encryption_key, notesToDelete);
			}
		} catch (e) {
			throwError(e, 'Failed to delete notes from Fleeting Notes');
		}
	}	
	// gets all Fleeting Notes from obsidian
	async getExistingFleetingNotes (dir: string) {
		const noteList: Array<ObsidianNote> = [];
		try {
			var files = this.app.vault.getFiles();
			for (var i = 0; i < files.length; i++) {
				var file = files[i];
				var fileInDir = (dir === '/') ? !file.path.contains('/') : file.path.startsWith(dir);
				if (!fileInDir) continue;
				var file_id: string;
				var { frontmatter, content } = await this.parseNoteFile(file);
				file_id = frontmatter.id || null;
				if (file_id !== null) {
					noteList.push({ file, frontmatter, content });
				}
			}
		} catch (e) {
			throwError(e, `Failed to get existing notes from obsidian`);
		}
		return noteList;
	}

	// paths in obsidian are weird, need function to convert to proper path
	convertObsidianPath(path: string) {
		path = (path[0] === '/') ? path.replace('/', '') : path;
		path = path || '/';
		return path;
	}

	// fills the template with the note data
	getFilledTemplate(template: string, note: Note, is_deleted: boolean) {
		const metadataMatch = template.match(/^---\n([\s\S]*?)\n---\n/m);
		if (metadataMatch) {
			const escapedTitle = note.title.replace(/\"/g, '\\"');
			const escapedContent = note.content.replace(/\"/g, '\\"');
			const escapedSource = note.source.replace(/\"/g, '\\"');
			var newMetadata = metadataMatch[1]
				.replace(/\$\{title\}/gm, escapedTitle)
				.replace(/\$\{content\}/gm, escapedContent)
				.replace(/\$\{source\}/gm, escapedSource);
			if (is_deleted) {
				const deleted_match = newMetadata.match(/^deleted:.*$/);
				if (deleted_match) {
					newMetadata = newMetadata.replace(deleted_match[0], 'deleted: true');
				} else {
					newMetadata += '\ndeleted: true';
				}
			}
			newMetadata = `---\n${newMetadata}\n---\n`;
			template = template.replace(metadataMatch[0], newMetadata);
		}

		var newTemplate = template
			.replace(/\$\{id\}/gm, note._id)
			.replace(/\$\{title\}/gm, note.title)
			.replace(/\$\{datetime\}/gm, note.timestamp.substring(0.10))
			.replace(/\$\{content\}/gm, note.content)
			.replace(/\$\{source\}/gm, note.source);

		return newTemplate;
	}

	// returns a list of files that have been modified since the last sync
	async getUpdatedLocalNotes(folder: string) {
		folder = this.convertObsidianPath(folder);
		var existingNotes = await this.getExistingFleetingNotes(folder);
		var modifiedNotes = existingNotes.filter((note) => {
			const { file, frontmatter } = note;
			const isContentModified = new Date(file.stat.mtime) > this.settings.last_sync_time;
			const isTitleChanged = frontmatter.title && frontmatter.title !== file.basename;
			return isContentModified || isTitleChanged;
		});
		return modifiedNotes;
	}

	unprocessedNotesToString(notes: Array<ObsidianNote>, sourcePath: string) {
		let unprocessedNoteString = ""
		const unprocessedNoteTemplate = "- [ ] ![[${linkText}]]\n";
		notes.forEach((note) => {
			const linkText = this.app.metadataCache.fileToLinktext(note.file, sourcePath);
			unprocessedNoteString += unprocessedNoteTemplate.replace('${linkText}', linkText);
		});
		return unprocessedNoteString;
	}

	async getUnprocessedFleetingNotes(folder: string) {
		folder = this.convertObsidianPath(folder);
		let existingNotePathMap: Map<string, ObsidianNote> = new Map<string, ObsidianNote>();
		var existingNotes = await this.getExistingFleetingNotes(folder);
		existingNotes.forEach((note) => existingNotePathMap.set(note.file.path, note));
		let skipNotesSet: Set<string> = new Set();

		const resolvedLinks = this.app.metadataCache.resolvedLinks
		await Promise.all(Object.keys(resolvedLinks).map(async (filePath) => {
			// skip existing fleeting notes
			if (existingNotePathMap.has(filePath)) return;
			let linksInNote: Array<string> = [];
			Object.keys(resolvedLinks[filePath]).forEach((linkInNote) => {
				if (existingNotePathMap.has(linkInNote)) {
					linksInNote.push(linkInNote);
				}
			});	
			if (linksInNote.length > 0) {
				const file = await this.app.vault.getAbstractFileByPath(filePath) as TFile;
				const content = await this.app.vault.read(file);
				linksInNote.forEach(async (link) => {
					const note: ObsidianNote = existingNotePathMap.get(link);
					const fullLink = note.file.path.replace(/\.\w+$/, '')
					const re = new RegExp(`^- \\[x\\] .*\\[\\[(${fullLink}|${note.file.basename})\\]\\]`, 'm')
					if (content.match(re)) {
						skipNotesSet.add(link);
					}
				});
			}
		}));
		const unprocessedNotes = existingNotes.filter((note) => {
			return !skipNotesSet.has(note.file.path);
		});
		return unprocessedNotes;
	}

	// writes notes to obsidian
	async writeNotes (notes: Array<Note>, folder: string) {
		folder = this.convertObsidianPath(folder);
		let existingNoteMap: Map<string, ObsidianNote> = new Map<string, ObsidianNote>();
		try {
			var existingNotes = await this.getExistingFleetingNotes(folder);
			existingNotes.forEach((note) => existingNoteMap.set(note.frontmatter.id, note));
			var folderExists = await this.app.vault.adapter.exists(folder);
			if (!folderExists) {
				await this.app.vault.createFolder(folder);
			}
			for (var i = 0; i < notes.length; i++) {
				var note = notes[i];
				var title = (note.title) ? `${note.title}.md` : `${note._id}.md`;
				var path = this.convertObsidianPath(pathJoin([folder, title]));
				try {
					var noteFile = existingNoteMap.get(note._id) || null;
					const delete_note = this.settings.sync_type === 'one-way-delete' || noteFile.frontmatter.deleted === true;
					var mdContent = this.getFilledTemplate(this.settings.note_template, note, delete_note);
					if (noteFile != null) {
						// modify file if id exists in frontmatter
						await this.app.vault.modify(noteFile.file, mdContent);
						await this.app.vault.rename(noteFile.file, path);
					} else {
						// recreate file otherwise
						var delFile = this.app.vault.getAbstractFileByPath(path);
						if (delFile != null) {
							await this.app.vault.delete(delFile);
						}
						await this.app.vault.create(path, mdContent);
					}
				} catch (e) {
					throwError(e, `Failed to write note "${path}" to Obsidian.\n\n${e.message}`);
				}
				
			}
		} catch (e) {
			throwError(e, 'Failed to write notes to Obsidian');
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
		let noteTemplateComponent: TextAreaComponent;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Authentication'});

		new Setting(containerEl)
			.setName('Email')
			.setDesc('Email used to log into Fleeting Notes')
			.addText(text => text
				.setPlaceholder('Enter email')
				.setValue(this.plugin.settings.username)
				.onChange(async (value) => {
					this.plugin.settings.username = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Password')
			.setDesc('Password used to log into Fleeting Notes')
			.addText(text => {
				text
					.setPlaceholder('Enter password')
					.setValue(this.plugin.settings.password)
					.onChange(async (value) => {
						this.plugin.settings.password = value;
						await this.plugin.saveSettings();
					})
				text.inputEl.type = 'password';
			});

		new Setting(containerEl)
			.setName('Encryption key')
			.setDesc('Encryption key used to encrypt notes')
			.addText(text => {
				text
					.setPlaceholder('Enter encryption key')
					.setValue(this.plugin.settings.encryption_key)
					.onChange(async (value) => {
						this.plugin.settings.encryption_key = value;
						await this.plugin.saveSettings();
					})
				text.inputEl.type = 'password';
			});
		
		containerEl.createEl('h2', {text: 'Sync Settings'});

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
			.setName('Sync notes automatically')
			.setDesc('Sync will be performed on startup and every 30 minutes')
			.addToggle(tog => tog
				.setValue(this.plugin.settings.sync_on_startup)
				.onChange(async (val) => {
					this.plugin.settings.sync_on_startup = val;
					if (val) {
						this.plugin.autoSync();
					} else {
						this.plugin.disableAutoSync();
					}
					await this.plugin.saveSettings();
				}));
		
		new Setting(containerEl)
			.setName('Sync type:')
			.addDropdown(dropdown => dropdown
				.addOption('one-way', 'One-way sync (FN ⇒ Obsidian)')
				.addOption('one-way-delete', 'One-way sync (FN ⇒ Obsidian) + Delete from FN')
				.addOption('two-way', 'Two-way sync (FN ⇔ Obsidian)')
				.setValue(this.plugin.settings.sync_type)
				.onChange(async (value) => {
					this.plugin.settings.sync_type = value;
					if (noteTemplateComponent) {
						if (value == 'two-way') {
							this.plugin.settings.note_template = DEFAULT_SETTINGS.note_template;
							noteTemplateComponent.setValue(DEFAULT_SETTINGS.note_template);
							noteTemplateComponent.inputEl.setAttr("disabled", true);
						} else {
							noteTemplateComponent.inputEl.removeAttribute("disabled");
						}
					}
					await this.plugin.saveSettings();
				}));
			
		new Setting(containerEl)
			.setName('Note Template')
			.setDesc('Only editable in one-way sync')
		new Setting(containerEl)
			.setHeading()
			.addTextArea(t => {
				noteTemplateComponent = t;
				t
					.setValue(this.plugin.settings.note_template)
					.onChange(async (val) => {
						this.plugin.settings.note_template = val;
						await this.plugin.saveSettings();
					});
				t.inputEl.setAttr("rows", 10);
				t.inputEl.addClass("note_template");
				if (this.plugin.settings.sync_type == 'two-way') {
					t.inputEl.setAttr("disabled", true);
				}
			})
			.addExtraButton(cb => {
				cb
					.setIcon("sync")
					.setTooltip("Refresh template")
					.onClick(() => {
						this.plugin.settings.note_template = DEFAULT_SETTINGS.note_template;
						this.plugin.saveSettings();
						this.display();
					});
				
			})
	}
}

// helper functions
// https://stackoverflow.com/a/29855282/13659833
function pathJoin(parts: Array<string>, sep: string = '/'){
  var separator = sep || '/';
  var replace   = new RegExp(separator+'{1,}', 'g');
  return parts.join(separator).replace(replace, separator);
}

function throwError(e: any, errMessage: string) {
	if (typeof e === 'string') {
		throw e;
	} else {
		console.error(e);
		throw errMessage;
	}
}

const firebaseUrl = 'https://us-central1-fleetingnotes-22f77.cloudfunctions.net';
// takes in API key & query
const getAllNotesFirebase = async (email: string, password: string, key: string) => {
  let notes: Note[] = [];
  try {
	const base64Auth = btoa(`${email}:${password}`);
	const config = {
		method: 'post',
		url: `${firebaseUrl}/get_all_notes`,
		contentType: 'application/json',
		headers: {
			"Authorization": `Basic ${base64Auth}`,
			"hashed-encryption-key": (key) ? CryptoJS.SHA256(key).toString() : undefined,
		}
	};
	const res = JSON.parse(await request(config));
	if (res.error) {
		throwError(Error(res.error), res.error);
	}
	notes = Array.from(res.map((note: any) => decryptNote(note, key)));
	return notes;
  } catch (e) {
	  throwError(e, 'Failed to get notes from Fleeting Notes - Check your credentials');
  }
  return notes;
}

const updateNotesFirebase = async (email:string, password:string, key:string, notes: Array<any>)  => {
	try {
		const base64Auth = btoa(`${email}:${password}`);
		var encryptedNotes = Array.from(notes.map((note: any) => encryptNote(note, key)));
		const config = {
			method: 'post',
			url: `${firebaseUrl}/update_notes`,
			contentType: 'application/json',
			headers: {
				"Authorization": `Basic ${base64Auth}`,
				"hashed-encryption-key": (key) ? CryptoJS.SHA256(key).toString() : undefined,
				"notes": JSON.stringify(encryptedNotes),
			}
		};
		const res = JSON.parse(await request(config));
		if (res.error) {
			throwError(Error(res.error), res.error);
		}
	} catch (e) {
		throwError(e, 'Failed to update notes in Fleeting Notes - Check your credentials');
	}
}

const decryptNote = (note: any, key: string) => {
	if (note.is_encrypted) {
		if (key === '') {
			throwError(Error('No encryption key found'), 'No encryption key found');
		}
		if (note.title) {
			note.title = decryptText(note.title, key);
		}
		if (note.content) {
			note.content = decryptText(note.content, key);
		}
		if (note.source) {
			note.source = decryptText(note.source, key);
		}
	}
	return note as Note
}

const encryptNote = (note: any, key: string) => {
	if (key !== '') {
		if (note.title) {
			note.title = encryptText(note.title, key);
		}
		if (note.content) {
			note.content = encryptText(note.content, key);
		}
		if (note.source) {
			note.source = encryptText(note.source, key);
		}
		note.is_encrypted = true;
	}
	return note as Note
}

const decryptText = (text: string, key: string) => {
	var bytes = CryptoJS.AES.decrypt(text, key);
	var originalText = bytes.toString(CryptoJS.enc.Utf8);
	return originalText as string;
}

const encryptText = (text: string, key: string) => {
	var ciphertext = CryptoJS.AES.encrypt(text, key).toString();
	return ciphertext as string;
}

interface Note {
	_id: string,
	title: string,
	content: string,
	timestamp: string,
	source: string,
	_isDeleted: boolean,
}
