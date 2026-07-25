import * as Builder from "@notionhq/workers/builder";

import type { SyncConfig } from "./config.js";
import {
	buildSourceUrl,
	DriveApiError,
	type DriveFile,
	type DriveFilePage,
	type ListMarkdownOptions,
} from "./drive.js";
import { countWords, decodeUtf8, parseDraft, transformWikiLinks } from "./markdown.js";

export type ReconcileState = { pageToken?: string };
export type DeltaState = {
	cursor: string;
	cycleCutoff?: string;
	pageToken?: string;
};

export type NotionSearchClient = {
	search(args: {
		query: string;
		filter: { property: "object"; value: "page" };
		sort: { direction: "descending"; timestamp: "last_edited_time" };
		page_size: number;
	}): Promise<{ results: unknown[] }>;
};

export type DriveReader = {
	resolveSubfolders(rootFolderId: string, desiredNames: string[]): Promise<Map<string, string>>;
	listMarkdownFiles(options: ListMarkdownOptions): Promise<DriveFilePage>;
	downloadFile(fileId: string): Promise<Uint8Array>;
};

export type SyncDependencies = {
	drive: DriveReader;
	notion: NotionSearchClient;
	waitForNotion: () => Promise<unknown>;
	config: SyncConfig;
	now?: () => Date;
};

type ActivePage = {
	object: "page";
	url: string;
	archived?: boolean;
	in_trash?: boolean;
};

export async function runReconcile(
	state: ReconcileState | undefined,
	dependencies: SyncDependencies,
) {
	const folders = await dependencies.drive.resolveSubfolders(
		dependencies.config.postboxFolderId,
		dependencies.config.subfolders,
	);
	const page = await dependencies.drive.listMarkdownFiles({
		folderIds: [...folders.values()],
		pageSize: dependencies.config.batchSize,
		pageToken: state?.pageToken,
	});
	const changes = await buildChanges(page.files, folders, dependencies);

	return {
		changes,
		hasMore: Boolean(page.nextPageToken),
		nextState: page.nextPageToken
			? { pageToken: page.nextPageToken }
			: undefined,
	};
}

export async function runDelta(
	state: DeltaState | undefined,
	dependencies: SyncDependencies,
) {
	const now = dependencies.now?.() ?? new Date();
	const cursor = state?.cursor ?? new Date(0).toISOString();
	const cycleCutoff =
		state?.cycleCutoff ??
		new Date(now.getTime() - dependencies.config.deltaBufferMs).toISOString();
	const folders = await dependencies.drive.resolveSubfolders(
		dependencies.config.postboxFolderId,
		dependencies.config.subfolders,
	);
	const page = await dependencies.drive.listMarkdownFiles({
		folderIds: [...folders.values()],
		pageSize: dependencies.config.batchSize,
		pageToken: state?.pageToken,
		modifiedAfter: cursor,
		modifiedThrough: cycleCutoff,
	});
	const changes = await buildChanges(page.files, folders, dependencies);
	const hasMore = Boolean(page.nextPageToken);

	return {
		changes,
		hasMore,
		nextState: hasMore
			? { cursor, cycleCutoff, pageToken: page.nextPageToken }
			: { cursor: cycleCutoff },
	};
}

async function buildChanges(
	files: DriveFile[],
	folders: Map<string, string>,
	dependencies: SyncDependencies,
) {
	const folderNamesById = new Map(
		[...folders.entries()].map(([name, id]) => [id, name]),
	);
	const changes = [];
	for (const file of files) {
		try {
			changes.push(
				await buildUpsert(
					file,
					folderNamesById.get(file.parents?.[0] ?? "") ?? "Unknown",
					dependencies,
				),
			);
		} catch (error) {
			if (error instanceof DriveApiError && error.status === 404) continue;
			throw error;
		}
	}
	return changes;
}

