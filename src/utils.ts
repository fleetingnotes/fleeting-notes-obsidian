import { Note } from "./main";
var CryptoJS = require("crypto-js");
import { AuthResponse, createClient } from "@supabase/supabase-js";
import { InputModal, Values, ModalInputField } from "./components/inputModal";

// Create a single supabase client for interacting with your database
const supabase = createClient(
	"https://yixcweyqwkqyvebpmdvr.supabase.co",
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpeGN3ZXlxd2txeXZlYnBtZHZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE2NjQ4MDMyMTgsImV4cCI6MTk4MDM3OTIxOH0.awfZKRuaLOPzniEJ2CIth8NWPYnelLfsWrMWH2Bz3w8"
);

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

export const loginSupabase = async (
	email: string,
	password: string
): Promise<any> => {
	try {
		const supaRes: AuthResponse = await supabase.auth
			.signInWithPassword({
				email,
				password,
			})
			.then((res) => {
				return res;
			});
		return supaRes;
	} catch (err) {
		throwError(err, err.message);
	}
};

export const getAllNotesSupabase = async ({
	firebaseId,
	supabaseId,
	key,
	filterKey,
}: {
	firebaseId: string;
	supabaseId: string;
	key: string;
	filterKey: string;
}) => {
	let notes: Note[] = [];

	try {
		if (!firebaseId) {
			throwError(
				"Fleeting Notes Sync Failed - Please Log In",
				"Fleeting Notes Sync Failed - Please Log In"
			);
		}
		await supabase
			.from("notes")
			.select()
			.filter("_partition", "in", `(${firebaseId},${supabaseId})`)
			.filter("deleted", "eq", false)
			.then((res) => {
				if (res.error) {
					throwError(res.error, res.error.message);
				}
				notes = Array.from(
					res.data?.map((note: any) => decryptNote(note, key)) || []
				);
				if (filterKey) {
					notes = notes.filter(
						(note) =>
							note.title.includes(filterKey) ||
							note.content.includes(filterKey)
					);
				}
			});
		return notes;
	} catch (e) {
		throwError(
			e,
			"Failed to get notes from Fleeting Notes - Check your credentials"
		);
	}
	return notes;
};

interface SupabaseNote {
	id: string;
	title: string;
	content: string;
	source: string;
	created_at: string;
	modified_at: string;
	deleted: boolean;
	shared: boolean;
	encrypted: boolean;
	_partition: string;
}

export const updateNotesSupabase = async ({
	firebaseId,
	supabaseId,
	key,
	notes,
}: {
	firebaseId: string;
	supabaseId: string;
	key: string;
	notes: Array<any>;
}) => {
	try {
		let supabaseNotes: SupabaseNote[] = [];
		let noteIds = notes.map((note) => note.id);
		// get all fields of the note
    const res = await supabase
      .from("notes")
      .select()
      .in("_partition", [firebaseId, supabaseId])
      .eq("deleted", false)
      .in("id", noteIds)

    if (res.error) {
      throwError(res.error, res.error.message);
    }
    supabaseNotes = res.data;

    // only take notes that are modified after note from db & note exists
    notes = notes.filter((note) => {
      let supabaseNote = res.data.find(
        (supabaseNote: any) => supabaseNote.id === note.id
      );
      return (supabaseNote) ? true : false;
    });

    // merge possibly updated fields
    notes = notes.map((note) => {
      let supabaseNote = supabaseNotes?.find(
        (supabaseNote: any) => supabaseNote.id === note.id
      );
      var newNote = {
        ...supabaseNote,
        title: note.title || supabaseNote.title,
        content: note.content || supabaseNote.content,
        source: note.source || supabaseNote.source,
        modified_at: new Date().toISOString(),
        deleted: note.deleted || supabaseNote.deleted,
      };
      return (supabaseNote.encrypted) ? encryptNote(newNote, key) : newNote;
    });

    if (notes.length > 0) {
      const { error } = await supabase
        .from("notes")
        .upsert(notes, {
          onConflict: "id",
        })
      if (error) {
        throwError(error, error.message);
      }
    }
	} catch (e) {
		throwError(
			e,
			"Failed to update notes in Fleeting Notes"
		);
	}
};

export const decryptNote = (note: any, key: string) => {
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
	}
	return note as Note;
};

export const encryptNote = (note: any, key: string) => {
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
		note.is_encrypted = true;
	}
	return note as Note;
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
	let tagRegex = /(^|\B)#(?![0-9_]+\b)([a-zA-Z0-9_]{1,30})(\b|\r)/gm;
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
    .replace(/([*'/\\<>?:|])/g, "");
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
