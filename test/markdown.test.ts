import assert from "node:assert/strict";
import test from "node:test";

import { decodeUtf8, parseDraft, transformWikiLinks } from "../src/markdown.js";

test("parses a dated first line and removes it from the body", () => {
	const parsed = parseDraft(
		"2026-07-16: Long Live the God King\n\n_Notes_\n\nDraft text.\n",
		"2026-07-16 Long Live the God King.md",
	);

	assert.deepEqual(parsed, {
		title: "Long Live the God King",
		draftDate: "2026-07-16",
		body: "_Notes_\n\nDraft text.\n",
	});
});

test("falls back to the filename for an empty document", () => {
	assert.deepEqual(parseDraft("", "2026-02-03 Air Compressor.md"), {
		title: "Air Compressor",
		draftDate: "2026-02-03",
		body: "",
	});
});

test("supports Markdown headings in source title lines", () => {
	const parsed = parseDraft("# 2025-12-03 — Dream Notes\nBody", "fallback.md");
	assert.equal(parsed.title, "Dream Notes");
	assert.equal(parsed.draftDate, "2025-12-03");
	assert.equal(parsed.body, "Body");
});

test("resolves each unique wiki term once and preserves unresolved markers", async () => {
	const calls: string[] = [];
	const result = await transformWikiLinks(
		"See [[Project Atlas]] and [[Project Atlas]], but not [[Missing]].",
		async (term) => {
			calls.push(term);
			return term === "Project Atlas" ? "https://notion.so/atlas" : undefined;
		},
	);

	assert.deepEqual(calls, ["Project Atlas", "Missing"]);
	assert.equal(result.resolvedCount, 2);
	assert.equal(result.unresolvedCount, 1);
	assert.equal(
		result.markdown,
		'See <mention-page url="https://notion.so/atlas">Project Atlas</mention-page> and <mention-page url="https://notion.so/atlas">Project Atlas</mention-page>, but not [[Missing]].',
	);
});

test("ignores fenced code, inline code, escapes, and malformed links", async () => {
	const source = [
		"[[Live]]",
		"`[[Inline]]`",
		"\\[[Escaped]]",
		"[[ ]]",
		"[[Nested [term]]]",
		"```md",
		"[[Fenced]]",
		"```",
	].join("\n");
	const result = await transformWikiLinks(source, async () => "https://notion.so/live");

	assert.match(result.markdown, /^<mention-page[^>]+>Live<\/mention-page>/);
	assert.match(result.markdown, /`\[\[Inline\]\]`/);
	assert.match(result.markdown, /\\\[\[Escaped\]\]/);
	assert.match(result.markdown, /\[\[Fenced\]\]/);
	assert.equal(result.resolvedCount, 1);
});

test("escapes page mention text and URLs", async () => {
	const result = await transformWikiLinks(
		"[[A & <B>]]",
		async () => 'https://notion.so/page?a=1&b="2"',
	);
	assert.equal(
		result.markdown,
		'<mention-page url="https://notion.so/page?a=1&amp;b=&quot;2&quot;">A &amp; &lt;B&gt;</mention-page>',
	);
});

test("rejects invalid UTF-8", () => {
	assert.throws(() => decodeUtf8(Uint8Array.from([0xc3, 0x28])), TypeError);
});
