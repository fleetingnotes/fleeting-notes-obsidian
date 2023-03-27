import { Note } from "./main";
var CryptoJS = require("crypto-js");
import { moment } from "obsidian"
import { InputModal, Values, ModalInputField } from "./components/inputModal";
import { SupabaseNote } from "supabase_sync";

export function openInputModal(
	title: string,
	inputs: ModalInputField[],
	submitText: string,
	onSubmit: (results: Values) => void
) {
	new InputModal(this.app, { title, inputs, submitText, onSubmit }).open();
}

// helper functions
// https://stackoverflow.com/a/29855282/13659833

export function pathJoin(parts: Array<string>, sep: string = "/") {
	var separator = sep || "/";
	var replace = new RegExp(separator + "{1,}", "g");
	return parts.join(separator).replace(replace, separator);
}

export function throwError(e: any, errMessage: string) {
	if (typeof e === "string") {
		throw e;
	} else {
		console.error(e);
		throw errMessage;
	}
}

export const decryptNote = (note: SupabaseNote, key: string) => {
	if (note.encrypted) {
		if (key === "") {
			throwError(
				Error("No encryption key found"),
				"No encryption key found"
			);
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
		if (note.source_title) {
			note.source_title = decryptText(note.source_title, key);
		}
		if (note.source_description) {
			note.source_description = decryptText(note.source_description, key);
		}
		if (note.source_image_url) {
			note.source_image_url = decryptText(note.source_image_url, key);
		}
    note.encrypted = false;
	}
	return note;
};

export const encryptNote = (note: Note, key: string) => {
	if (key !== "") {
		if (note.title) {
			note.title = encryptText(note.title, key);
		}
		if (note.content) {
			note.content = encryptText(note.content, key);
		}
		if (note.source) {
			note.source = encryptText(note.source, key);
		}
    // Don't encrypt source metadata unless you want to sync it as well!
		note.encrypted = true;
	}
	return note;
};

export const decryptText = (text: string, key: string) => {
	var bytes = CryptoJS.AES.decrypt(text, key);
	var originalText = bytes.toString(CryptoJS.enc.Utf8);
	return originalText as string;
};

export const encryptText = (text: string, key: string) => {
	var ciphertext = CryptoJS.AES.encrypt(text, key).toString();
	return ciphertext as string;
};

export const extractAllTags = (text: string): string[] => {
	let tags = [];
	let tagRegex = /(^|\B)#(?![0-9_]+\b)([a-zA-Z0-9_\/]{1,50})(\b|\r)/gm;
	//get all tags, and when adding a tag, remove # and add quotation marks, using matchall
	let matches = text.matchAll(tagRegex);
	for (const match of matches) {
		tags.push(`"${match[2]}"`);
	}
	return tags;
};
export const getDefaultNoteTitle = (
	note: Note,
	existingTitles: Set<string>,
	autoGenerateTitle: boolean
) => {
  const titleFromContent = note.content
    .substring(0, 40)
    .replace(/[\n\r]/g, ' ')
    .replace(/([\[\]\#\*\:\/\\\^\.])/g, "");
	if (!autoGenerateTitle || titleFromContent.length === 0) {
		return `${note.id}.md`;
	}
  let tempTitle = titleFromContent;
  let i = 1;
  while (existingTitles.has(`${tempTitle}.md`)) {
    tempTitle = `${titleFromContent} (${i})`;
    i++;
  }
  return `${tempTitle}.md`;
};

// paths in obsidian are weird, need function to convert to proper path
export function convertObsidianPath(path: string) {
  path = path[0] === "/" ? path.replace("/", "") : path;
  path = path || "/";
  return path;
}

// fills the template with the note data
export function getFilledTemplate(template: string, note: Note, addDeleted = false, dateFormat = 'YYYY-MM-DD') {
  const metadataMatch = template.match(/^---\n([\s\S]*?)\n---\n/m);
  let content = note.content;
  let tags: string[] = [];
  if (template.includes("${tags}")) {
    tags = extractAllTags(note.content);
  }
  if (metadataMatch) {
    const escapeForYaml = (text?: string) => (text || '').replace(/\"/g, '\\"').replace(/\n/, " ").replace("\\", "\\\\");
    const escapedTitle = escapeForYaml(note.title);
    const escapedContent = escapeForYaml(content);
    const escapedSource = escapeForYaml(note.source);
    const escapedSourceTitle = escapeForYaml(note.source_title);
    const escapedSourceDescription = escapeForYaml(note.source_description);
    const escapedSourceImageUrl = escapeForYaml(note.source_image_url);
    const escapedTags = `[${tags.join(", ")}]`;
    var newMetadata = metadataMatch[1]
      .replace(/\$\{title\}/gm, escapedTitle)
      .replace(/\$\{tags\}/gm, escapedTags)
      .replace(/\$\{content\}/gm, escapedContent)
      .replace(/\$\{source\}/gm, escapedSource)
      .replace(/\$\{source_title\}/gm, escapedSourceTitle)
      .replace(/\$\{source_description\}/gm, escapedSourceDescription)
      .replace(/\$\{source_image_url\}/gm, escapedSourceImageUrl);
    if (addDeleted) {
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
      moment(note.created_at).local().format(dateFormat)
    )
    .replace(
      /\$\{last_modified_date\}/gm,
      moment(note.modified_at).local().format(dateFormat)
    )
    .replace(/\$\{content\}/gm, content)
    .replace(/\$\{source\}/gm, note.source)
    .replace(/\$\{source_title\}/gm, note.source_title || '')
    .replace(/\$\{source_description\}/gm, note.source_description || '')
    .replace(/\$\{source_image_url\}/gm, note.source_image_url || '');

  return newTemplate;
}