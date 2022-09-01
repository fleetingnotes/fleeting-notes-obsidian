import { Notice, Plugin, TFile, parseYaml, MarkdownView } from "obsidian";
import { InputModal } from "./inputModal";
import {
	FleetingNotesSettings,
	FleetingNotesSettingsTab,
	DEFAULT_SETTINGS,
} from "./settings";
import {
	getAllNotesFirebase,
	pathJoin,
	throwError,
	updateNotesFirebase,
} from "./utils";

interface ObsidianNote {
	file: TFile;
	frontmatter: any;
	content: string;
}

export interface Note {
	_id: string;
	title: string;
	content: string;
	timestamp: string;
	source: string;
	_isDeleted: boolean;
}

export default class FleetingNotesPlugin extends Plugin {
	settings: FleetingNotesSettings;

	async onload() {
		await this.loadSettings();
		// This forces fleeting notes to sync with obsidian
		this.addCommand({
			id: "sync-fleeting-notes",
			name: "Sync Notes with Fleeting Notes",
			callback: async () => {
				this.syncFleetingNotes();
			},
		});

		this.addCommand({
			id: "get-unprocessed-notes",
			name: "Insert Unprocessed Notes",
			callback: async () => {
				this.insertUnprocessedNotes();
			},
		});

		this.addCommand({
			id: "insert-same-source-notes",
			name: "Insert All Notes With the Same Source",
			callback: async () => {
				this.openInputModal("Enter Source", "Source", (result) => {
					console.log("result", result);
					this.embedSameSourceNotes(result);
				});
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new FleetingNotesSettingsTab(this.app, this));

		// syncs on startup
		if (this.settings.sync_on_startup) {
			// Files might not be loaded yet
			this.app.workspace.onLayoutReady(() => {
				this.autoSync();
			});
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
		this.settings.sync_interval = setInterval(
			this.syncFleetingNotes.bind(this),
			syncIntervalMs
		);
	}

	onunload() {
		this.disableAutoSync();
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async insertUnprocessedNotes() {
		try {
			const template = "- [ ] ![[${linkText}]]\n";
			const unprocessedNotes = await this.getUnprocessedFleetingNotes(
				this.settings.fleeting_notes_folder
			);
			const unprocessedNoteString = this.embedNotesToString(
				unprocessedNotes,
				this.app.workspace.getActiveFile().path,
				template
			);
			this.appendStringToActiveFile(unprocessedNoteString);
		} catch (e) {
			if (typeof e === "string") {
				new Notice(e);
			} else {
				console.error(e);
				new Notice("Failed to insert unprocessed notes");
			}
		}
	}

	async embedSameSourceNotes(source: string) {
		let sameSourceNotes: ObsidianNote[] = [];
		try {
			sameSourceNotes = await this.getNotesWithSameSource(
				this.settings.fleeting_notes_folder,
				source
			);
			if (sameSourceNotes.length === 0) {
				new Notice(`No notes with source ${source} found`);
				return;
			}
			console.log("sameSourceNotes", sameSourceNotes);
			const template = "![[${linkText}]]\n\n";
			const sameSourceNoteString = this.embedNotesToString(
				sameSourceNotes,
				this.app.workspace.getActiveFile().path,
				template
			);
			this.appendStringToActiveFile(sameSourceNoteString);
			new Notice(`Notes with source ${source} inserted`);
		} catch (e) {
			if (typeof e === "string") {
				new Notice(e);
			} else {
				console.error(e);
				new Notice("Failed to embed notes with same source");
			}
		}
	}

	// syncs changes between obsidian and fleeting notes
	async syncFleetingNotes() {
		try {
			if (this.settings.sync_type === "two-way") {
				await this.pushFleetingNotes();
			}
			// pull fleeting notes
			let notes = await getAllNotesFirebase(
				this.settings.username,
				this.settings.password,
				this.settings.encryption_key
			);
			notes = notes.filter((note: Note) => !note._isDeleted);
			await this.writeNotes(notes, this.settings.fleeting_notes_folder);
			if (this.settings.sync_type == "one-way-delete") {
				await this.deleteFleetingNotes(notes);
			}
			this.settings.last_sync_time = new Date();

			new Notice("Fleeting Notes sync success!");
		} catch (e) {
			if (typeof e === "string") {
				new Notice(e);
			} else {
				console.error(e);
				new Notice("Fleeing Notes sync failed - please check settings");
			}
		}
	}

	async appendStringToActiveFile(content: string) {
		const active_view =
			this.app.workspace.getActiveViewOfType(MarkdownView);
		const editor = active_view.editor;
		const doc = editor.getDoc();
		doc.replaceSelection(content);
	}

	// returns the frontmatter and content from a note file
	async parseNoteFile(
		file: TFile
	): Promise<{ frontmatter: any; content: string }> {
		var frontmatter = {};
		var rawNoteContent = await this.app.vault.read(file);
		var content = rawNoteContent;
		try {
			var m = rawNoteContent.match(/^---\n([\s\S]*?)\n---\n/m);
			if (m) {
				frontmatter = parseYaml(m[1]);
				content = content.replace(m[0], "");
			}
		} catch (e) {
			console.error(e, `Failed to parse metadata for: "${file.path}"`);
		}
		return { frontmatter, content };
	}

	// writes fleeting notes to firebase
	async pushFleetingNotes() {
		try {
			var modifiedNotes = await this.getUpdatedLocalNotes(
				this.settings.fleeting_notes_folder
			);
			var formattedNotes = await Promise.all(
				modifiedNotes.map(async (note) => {
					var { file, frontmatter, content } = note;
					return {
						_id: frontmatter.id,
						title: frontmatter.title ? file.basename : "",
						content: content || "",
						source: frontmatter.source || "",
						_isDeleted: frontmatter.deleted || false,
					};
				})
			);
			if (formattedNotes.length > 0) {
				await updateNotesFirebase(
					this.settings.username,
					this.settings.password,
					this.settings.encryption_key,
					formattedNotes
				);
				this.settings.last_sync_time = new Date();
			}
		} catch (e) {
			throwError(
				e,
				"Failed to push notes from Obsidian to Fleeting Notes"
			);
		}
	}

	async deleteFleetingNotes(notes: Note[]) {
		try {
			var notesToDelete = await Promise.all(
				notes.map(async (note) => {
					return {
						_id: note._id,
						_isDeleted: true,
					};
				})
			);
			if (notesToDelete.length > 0) {
				await updateNotesFirebase(
					this.settings.username,
					this.settings.password,
					this.settings.encryption_key,
					notesToDelete
				);
			}
		} catch (e) {
			throwError(e, "Failed to delete notes from Fleeting Notes");
		}
	}
	// gets all Fleeting Notes from obsidian
	async getExistingFleetingNotes(dir: string) {
		const noteList: Array<ObsidianNote> = [];
		try {
			var files = this.app.vault.getFiles();
			for (var i = 0; i < files.length; i++) {
				var file = files[i];
				var fileInDir =
					dir === "/"
						? !file.path.contains("/")
						: file.path.startsWith(dir);
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
		path = path[0] === "/" ? path.replace("/", "") : path;
		path = path || "/";
		return path;
	}

	// fills the template with the note data
	getFilledTemplate(template: string, note: Note, add_deleted: boolean) {
		const metadataMatch = template.match(/^---\n([\s\S]*?)\n---\n/m);
		if (metadataMatch) {
			const escapedTitle = note.title.replace(/\"/g, '\\"');
			const escapedContent = note.content.replace(/\"/g, '\\"');
			const escapedSource = note.source.replace(/\"/g, '\\"');
			var newMetadata = metadataMatch[1]
				.replace(/\$\{title\}/gm, escapedTitle)
				.replace(/\$\{content\}/gm, escapedContent)
				.replace(/\$\{source\}/gm, escapedSource);
			if (add_deleted) {
				const deleted_match = newMetadata.match(/^deleted:.*$/);
				if (deleted_match) {
					newMetadata = newMetadata.replace(
						deleted_match[0],
						"deleted: true"
					);
				} else {
					newMetadata += "\ndeleted: true";
				}
			}
			newMetadata = `---\n${newMetadata}\n---\n`;
			template = template.replace(metadataMatch[0], newMetadata);
		}

		var newTemplate = template
			.replace(/\$\{id\}/gm, note._id)
			.replace(/\$\{title\}/gm, note.title)
			.replace(/\$\{datetime\}/gm, note.timestamp.substring(0.1))
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
			const isContentModified =
				new Date(file.stat.mtime) > this.settings.last_sync_time;
			const isTitleChanged =
				frontmatter.title && frontmatter.title !== file.basename;
			return isContentModified || isTitleChanged;
		});
		return modifiedNotes;
	}

	embedNotesToString(
		notes: Array<ObsidianNote>,
		sourcePath: string,
		template: string
	) {
		let embedNotesString = "";
		const unprocessedNoteTemplate = "![[${linkText}]]\n";
		notes.forEach((note) => {
			const linkText = this.app.metadataCache.fileToLinktext(
				note.file,
				sourcePath
			);
			embedNotesString += template.replace("${linkText}", linkText);
		});
		return embedNotesString;
	}

	async getUnprocessedFleetingNotes(folder: string) {
		folder = this.convertObsidianPath(folder);
		let existingNotePathMap: Map<string, ObsidianNote> = new Map<
			string,
			ObsidianNote
		>();
		var existingNotes = await this.getExistingFleetingNotes(folder);
		existingNotes.forEach((note) =>
			existingNotePathMap.set(note.file.path, note)
		);

		let skipNotesSet: Set<string> = new Set();

		const resolvedLinks = this.app.metadataCache.resolvedLinks;
		await Promise.all(
			Object.keys(resolvedLinks).map(async (filePath) => {
				// skip existing fleeting notes
				if (existingNotePathMap.has(filePath)) return;
				let linksInNote: Array<string> = [];
				Object.keys(resolvedLinks[filePath]).forEach((linkInNote) => {
					if (existingNotePathMap.has(linkInNote)) {
						linksInNote.push(linkInNote);
					}
				});
				if (linksInNote.length > 0) {
					const file = (await this.app.vault.getAbstractFileByPath(
						filePath
					)) as TFile;
					const content = await this.app.vault.read(file);
					linksInNote.forEach(async (link) => {
						const note: ObsidianNote =
							existingNotePathMap.get(link);
						const fullLink = note.file.path.replace(/\.\w+$/, "");
						const re = new RegExp(
							`^- \\[x\\] .*\\[\\[(${fullLink}|${note.file.basename})\\]\\]`,
							"m"
						);
						if (content.match(re)) {
							skipNotesSet.add(link);
						}
					});
				}
			})
		);
		const unprocessedNotes = existingNotes.filter((note) => {
			return !skipNotesSet.has(note.file.path);
		});
		return unprocessedNotes;
	}

	async getNotesWithSameSource(folder: string, source: string) {
		folder = this.convertObsidianPath(folder);
		let existingNotePathMap: Map<string, ObsidianNote> = new Map<
			string,
			ObsidianNote
		>();
		var existingNotes = await this.getExistingFleetingNotes(folder);
		existingNotes.forEach((note) =>
			existingNotePathMap.set(note.file.path, note)
		);
		const hasSourceInMetaData = (note: ObsidianNote) => {
			let hasSource = false;
			if (note.frontmatter) {
				Object.values(note.frontmatter).forEach(
					(fm: string | number | boolean) => {
						if (fm === source) {
							hasSource = true;
						}
					}
				);
			}
			return hasSource;
		};

		const hasSourceInContent = (note: ObsidianNote) => {
			return note.content?.includes(source);
		};

		const notesWithSameSource = existingNotes.filter((note) => {
			return hasSourceInMetaData(note) || hasSourceInContent(note);
		});
		return notesWithSameSource;
	}

	// writes notes to obsidian
	async writeNotes(notes: Array<Note>, folder: string) {
		folder = this.convertObsidianPath(folder);
		let existingNoteMap: Map<string, ObsidianNote> = new Map<
			string,
			ObsidianNote
		>();
		try {
			var existingNotes = await this.getExistingFleetingNotes(folder);
			existingNotes.forEach((note) =>
				existingNoteMap.set(note.frontmatter.id, note)
			);
			var folderExists = await this.app.vault.adapter.exists(folder);
			if (!folderExists) {
				await this.app.vault.createFolder(folder);
			}
			for (var i = 0; i < notes.length; i++) {
				var note = notes[i];
				var title = note.title ? `${note.title}.md` : `${note._id}.md`;
				var path = this.convertObsidianPath(pathJoin([folder, title]));
				try {
					var noteFile = existingNoteMap.get(note._id) || null;
					const add_deleted =
						this.settings.sync_type === "one-way-delete";
					var mdContent = this.getFilledTemplate(
						this.settings.note_template,
						note,
						add_deleted
					);
					if (noteFile != null) {
						// modify file if id exists in frontmatter
						await this.app.vault.modify(noteFile.file, mdContent);
						await this.app.vault.rename(noteFile.file, path);
					} else {
						// recreate file otherwise
						var delFile =
							this.app.vault.getAbstractFileByPath(path);
						if (delFile != null) {
							await this.app.vault.delete(delFile);
						}
						await this.app.vault.create(path, mdContent);
					}
				} catch (e) {
					throwError(
						e,
						`Failed to write note "${path}" to Obsidian.\n\n${e.message}`
					);
				}
			}
		} catch (e) {
			throwError(e, "Failed to write notes to Obsidian");
		}
	}

	getAllLinks() {
		const unresolvedLinks = this.app.metadataCache.unresolvedLinks;
		const resolvedLinks = this.app.metadataCache.resolvedLinks;
		const allLinksSet = new Set();
		for (const [file, links] of Object.entries(resolvedLinks)) {
			const addLinkToSet = (link: string) => {
				const cleanedLink = link.split("/").at(-1).replace(/\.md$/, "");
				allLinksSet.add(cleanedLink);
			};
			addLinkToSet(file);
			Object.keys(links).forEach(addLinkToSet);
			Object.keys(unresolvedLinks[file]).forEach(addLinkToSet);
		}
		return [...allLinksSet];
	}

	openInputModal(title: string, label: string, onSubmit: (result: any) => void) {
		new InputModal(this.app, title, label, onSubmit).open();
	}
}
