const utils = require('./utils');

function sum(a, b) {
	return a + b;
}


// Somewhere in your test case or test suite
utils.getAllNotesFromFirebase = jest.fn().mockReturnValue({ notes: [note] });

test("adds 1 + 2 to equal 3", () => {
	expect(sum(1, 2)).toBe(3);
});

// create a test that fake gets from function and compares it with note
describe("getNotes", () => {
	it("should return notes", () => {
		expect(utils.getAllNotesFromFirebase()).toBe([note]);
	});
});




const note = {
	_id: '1',
	title: 'title',
	content: 'content',
	timestamp: '2022-08-03',
	source: 'https://www.google.com',
	_isDeleted: false,
}


