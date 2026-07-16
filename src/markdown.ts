const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})(?:(?:\s*[:#\-–—]\s*)|\s+)(.*)$/;
const LEADING_DATE = /^(\d{4}-\d{2}-\d{2})(?:\b|\s|[:#\-–—])/;

export type ParsedDraft = {
	title: string;
	draftDate?: string;
	body: string;
};

export type WikiLinkResult = {
	markdown: string;
	unresolvedCount: number;
	resolvedCount: number;
};

export type WikiLinkResolver = (term: string) => Promise<string | undefined>;

type WikiToken = {
	start: number;
	end: number;
	term: string;
};

export function decodeUtf8(bytes: Uint8Array): string {
	return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function parseDraft(content: string, filename: string): ParsedDraft {
	const normalized = content.startsWith("\uFEFF") ? content.slice(1) : content;
	const firstLine = findFirstNonblankLine(normalized);
	const filenameStem = filename.replace(/\.md$/i, "");
	const header = firstLine ? parseTitle(firstLine.text) : undefined;
	const fallback = parseTitle(filenameStem);
	const title = cleanTitle(header?.title) || cleanTitle(fallback.title) || filenameStem;
	const draftDate = validDate(header?.date) ?? validDate(fallback.date);

	return {
		title,
		draftDate,
		body: firstLine ? removeLine(normalized, firstLine.start, firstLine.end) : normalized,
	};
}

export async function transformWikiLinks(
	markdown: string,
	resolver: WikiLinkResolver,
): Promise<WikiLinkResult> {
	const tokens = findWikiTokens(markdown);
	if (tokens.length === 0) {
		return { markdown, unresolvedCount: 0, resolvedCount: 0 };
	}

	const resolutions = new Map<string, string | undefined>();
	for (const term of new Set(tokens.map((token) => token.term))) {
		resolutions.set(term, await resolver(term));
	}

	let output = "";
	let cursor = 0;
	let unresolvedCount = 0;
	let resolvedCount = 0;
	for (const token of tokens) {
		output += markdown.slice(cursor, token.start);
		const url = resolutions.get(token.term);
		if (url) {
			output += `<mention-page url="${escapeXml(url)}">${escapeXml(token.term)}</mention-page>`;
			resolvedCount += 1;
		} else {
			output += markdown.slice(token.start, token.end);
			unresolvedCount += 1;
		}
		cursor = token.end;
	}
	output += markdown.slice(cursor);

	return { markdown: output, unresolvedCount, resolvedCount };
}

function findWikiTokens(markdown: string): WikiToken[] {
	const tokens: WikiToken[] = [];
	let index = 0;
	let lineStart = true;
	let fence: { character: string; length: number } | undefined;
	let inlineTicks = 0;

	while (index < markdown.length) {
		if (lineStart) {
			const fenceMatch = markdown.slice(index).match(/^ {0,3}(`{3,}|~{3,})/);
			if (fenceMatch) {
				const marker = fenceMatch[1];
				if (!fence) {
					fence = { character: marker[0], length: marker.length };
				} else if (
					marker[0] === fence.character &&
					marker.length >= fence.length
				) {
					fence = undefined;
				}
			}
		}

		const character = markdown[index];
		if (character === "\n") {
			lineStart = true;
			inlineTicks = 0;
			index += 1;
			continue;
		}
		if (lineStart && character !== " " && character !== "\t") lineStart = false;
		if (fence) {
			index += 1;
			continue;
		}

		if (character === "\\") {
			index += Math.min(2, markdown.length - index);
			continue;
		}

		if (character === "`") {
			let run = 1;
			while (markdown[index + run] === "`") run += 1;
			if (inlineTicks === 0) inlineTicks = run;
			else if (run === inlineTicks) inlineTicks = 0;
			index += run;
			continue;
		}

		if (inlineTicks === 0 && markdown.startsWith("[[", index)) {
			const close = markdown.indexOf("]]", index + 2);
			if (close !== -1) {
				const rawTerm = markdown.slice(index + 2, close);
				const term = rawTerm.trim();
				if (
					term.length > 0 &&
					term.length <= 200 &&
					!/[\r\n\[\]]/.test(rawTerm)
				) {
					tokens.push({ start: index, end: close + 2, term });
					index = close + 2;
					continue;
				}
			}
		}

		index += 1;
	}

	return tokens;
}

function findFirstNonblankLine(
	content: string,
): { text: string; start: number; end: number } | undefined {
	let offset = 0;
	for (const line of content.split(/(?<=\n)/)) {
		const text = line.replace(/[\r\n]+$/, "");
		if (text.trim()) return { text, start: offset, end: offset + line.length };
		offset += line.length;
	}
	return undefined;
}

function removeLine(content: string, start: number, end: number): string {
	const before = content.slice(0, start);
	const after = content.slice(end);
	return `${before}${after}`.replace(/^\s*\r?\n/, "");
}

function parseTitle(value: string): { title: string; date?: string } {
	const withoutHeading = value.trim().replace(/^#{1,6}\s*/, "").trim();
	const match = withoutHeading.match(DATE_PREFIX);
	if (match) return { date: match[1], title: match[2].trim() };
	const date = withoutHeading.match(LEADING_DATE)?.[1];
	return { date, title: withoutHeading };
}

function cleanTitle(value: string | undefined): string {
	return (value ?? "").trim().replace(/\s+/g, " ");
}

function validDate(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const date = new Date(`${value}T00:00:00Z`);
	return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
		? undefined
		: value;
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
