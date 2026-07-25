import assert from "node:assert/strict";
import test from "node:test";

import type { SyncConfig } from "../src/config.js";
import type { DriveFile, DriveFilePage, ListMarkdownOptions } from "../src/drive.js";
import {
	runDelta,
	runReconcile,
	type DriveReader,
	type NotionSearchClient,
} from "../src/sync.js";

const config: SyncConfig = {
	postboxFolderId: "root",
	subfolders: ["A", "B", "C"],
	batchSize: 10,
	deltaBufferMs: 60_000,
	maxContentBytes: 450 * 1024,
};

const file: DriveFile = {
	id: "drive-file-1",
	name: "2026-07-16 Long Live the God King.md",
	mimeType: "text/markdown",
	createdTime: "2026-07-16T11:53:58.857Z",
	modifiedTime: "2026-07-16T12:03:12.985Z",
	size: "100",
	parents: ["folder-a"],
	webViewLink: "https://drive.google.com/file/d/drive-file-1/view",
};

test("reconcile builds a synced page and chooses the first active Notion result", async () => {
	const drive = fakeDrive({
		files: [file],
		content: "2026-07-16: Long Live the God King\n\nSee [[Search Term]].",
	});
	const searchCalls: unknown[] = [];
	const notion: NotionSearchClient = {
		async search(args) {
			searchCalls.push(args);
			return {
				results: [
					{ object: "page", url: "https://notion.so/trashed", in_trash: true },
					{ object: "page", url: "https://notion.so/result", in_trash: false },
				],
			};
		},
	};

	const result = await runReconcile(undefined, {
		drive,
		notion,
		waitForNotion: async () => {},
		config,
	});

	assert.equal(result.hasMore, false);
	assert.equal(result.changes.length, 1);
	const change = result.changes[0];
	assert.equal(change.key, file.id);
	assert.equal(change.upstreamUpdatedAt, file.modifiedTime);
	assert.equal(
		change.pageContentMarkdown,
		'See <mention-page url="https://notion.so/result">Search Term</mention-page>.',
	);
	assert.deepEqual(change.properties.Title, [["Long Live the God King"]]);
	assert.deepEqual(change.properties["Postbox Folder"], [["A"]]);
	assert.deepEqual(change.properties["Word Count"], [["3"]]);
	assert.deepEqual(change.properties["Sync Status"], [["Synced"]]);
	assert.equal(searchCalls.length, 1);
	assert.deepEqual(searchCalls[0], {
		query: "Search Term",
		filter: { property: "object", value: "page" },
		sort: { direction: "descending", timestamp: "last_edited_time" },
		page_size: 10,
	});
});

test("delta persists pagination state and advances to the buffered cutoff", async () => {
	const listed: ListMarkdownOptions[] = [];
	const drive = fakeDrive({ files: [], nextPageToken: "next", listed });
	const now = new Date("2026-07-16T12:10:00.000Z");
	const first = await runDelta(
		{ cursor: "2026-07-16T12:00:00.000Z" },
		{
			drive,
			notion: emptyNotion(),
			waitForNotion: async () => {},
			config,
			now: () => now,
		},
	);

	assert.equal(first.hasMore, true);
	assert.deepEqual(first.nextState, {
		cursor: "2026-07-16T12:00:00.000Z",
		cycleCutoff: "2026-07-16T12:09:00.000Z",
		pageToken: "next",
	});
	assert.equal(listed[0].modifiedThrough, "2026-07-16T12:09:00.000Z");

	const final = await runDelta(first.nextState, {
		drive: fakeDrive({ files: [], listed }),
		notion: emptyNotion(),
		waitForNotion: async () => {},
		config,
		now: () => new Date("2026-07-16T12:20:00.000Z"),
	});
	assert.equal(final.hasMore, false);
	assert.deepEqual(final.nextState, { cursor: "2026-07-16T12:09:00.000Z" });
});

test("oversized content is marked for attention without downloading or replacing a body", async () => {
	let downloaded = false;
	const drive = fakeDrive({ files: [{ ...file, size: String(config.maxContentBytes + 1) }] });
	drive.downloadFile = async () => {
		downloaded = true;
		return new Uint8Array();
	};

	const result = await runReconcile(undefined, {
		drive,
		notion: emptyNotion(),
		waitForNotion: async () => {},
		config,
	});
	const change = result.changes[0];
	assert.equal(downloaded, false);
	assert.equal("pageContentMarkdown" in change, false);
	assert.equal("Word Count" in change.properties, false);
	assert.deepEqual(change.properties["Sync Status"], [["Needs Attention"]]);
	assert.match(change.properties["Sync Error"][0][0], /exceeds/);
});

test("invalid UTF-8 is deterministic but transient download errors propagate", async () => {
	const invalidDrive = fakeDrive({ files: [file] });
	invalidDrive.downloadFile = async () => Uint8Array.from([0xc3, 0x28]);
	const invalid = await runReconcile(undefined, {
		drive: invalidDrive,
		notion: emptyNotion(),
		waitForNotion: async () => {},
		config,
	});
	assert.deepEqual(invalid.changes[0].properties["Sync Status"], [["Needs Attention"]]);

	const failingDrive = fakeDrive({ files: [file] });
	failingDrive.downloadFile = async () => {
		throw new Error("temporary network failure");
	};
	await assert.rejects(
		runReconcile(undefined, {
			drive: failingDrive,
			notion: emptyNotion(),
			waitForNotion: async () => {},
			config,
		}),
		/temporary network failure/,
	);
});

function fakeDrive(input: {
	files: DriveFile[];
	content?: string;
	nextPageToken?: string;
	listed?: ListMarkdownOptions[];
}): DriveReader {
	return {
		async resolveSubfolders() {
			return new Map([
				["A", "folder-a"],
				["B", "folder-b"],
				["C", "folder-c"],
			]);
		},
		async listMarkdownFiles(options): Promise<DriveFilePage> {
			input.listed?.push(options);
			return { files: input.files, nextPageToken: input.nextPageToken };
		},
		async downloadFile() {
			return new TextEncoder().encode(input.content ?? "2026-07-16: Draft\nBody");
		},
	};
}

function emptyNotion(): NotionSearchClient {
	return { async search() { return { results: [] }; } };
}
