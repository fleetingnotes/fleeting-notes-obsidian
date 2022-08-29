import { getAllNotesFirebase } from "./utils";
function sum(a: number, b: number): number {
	return a + b;
}

test("adds 1 + 2 to equal 3", () => {
	expect(sum(1, 2)).toBe(3);
});

//checks if all files have a title
// let email = "test@gmail.com";
// let password = "test";
// let key = "test";

// test("api call returns titles of notes", async (): Promise<void> => {
// 	const notes: any = await getAllNotesFirebase(email, password, key);
// 	console.log("notes", notes);
// 	expect(notes[0].title).toBeTruthy();
// });
