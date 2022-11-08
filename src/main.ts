// import moment
import {
	moment,
	Notice,
	Plugin,
	TFile,
	parseYaml,
	MarkdownView,
} from "obsidian";
import {
	FleetingNotesSettings,
	FleetingNotesSettingsTab,
	DEFAULT_SETTINGS,
} from "./settings";

import {
	extractAllTags,
	getAllNotesSupabase,
	pathJoin,
	throwError,
	updateNotesSupabase,
	getDefaultNoteTitle,
	openInputModal,
} from "./utils";

interface ObsidianNote {
	file: TFile;
	frontmatter: any;
	content: string;
}

export interface Note {
	id: string;
	title: string;
	content: string;
	created_at: string;
	modified_at: string;
	source: string;
	deleted: boolean;
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
				await this.syncFleetingNotes();
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
			id: "insert-notes-containing",
			name: "Insert All Notes Containing Specific Text",
			callback: async () => {
				openInputModal(
					"Insert All Notes Containing:",
					[
						{
							label: "Text",
							value: "text",
						},
					],
					"Search",
					(result) => {
						this.embedNotesWithText(result.text);
					}
				);
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

	async embedNotesWithText(text: string) {
		let sameSourceNotes: ObsidianNote[] = [];
		try {
			sameSourceNotes = await this.getNotesWithText(
				this.settings.fleeting_notes_folder,
				text
			);
			if (sameSourceNotes.length === 0) {
				new Notice(`No notes with text "${text}" found`);
				return;
			}
			const template = "![[${linkText}]]\n\n";
			const sameSourceNoteString = this.embedNotesToString(
				sameSourceNotes,
				this.app.workspace.getActiveFile().path,
				template
			);
			this.appendStringToActiveFile(sameSourceNoteString);
			new Notice(`Notes with text "${text}" inserted`);
		} catch (e) {
			if (typeof e === "string") {
				new Notice(e);
			} else {
				console.error(e);
				new Notice(`Failed to embed notes with text: "${text}"`);
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
			let notes = await getAllNotesSupabase({
				firebaseId: this.settings.firebaseId,
				supabaseId: this.settings.supabaseId,
				key: this.settings.encryption_key,
				filterKey: this.settings.notes_filter,
			});
			notes = notes.filter((note: Note) => !note.deleted);
			await this.writeNotes(notes, this.settings.fleeting_notes_folder);
			if (this.settings.sync_type == "one-way-delete") {
				await this.deleteFleetingNotes(notes);
			}
			this.settings.last_sync_time = new Date();
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
						id: frontmatter.id,
						title: frontmatter.title ? file.basename : "",
						content: content || "",
						source: frontmatter.source || "",
						deleted: frontmatter.deleted || false,
						modified_at: new Date(file.stat.mtime).toISOString(),
					};
				})
			);
			if (formattedNotes.length > 0) {
				await updateNotesSupabase({
					firebaseId: this.settings.firebaseId,
					supabaseId: this.settings.supabaseId,
					key: this.settings.encryption_key,
					notes: formattedNotes,
				});
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
						id: note.id,
						deleted: true,
					};
				})
			);
			if (notesToDelete.length > 0) {
				await updateNotesSupabase({
					firebaseId: this.settings.firebaseId,
					supabaseId: this.settings.supabaseId,
					key: this.settings.encryption_key,
					notes: notesToDelete,
				});
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
		let content = note.content;
		let tags: string[] = [];
		if (template.includes("${tags}")) {
			tags = extractAllTags(note.content);
		}
		if (metadataMatch) {
			const escapedTitle = note.title.replace(/\"/g, '\\"');
			const escapedContent = content.replace(/\"/g, '\\"');
			const escapedSource = note.source.replace(/\"/g, '\\"');
			const escapedTags = `[${tags.join(", ")}]`;
			var newMetadata = metadataMatch[1]
				.replace(/\$\{title\}/gm, escapedTitle)
				.replace(/\$\{tags\}/gm, escapedTags)
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
			.replace(/\$\{id\}/gm, note.id)
			.replace(/\$\{title\}/gm, note.title)
			.replace(/\$\{datetime\}/gm, note.created_at)
			.replace(/\$\{tags\}/gm, `[${tags.join(", ")}]`)
			.replace(
				/\$\{created_date\}/gm,
				moment(note.created_at).local().format("YYYY-MM-DD")
			)
			.replace(
				/\$\{last_modified_date\}/gm,
				moment(note.modified_at).local().format("YYYY-MM-DD")
			)
			.replace(/\$\{content\}/gm, content)
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
				new Date(file.stat.mtime) >
				new Date(this.settings.last_sync_time);
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

	async getNotesWithText(folder: string, text: string) {
		folder = this.convertObsidianPath(folder);
		let existingNotePathMap: Map<string, ObsidianNote> = new Map<
			string,
			ObsidianNote
		>();
		var existingNotes = await this.getExistingFleetingNotes(folder);
		existingNotes.forEach((note) =>
			existingNotePathMap.set(note.file.path, note)
		);
		const textInMetaData = (note: ObsidianNote) => {
			let hasSource = false;
			if (note.frontmatter) {
				Object.values(note.frontmatter).forEach(
					(fm: string | number | boolean) => {
						if (fm.toString().includes(text)) {
							hasSource = true;
						}
					}
				);
			}
			return hasSource;
		};

		const hasTextInContent = (note: ObsidianNote) => {
			return note.content?.includes(text);
		};

		const notesWithSameSource = existingNotes.filter((note) => {
			return textInMetaData(note) || hasTextInContent(note);
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

		let existingTitles: string[] = [];
		try {
			var existingNotes = await this.getExistingFleetingNotes(folder);
			existingNotes.forEach((note) => {
				existingNoteMap.set(note.frontmatter.id, note);
				existingTitles.push(note.file.name);
			});
			var folderExists = await this.app.vault.adapter.exists(folder);
			if (!folderExists) {
				await this.app.vault.createFolder(folder);
			}
			for (var i = 0; i < notes.length; i++) {
				var note = notes[i];
				var title = note.title
					? `${note.title}.md`
					: getDefaultNoteTitle(
							note,
							existingTitles,
							this.settings.auto_generate_title
					  );
				var path = this.convertObsidianPath(pathJoin([folder, title]));
				if (!path.includes(".md")) {
					path = path + ".md";
				}
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
}
