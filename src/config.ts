export const DEFAULT_SUBFOLDERS = ["A", "B", "C"] as const;
export const DEFAULT_BATCH_SIZE = 10;
export const DEFAULT_DELTA_BUFFER_MS = 60_000;
export const DEFAULT_MAX_CONTENT_BYTES = 450 * 1024;

export type SyncConfig = {
	postboxFolderId: string;
	subfolders: string[];
	batchSize: number;
	deltaBufferMs: number;
	maxContentBytes: number;
};

export function getSyncConfig(env: NodeJS.ProcessEnv = process.env): SyncConfig {
	const postboxFolderId = env.POSTBOX_FOLDER_ID?.trim();
	if (!postboxFolderId) {
		throw new Error("Missing POSTBOX_FOLDER_ID.");
	}

	const subfolders = (env.POSTBOX_SUBFOLDERS ?? DEFAULT_SUBFOLDERS.join(","))
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean);

	if (subfolders.length === 0) {
		throw new Error("POSTBOX_SUBFOLDERS must contain at least one folder name.");
	}

	return {
		postboxFolderId,
		subfolders: [...new Set(subfolders)],
		batchSize: parsePositiveInteger(env.SYNC_BATCH_SIZE, DEFAULT_BATCH_SIZE),
		deltaBufferMs: parsePositiveInteger(
			env.DELTA_BUFFER_MS,
			DEFAULT_DELTA_BUFFER_MS,
		),
		maxContentBytes: parsePositiveInteger(
			env.MAX_CONTENT_BYTES,
			DEFAULT_MAX_CONTENT_BYTES,
		),
	};
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
