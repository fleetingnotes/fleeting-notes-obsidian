import { Note } from "./main";
var CryptoJS = require("crypto-js");
import { moment } from "obsidian";
import { InputModal, ModalInputField, Values } from "./components/inputModal";
import { SupabaseNote } from "./supabase_sync";
import { FleetingNotesSettings } from "./settings";

export function openInputModal(
  title: string,
  inputs: ModalInputField[],
  submitText: string,
  onSubmit: (results: Values) => Promise<boolean>,
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
        "No encryption key found",
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

export const decryptText = (text: string, key: string): string => {
  const bytes = CryptoJS.AES.decrypt(text, key);
  const originalText = bytes.toString(CryptoJS.enc.Utf8);
  if (!originalText) {
    throwError(
      Error("Wrong encryption key"),
      "Wrong encryption key",
    );
  }
  return originalText;
};

export const encryptText = (text: string, key: string): string => {
  const ciphertext = CryptoJS.AES.encrypt(text, key).toString();
  return ciphertext;
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

export const escapeTitle = (t: string | null) =>
  (t || "")
    .substring(0, 40)
    .replace(/[\n\r]/g, " ")
    .replace(/([\[\]\#\*\:\/\\\^\.])/g, "");

export const getDefaultNoteTitle = (
  note: Note,
  settings: FleetingNotesSettings,
) => {
  const noteCopy = { ...note } as Note;
  const titleFromContent = escapeTitle(noteCopy.content) ||
    escapeTitle(noteCopy.source_title);
  if (!noteCopy.title) {
    if (!settings.auto_generate_title || titleFromContent.length === 0) {
      noteCopy.title = noteCopy.id;
    } else {
      noteCopy.title = titleFromContent;
    }
  }
  const title = getFilledTemplate(settings.title_template, noteCopy, false, settings.date_format);
  return `${title.replace(/[\\/]/g, "")}.md`
};

// paths in obsidian are weird, need function to convert to proper path
export function convertObsidianPath(path: string) {
  path = path[0] === "/" ? path.replace("/", "") : path;
  path = path || "/";
  return path;
}

export const escapeForYaml = (text?: string) =>
  (text || "").replace(/"/g, '\\"').replace(/\n/g, " ").replace(
    /\\\\/g,
    "\\\\",
  );

// fills the template with the note data
export function getFilledTemplate(
  template: string,
  note: Note,
  addDeleted = false,
  dateFormat = "YYYY-MM-DD",
) {
  const metadataMatch = template.match(/^---\n([\s\S]*?)\n---\n/m);
  let content = note.content;
  let tags: string[] = [];
  if (template.includes("${tags}")) {
    tags = extractAllTags(note.content);
  }
  if (metadataMatch) {
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
          "deleted: true",
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
      moment(note.created_at).local().format(dateFormat),
    )
    .replace(
      /\$\{last_modified_date\}/gm,
      moment(note.modified_at).local().format(dateFormat),
    )
    .replace(/\$\{content\}/gm, content)
    .replace(/\$\{source\}/gm, note.source)
    .replace(/\$\{source_title\}/gm, note.source_title || "")
    .replace(/\$\{source_description\}/gm, note.source_description || "")
    .replace(/\$\{source_image_url\}/gm, note.source_image_url || "");

  return newTemplate;
}
