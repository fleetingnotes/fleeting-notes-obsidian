import { Note, ObsidianNote } from "main"
import { TFile, Vault, parseYaml, TAbstractFile, EventRef, Setting } from "obsidian"
import { FleetingNotesSettings } from "settings";
import { convertObsidianPath, getDefaultNoteTitle, getFilledTemplate, pathJoin, throwError } from "utils";

class FileSystemSync {
  vault: Vault;
  settings: FleetingNotesSettings;
  existingNoteMap: Map<String, ObsidianNote> = new Map<
    string,
    ObsidianNote
  >();
  modifyRef: EventRef;
  deleteRef: EventRef;
  
  constructor(vault: Vault, settings: FleetingNotesSettings) {
    this.vault = vault;
    this.settings = settings;
  }

  init = async () => {
    await this.getAllNotes().then((notes) => {
      notes.forEach(n => this.existingNoteMap.set(n.frontmatter.id, n))
    })
  }

  dirPath = () => convertObsidianPath(this.settings.fleeting_notes_folder);

  upsertNotes = async (notes: Array<Note>, addDeleted = false) => {
		try {
      // create folder on init (if doesnt exists)
      await this.vault.adapter.exists(this.settings.fleeting_notes_folder).then((exists) => {
        if (!exists) {
          this.vault.createFolder(this.dirPath());
        }
      })
			for (var i = 0; i < notes.length; i++) {
				var note = notes[i];
        const path = this.getNotePath(note, this.settings.auto_generate_title);
				try {
					var noteFile = this.existingNoteMap.get(note.id) || null;
					var mdContent = getFilledTemplate(
            this.settings.note_template,
						note,
            addDeleted,
					);
					if (noteFile != null && (await this.vault.adapter.exists(noteFile.file.path))) {
						// modify file if id exists in frontmatter
						await this.vault.modify(noteFile.file, mdContent);
						await this.vault.rename(noteFile.file, path);
					} else {
						// recreate file otherwise
						var delFile =
							this.vault.getAbstractFileByPath(path);
						if (delFile != null) {
							await this.vault.delete(delFile);
						}
						var createdFile = await this.vault.create(path, mdContent);
            var { frontmatter, content } = await this.parseNoteFile(createdFile);
            this.existingNoteMap.set(note.id, {
              file: createdFile,
              frontmatter,
              content,
            })
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
  getAllNotes = async () => {
		const noteList: Array<ObsidianNote> = [];
		try {
			var files = this.vault.getFiles();
			for (var i = 0; i < files.length; i++) {
				var file = files[i];
				if (!this.fileInDir(file)) continue;
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
    this.existingNoteMap.clear();
    noteList.forEach(n => this.existingNoteMap.set(n.frontmatter.id, n));
		return noteList;
  }
  deleteNotes = async (notes: Note[]) => {
		try {
			await Promise.all(
				notes.map((note) => {
          const obsNote = this.existingNoteMap.get(note.id);
          if (obsNote) {
            return this.vault.delete(obsNote.file).then(() => {
              this.existingNoteMap.delete(note.id)
            });
          }
          return null;
				})
			);
		} catch (e) {
			throwError(e, "Failed to delete notes from Fleeting Notes");
		}

  }
  onNoteChange = (handleNoteChange: (notes: Note) => void, includeDelete = false) => {
    this.offNoteChange();
    if (includeDelete) {
      this.deleteRef = this.vault.on("delete", (file) => {
        if (!this.fileInDir(file)) return
        for (const k of this.existingNoteMap.keys()) {
          const path = this.existingNoteMap.get(k)?.file.path
          const noteId = this.existingNoteMap.get(k)?.frontmatter?.id;
          if (noteId && path === file.path) {
            return handleNoteChange({id: noteId, deleted: true});
          }
        }
      })
    }
    this.modifyRef = this.vault.on("modify", (file) => {
      if (!this.fileInDir(file)) return
      this.convertFileToNote(file as TFile).then((n) => {
        handleNoteChange(FileSystemSync.parseObsidianNote(n));
      });
    })
  }

  offNoteChange = () => {
    this.vault.offref(this.deleteRef);
    this.vault.offref(this.modifyRef);
  }

  static parseObsidianNote = (note: ObsidianNote) : Note => {
    var { file, frontmatter, content } = note;
    return {
      id: frontmatter.id,
      title: frontmatter.title || undefined,
      content: content || undefined,
      source: frontmatter.source || undefined,
      deleted: frontmatter.deleted || undefined,
      modified_at: new Date(file.stat.mtime).toISOString(),
    };
  }

  // helpers
  getNotePath = (note: Note, titleFromContent: boolean): string => {
    var filenamesInFolder = this.getFilenamesInFolder(this.dirPath());
    var noteFileName = note.title
      ? `${note.title}.md`
      : getDefaultNoteTitle(
          note,
          filenamesInFolder,
          titleFromContent,
        );
    // update existing titles
    var path = convertObsidianPath(pathJoin([this.dirPath(), noteFileName]));
    if (!path.includes(".md")) {
      path = path + ".md";
    }
    return path
  }
  fileInDir = (file: TAbstractFile): boolean => {
    return this.dirPath() === "/"
    ? !file.path.contains("/")
    : file.path.startsWith(this.dirPath());
  }
  convertFileToNote = async (file: TFile): Promise<ObsidianNote> => {
    const { frontmatter, content } = await this.parseNoteFile(file);
    return {
      file,
      frontmatter,
      content
    }
  }

	parseNoteFile = async (
		file: TFile
	): Promise<{ frontmatter: any; content: string }>  => {
		var frontmatter = {};
		var rawNoteContent = await this.vault.read(file);
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
  getFilenamesInFolder(folder: string): Set<string> {
    let existingTitlesInFolder: Set<string> = new Set();
    this.vault.getFiles().forEach((file) => {
      var fileInDir =
        folder === "/"
          ? !file.path.contains("/")
          : file.path.startsWith(folder);
      if (fileInDir) existingTitlesInFolder.add(file.name)
    });
    return existingTitlesInFolder;
  }
}

export default FileSystemSync;