async function buildUpsert(
	file: DriveFile,
	folderName: string,
	dependencies: SyncDependencies,
) {
	const sourceUrl = buildSourceUrl(file);
	const fallback = parseDraft("", file.name);
	const fallbackTitle = fallback.title;
	const fallbackDate = fallback.draftDate ?? isoDate(file.createdTime);
	const deterministicError = contentValidationError(
		file,
		dependencies.config.maxContentBytes,
	);

	if (deterministicError) {
		return makeUpsert({
			file,
			folderName,
			title: fallbackTitle,
			draftDate: fallbackDate,
			sourceUrl,
			unresolvedLinks: 0,
			status: "Needs Attention",
			error: deterministicError,
		});
	}

	const bytes = await dependencies.drive.downloadFile(file.id);
	if (bytes.byteLength > dependencies.config.maxContentBytes) {
		return makeUpsert({
			file,
			folderName,
			title: fallbackTitle,
			draftDate: fallbackDate,
			sourceUrl,
			unresolvedLinks: 0,
			status: "Needs Attention",
			error: `Content exceeds ${dependencies.config.maxContentBytes} bytes.`,
		});
	}

	let content: string;
	try {
		content = decodeUtf8(bytes);
	} catch (error) {
		if (error instanceof TypeError) {
			return makeUpsert({
				file,
				folderName,
				title: fallbackTitle,
				draftDate: fallbackDate,
				sourceUrl,
				unresolvedLinks: 0,
				status: "Needs Attention",
				error: "Content is not valid UTF-8.",
			});
		}
		throw error;
	}

	const parsed = parseDraft(content, file.name);
	const transformed = await transformWikiLinks(parsed.body, async (term) => {
		await dependencies.waitForNotion();
		const response = await dependencies.notion.search({
			query: term,
			filter: { property: "object", value: "page" },
			sort: { direction: "descending", timestamp: "last_edited_time" },
			page_size: 10,
		});
		return response.results.find(isActivePage)?.url;
	});

	return makeUpsert({
		file,
		folderName,
		title: parsed.title,
		draftDate: parsed.draftDate ?? fallbackDate,
		sourceUrl,
		wordCount: countWords(parsed.body),
		unresolvedLinks: transformed.unresolvedCount,
		status: "Synced",
		error: "",
		pageContentMarkdown: transformed.markdown,
	});
}

function makeUpsert(input: {
	file: DriveFile;
	folderName: string;
	title: string;
	draftDate: string;
	sourceUrl: string;
	wordCount?: number;
	unresolvedLinks: number;
	status: "Synced" | "Needs Attention";
	error: string;
	pageContentMarkdown?: string;
}) {
	return {
		type: "upsert" as const,
		key: input.file.id,
		properties: {
			Title: Builder.title(input.title),
			"Drive File ID": Builder.richText(input.file.id),
			"Draft Date": Builder.date(input.draftDate),
			"Postbox Folder": Builder.richText(input.folderName),
			"Source Filename": Builder.richText(input.file.name),
			"Source URL": Builder.url(input.sourceUrl),
			"Drive Created": Builder.dateTime(input.file.createdTime),
			"Drive Modified": Builder.dateTime(input.file.modifiedTime),
			...(input.wordCount === undefined
				? {}
				: { "Word Count": Builder.number(input.wordCount) }),
			"Unresolved Links": Builder.number(input.unresolvedLinks),
			"Sync Status": Builder.select(input.status),
			"Sync Error": Builder.richText(sanitizeError(input.error)),
		},
		upstreamUpdatedAt: input.file.modifiedTime,
		icon: Builder.emojiIcon(input.status === "Synced" ? "✍️" : "⚠️"),
		...(input.pageContentMarkdown === undefined
			? {}
			: { pageContentMarkdown: input.pageContentMarkdown }),
	};
}

function contentValidationError(
	file: DriveFile,
	maxContentBytes: number,
): string | undefined {
	if (file.mimeType !== "text/markdown") return "Source is not a Markdown file.";
	const size = Number(file.size);
	if (Number.isFinite(size) && size > maxContentBytes) {
		return `Content exceeds ${maxContentBytes} bytes.`;
	}
	return undefined;
}

function isoDate(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "1970-01-01" : date.toISOString().slice(0, 10);
}

function sanitizeError(value: string): string {
	return value.replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

function isActivePage(result: unknown): result is ActivePage {
	if (!result || typeof result !== "object") return false;
	const candidate = result as Partial<ActivePage>;
	return (
		candidate.object === "page" &&
		typeof candidate.url === "string" &&
		candidate.archived !== true &&
		candidate.in_trash !== true
	);
}
