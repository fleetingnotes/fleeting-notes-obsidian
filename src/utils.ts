import { request } from "obsidian";
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

const firebaseUrl =
	"https://us-central1-fleetingnotes-22f77.cloudfunctions.net";
// takes in API key & query

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

export const getAllNotesSupabase = async (
	firebaseId: string,
	key: string,
	filterKey: string
) => {
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
			.filter("_partition", "eq", firebaseId)
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

export const updateNotesFirebase = async (
	email: string,
	password: string,
	key: string,
	notes: Array<any>
) => {
	try {
		const base64Auth = btoa(`${email}:${password}`);
		var encryptedNotes = Array.from(
			notes.map((note: any) => encryptNote(note, key))
		);
		const config = {
			method: "post",
			url: `${firebaseUrl}/update_notes`,
			contentType: "application/json",
			headers: {
				Authorization: `Basic ${base64Auth}`,
				"hashed-encryption-key": key
					? CryptoJS.SHA256(key).toString()
					: undefined,
				notes: JSON.stringify(encryptedNotes),
			},
		};
		const res = JSON.parse(await request(config));
		if (res.error) {
			throwError(Error(res.error), res.error);
		}
	} catch (e) {
		throwError(
			e,
			"Failed to update notes in Fleeting Notes - Check your credentials"
		);
	}
};

export const updateNotesSupabase = async (
	userInfo: string,
	key: string,
	notes: Array<any>
) => {
	try {
		var encryptedNotes = Array.from(
			notes.map((note: any) => encryptNote(note, key))
		);
		encryptedNotes.forEach(async (note) => {
			await supabase
				.from("notes")
				.update({
					title: note.title,
					content: note.content,
					deleted: note.deleted,
					source: note.source,
				})
				.eq("id", note.id)
				.then((res) => {
					if (res.error) {
						throwError(res.error, res.error.message);
					}
				});
		});
	} catch (e) {
		throwError(
			e,
			"Failed to update notes in Fleeting Notes - Check your credentials"
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
	existingTitles: string[],
	autoGenerateTitle: boolean
) => {
	if (!autoGenerateTitle) {
		const newTitle = `${note.id}.md`;
		existingTitles.push(newTitle);
		return newTitle;
	}

	let title = note.content.substring(0, 40);
	let cutByNewLine = false;
	if (note.content.indexOf("\n") > 0 && note.content.indexOf("\n") < 40) {
		title = note.content.substring(0, note.content.indexOf("\n"));
		cutByNewLine = true;
	}
	title.replace(/([*'/\\<>?:|])/g, "");
	if (!existingTitles.includes(title || `${title}.md`)) {
		const newTitle = title.replace(/([*'/\\<>:?|])/g, "");
		existingTitles.push(newTitle);
		return `${newTitle}.md`;
	}

	const counter = existingTitles.filter((existingTitle) => {
		return title === existingTitle;
	}).length;
	const newTitle = title + ` (${counter})`;
	existingTitles.push(title);
	return `${newTitle}.md`;
};
