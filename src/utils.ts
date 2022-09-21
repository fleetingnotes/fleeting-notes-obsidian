import { request } from "obsidian";
import { Note } from "./main";
var CryptoJS = require("crypto-js");

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
export const getAllNotesFirebase = async (
	email: string,
	password: string,
	key: string,
	filterKey: string
) => {
	let notes: Note[] = [];
	try {
		const base64Auth = btoa(`${email}:${password}`);
		const config = {
			method: "post",
			url: `${firebaseUrl}/get_all_notes`,
			contentType: "application/json",
			headers: {
				Authorization: `Basic ${base64Auth}`,
				"hashed-encryption-key": key
					? CryptoJS.SHA256(key).toString()
					: undefined,
			},
		};
		const res = JSON.parse(await request(config));
		if (res.error) {
			throwError(Error(res.error), res.error);
		}
		notes = Array.from(res.map((note: any) => decryptNote(note, key)));
		if (filterKey) {
			notes = notes.filter((note) =>
				note.title.includes(filterKey) || note.content.includes(filterKey)
			);
		}
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

export const decryptNote = (note: any, key: string) => {
	if (note.is_encrypted) {
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

export const extractAllTags = (text: string): [string, string[]] => {
	let tags = [];
	let tagRegex = /(^|\B)#(?![0-9_]+\b)([a-zA-Z0-9_]{1,30})(\b|\r)/gm;
	//get all tags, and when adding a tag, remove # and add quotation marks
	let match = tagRegex.exec(text);
	while (match != null) {
		tags.push(`"${match[2]}"`);
		match = tagRegex.exec(text);
	}
	text = text.replace(tagRegex, "");
	return [text, tags];
}