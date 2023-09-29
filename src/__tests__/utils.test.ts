import { escapeTitle, getDefaultNoteTitle, decryptText, encryptText } from "../utils";
import { FleetingNotesSettings } from "../settings";
import { Note } from "../main";


describe('escapeTitle function', () => {
  it('should escape special characters', () => {
    const input = '.#special/characters: ^';
    const expected = 'specialcharacters ';
    expect(escapeTitle(input)).toBe(expected);
  });

  it('should truncate the string to a maximum of 40 characters', () => {
    const input = 'This is a long string that should be truncated to 40 characters or less';
    const expected = 'This is a long string that should be tru';
    expect(escapeTitle(input)).toBe(expected);
  });

  it('should handle null input', () => {
    const input: string = null;
    const expected = '';
    expect(escapeTitle(input)).toBe(expected);
  });

  it('should handle empty input', () => {
    const input = '';
    const expected = '';
    expect(escapeTitle(input)).toBe(expected);
  });

  it('should replace newline characters with spaces', () => {
    const input = 'This is a\nstring with\rnewline characters';
    const expected = 'This is a string with newline characters';
    expect(escapeTitle(input)).toBe(expected);
  });

  it('should remove forward slashes and backslashes', () => {
    const input = 'Remove / and \\ from this string';
    const expected = 'Remove  and  from this string';
    expect(escapeTitle(input)).toBe(expected);
  });
});

describe('getDefaultNoteTitle', () => {
  const settings: FleetingNotesSettings = {
    fleeting_notes_folder: 'Fleeting Notes',
    attachments_folder: 'Attachments',
    title_template: '${title}',
    auto_generate_title: true,
    date_format: 'YYYY-MM-DD',
    note_template: "",
    sync_type: "",
    notes_filter: "",
    sync_on_startup: false,
    last_sync_time: undefined,
    sync_obsidian_links: false,
    sync_obsidian_links_title: "",
    firebaseId: "",
    supabaseId: "",
    email: "",
    password: "",
    encryption_key: "",
    sync_interval: undefined
  };

  it('should use note title if it exists', () => {
    const note: Note = {
      id: '123',
      title: 'My \\Note /Title',
      content: 'Some content',
    };

    const result = getDefaultNoteTitle(note, settings);

    expect(result).toBe('My Note Title.md');
  });


  it('should use title from content if note title is empty and auto_generate_title is enabled', () => {
    const note: Note = {
      id: '123',
      content: 'Some content with slashes / and \\',
    };

    const result = getDefaultNoteTitle(note, { ...settings, auto_generate_title: true });

    expect(result).toBe('Some content with slashes  and .md');
  });

  it('should use note ID if note title is empty and auto_generate_title is disabled', () => {
    const note: Note = {
      id: '123',
      content: 'Some content with slashes / and \\',
    };

    const result = getDefaultNoteTitle(note, { ...settings, auto_generate_title: false });

    expect(result).toBe('123.md');
  });
});

describe('Crypto functions', () => {
  it('should encrypt and decrypt correctly with the correct key', () => {
    const originalText = 'My secret message';
    const key = 'SecretKey';
    const encryptedText = encryptText(originalText, key);
    const decryptedText = decryptText(encryptedText, key);
    expect(decryptedText).toEqual(originalText);
  });

  it('should throw an error with the wrong decryption key', () => {
    const originalText = 'My secret message';
    const correctKey = 'CorrectKey';
    const wrongKey = 'WrongKey'; 
    const encryptedText = encryptText(originalText, correctKey);

    try {
      decryptText(encryptedText, wrongKey);
    } catch (error) {
      expect(error).toEqual('Wrong encryption key');
    }
  });
});
