var axios = require('axios');

//intercept axios calls
jest.mock("axios");

function sum(a, b) {
	return a + b;
}
const data = [
	{
		userId: 1,
		id: 1,
		title: "My First Album",
	},
	{
		userId: 1,
		id: 2,
		title: "Album: The Sequel",
	},
];

//override specific method
axios.get.mockResolvedValue({
	data: data,
});

axios.post.mockResolvedValue({
	data: data,
});

test('get response from google', async () => {
	const response = await axios.get('https://google.com');
	expect(response.data).toEqual(data);
});

test("adds 1 + 2 to equal 3", () => {
	expect(sum(1, 2)).toBe(3);
});
