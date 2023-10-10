import { AuthResponse, createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";
import { Note } from "main";
import { FleetingNotesSettings } from "settings";
import { decryptNote, encryptNote, throwError } from "utils";

const supabase = createClient(
  "https://yixcweyqwkqyvebpmdvr.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpeGN3ZXlxd2txeXZlYnBtZHZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE2NjQ4MDMyMTgsImV4cCI6MTk4MDM3OTIxOH0.awfZKRuaLOPzniEJ2CIth8NWPYnelLfsWrMWH2Bz3w8",
);

export interface SupabaseNote {
  id: string;
  title: string;
  content: string;
  source: string;
  source_title?: string;
  source_description?: string;
  source_image_url?: string;
  created_at: string;
  modified_at: string;
  deleted: boolean;
  shared: boolean;
  encrypted: boolean;
  _partition: string;
}

class SupabaseSync {
  settings: FleetingNotesSettings;
  constructor(settings: FleetingNotesSettings) {
    this.settings = settings;
  }

  isUpdateNoteSimilar(supaNote: SupabaseNote, updateNote: Note): boolean {
    let tempSupaNote = { ...supaNote } as SupabaseNote;
    if (tempSupaNote.encrypted) {
      tempSupaNote = decryptNote(tempSupaNote, this.settings.encryption_key);
    }
    // If updateNote property is empty, then we dont count it as being similar
    return (typeof updateNote.title !== "string" ||
      updateNote.title === tempSupaNote.title) &&
      (typeof updateNote.content !== "string" ||
        updateNote.content === tempSupaNote.content) &&
      (typeof updateNote.source !== "string" ||
        updateNote.source === tempSupaNote.source) &&
      (typeof updateNote.deleted !== "boolean" ||
        updateNote.deleted === tempSupaNote.deleted);
  }

  updateNote = async (note: Note) => {
    await this.updateNotes([note]);
  };

  updateNotes = async (notes: Note[]) => {
    try {
      let supabaseNotes: SupabaseNote[] = [];
      let noteIds = new Set(notes.map((note) => note.id));
      // get all fields of the note
      const query = supabase
        .from("notes")
        .select()
        .in("_partition", [this.settings.firebaseId, this.settings.supabaseId])
        .eq("deleted", false);

      // header size will be too big otherwise
      if (noteIds.size < 100) {
        query.in("id", [...noteIds]);
      }
      const res = await query;

      if (res.error) {
        throwError(res.error, res.error.message);
      }
      supabaseNotes = res.data;

      // only take notes that are modified after note from db & note exists
      // and only take notes that are different then what's on cloud
      notes = notes.filter((note) => {
        let supabaseNote = res.data.find(
          (supabaseNote: SupabaseNote) =>
            supabaseNote.id === note.id && noteIds.has(supabaseNote.id),
        );
        return (supabaseNote)
          ? !this.isUpdateNoteSimilar(supabaseNote, note)
          : false;
      });

      // merge possibly updated fields
      notes = notes.map((note) => {
        let supabaseNote = supabaseNotes?.find(
          (supabaseNote: any) => supabaseNote.id === note.id,
        );
        var newNote = {
          ...supabaseNote,
          title: note.title || supabaseNote.title,
          content: note.content || supabaseNote.content,
          source: note.source || supabaseNote.source,
          modified_at: new Date().toISOString(),
          deleted: note.deleted || supabaseNote.deleted,
        };
        return (supabaseNote.encrypted)
          ? encryptNote(newNote, this.settings.encryption_key)
          : newNote;
      });

      if (notes.length > 0) {
        const { error } = await supabase
          .from("notes")
          .upsert(notes, {
            onConflict: "id",
          });
        if (error) {
          throwError(error, error.message);
        }
      }
    } catch (e) {
      throwError(
        e,
        "Failed to update notes in Fleeting Notes",
      );
    }
  };

  createEmptyNote = async () => {
    const emptyNote = {
      id: uuidv4(),
      title: "",
      content: "",
      source: "",
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
      deleted: false,
      shared: false,
      encrypted: false,
      _partition: this.settings.supabaseId,
    } as SupabaseNote;
    const { error } = await supabase.from("notes").insert(emptyNote);
    if (error) {
      throw error;
    }
    return emptyNote;
  };

  getNoteByTitle = async (title: string) => {
    const res = await supabase.from("notes").select()
      .eq("title", title)
      .eq("deleted", false);
    let note = null;
    if (res.data && res.data.length > 0) {
      note = decryptNote(res.data[0], this.settings.encryption_key);
    }
    return note as Note | null;
  };

  getAllNotes = async () => {
    let notes: Note[] = [];
    try {
      if (!this.settings.firebaseId && !this.settings.supabaseId) {
        throwError(
          "Fleeting Notes Sync Failed - Please Log In",
          "Fleeting Notes Sync Failed - Please Log In",
        );
      }
      let query = supabase
        .from("notes")
        .select()
        .filter(
          "_partition",
          "in",
          `(${this.settings.firebaseId},${this.settings.supabaseId})`,
        )
        .filter("deleted", "eq", false);
      if (this.settings.sync_obsidian_links) {
        query.neq("title", this.settings.sync_obsidian_links_title);
      }
      await query.then((res) => {
        if (res.error) {
          throwError(res.error, res.error.message);
        }
        notes = Array.from(
          res.data?.map((note: any) =>
            decryptNote(note, this.settings.encryption_key)
          ) || [],
        );
        if (this.settings.notes_filter) {
          notes = notes.filter(
            (note) =>
              note.title.includes(this.settings.notes_filter) ||
              note.content.includes(this.settings.notes_filter),
          );
        }
      });
      return notes;
    } catch (e) {
      throwError(
        e,
        "Failed to get notes from Fleeting Notes - Check your credentials",
      );
    }
    return notes;
  };

  // supabase auth stuff
  static loginSupabase = async (
    email: string,
    password: string,
  ): Promise<AuthResponse> => {
    try {
      const supaRes: AuthResponse = await supabase.auth
        .signInWithPassword({
          email,
          password,
        });
      if (supaRes.error) {
        throwError(supaRes.error, supaRes.error.message);
      }
      return supaRes;
    } catch (err) {
      throwError(err, err.message);
    }
  };

  static restoreSession = async (): Promise<boolean> => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.error("Error restoring session:", error);
        return false;
      }
      if (data) {
        await supabase.auth.refreshSession({ refresh_token: data.session.refresh_token })
        return true
      }
    } catch (error) {
      console.error("Error restoring session:", error);
    }
    return false;
  }

  static getSession = async (): Promise<any> => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.error("Error restoring session:", error);
        return false;
      }
      return data.session;
    } catch (error) {
      console.error("Error restoring session:", error);
    }
    return false;
  }

  static onAuthStateChange = async (callback: (event: string) => void) => {
    // check user logged in
    supabase.auth.getUser().then((v) => {
      if (!v.data?.user) {
        callback("SIGNED_OUT");
      }
    });
    return supabase.auth.onAuthStateChange(callback);
  };
  onNoteChange = async (handleNoteChange: (note: SupabaseNote) => void) => {
    if (!this.settings.supabaseId && !this.settings.firebaseId) return;
    await this.removeAllChannels();
    supabase
      .channel("public:notes")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "notes",
      }, (payload) => {
        let note = payload.new as unknown as SupabaseNote;
        if (
          this.settings.sync_obsidian_links &&
          note.title === this.settings.sync_obsidian_links_title
        ) {
          return;
        }
        if (
          [this.settings.supabaseId, this.settings.firebaseId].includes(
            note._partition,
          )
        ) {
          if (note.encrypted) {
            note = decryptNote(note, this.settings.encryption_key);
          }
          handleNoteChange(note);
        }
      })
      .subscribe();
  };

  removeAllChannels = async () => {
    await supabase.removeAllChannels();
  };
}

export default SupabaseSync;
