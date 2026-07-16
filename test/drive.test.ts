import assert from "node:assert/strict";
import test from "node:test";

import { DriveApiError, DriveClient } from "../src/drive.js";

test("resolves selected subfolders and constructs a paginated Markdown query", async () => {
	const urls: URL[] = [];
	const responses = [
		new Response(
			JSON.stringify({
				files: [
					{ id: "folder-a", name: "A", mimeType: "application/vnd.google-apps.folder" },
					{ id: "folder-z", name: "Z", mimeType: "application/vnd.google-apps.folder" },
				],
			}),
			{ status: 200 },
		),
		new Response(
			JSON.stringify({
				files: [
					{
						id: "draft-1",
						name: "Draft.md",
						mimeType: "text/markdown",
						createdTime: "2026-01-01T00:00:00Z",
						modifiedTime: "2026-01-02T00:00:00Z",
					},
				],
				nextPageToken: "next",
			}),
			{ status: 200 },
		),
	];
	const client = new DriveClient("token", async () => {}, async (input) => {
		urls.push(new URL(String(input)));
		return responses.shift() ?? new Response("missing", { status: 500 });
	});

	const folders = await client.resolveSubfolders("root", ["A", "B", "C"]);
	assert.deepEqual([...folders.entries()], [["A", "folder-a"]]);

	const page = await client.listMarkdownFiles({
		folderIds: [...folders.values()],
		pageSize: 10,
		pageToken: "page-token",
		modifiedAfter: "2026-01-01T00:00:00.000Z",
		modifiedThrough: "2026-01-03T00:00:00.000Z",
	});
	assert.equal(page.files[0].id, "draft-1");
	assert.equal(page.nextPageToken, "next");
	assert.equal(urls[1].searchParams.get("pageToken"), "page-token");
	const query = urls[1].searchParams.get("q") ?? "";
	assert.match(query, /'folder-a' in parents/);
	assert.match(query, /mimeType = 'text\/markdown'/);
	assert.match(query, /modifiedTime > '2026-01-01T00:00:00.000Z'/);
	assert.match(query, /modifiedTime <= '2026-01-03T00:00:00.000Z'/);
});

test("downloads file bytes with bearer authentication", async () => {
	let authorization = "";
	const client = new DriveClient("secret-token", async () => {}, async (_input, init) => {
		authorization = new Headers(init?.headers).get("authorization") ?? "";
		return new Response("hello", { status: 200 });
	});

	const bytes = await client.downloadFile("file/id");
	assert.equal(new TextDecoder().decode(bytes), "hello");
	assert.equal(authorization, "Bearer secret-token");
});

test("returns a sanitized Drive API error without leaking credentials", async () => {
	const client = new DriveClient("secret-token", async () => {}, async () =>
		new Response(JSON.stringify({ error: { message: "File not found" } }), {
			status: 404,
			statusText: "Not Found",
		}),
	);

	await assert.rejects(
		client.downloadFile("missing"),
		(error: unknown) =>
			error instanceof DriveApiError &&
			error.status === 404 &&
			!error.message.includes("secret-token"),
	);
});
