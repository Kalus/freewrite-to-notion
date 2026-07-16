const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const MARKDOWN_MIME_TYPE = "text/markdown";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

export type DriveFile = {
	id: string;
	name: string;
	mimeType: string;
	createdTime: string;
	modifiedTime: string;
	size?: string;
	parents?: string[];
	webViewLink?: string;
};

export type DriveFilePage = {
	files: DriveFile[];
	nextPageToken?: string;
};

export type ListMarkdownOptions = {
	folderIds: string[];
	pageSize: number;
	pageToken?: string;
	modifiedAfter?: string;
	modifiedThrough?: string;
};

export class DriveApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "DriveApiError";
	}
}

export class DriveClient {
	constructor(
		private readonly accessToken: string,
		private readonly wait: () => Promise<unknown>,
		private readonly fetchImpl: typeof fetch = fetch,
	) {}

	async resolveSubfolders(
		rootFolderId: string,
		desiredNames: string[],
	): Promise<Map<string, string>> {
		const query = [
			`${quote(rootFolderId)} in parents`,
			"trashed = false",
			`mimeType = ${quote(FOLDER_MIME_TYPE)}`,
		].join(" and ");
		const params = new URLSearchParams({
			q: query,
			pageSize: "100",
			fields: "files(id,name,mimeType)",
		});
		const payload = await this.getJson<{ files?: DriveFile[] }>(`/files?${params}`);
		const desired = new Set(desiredNames);
		const folders = new Map<string, string>();
		for (const file of payload.files ?? []) {
			if (desired.has(file.name)) folders.set(file.name, file.id);
		}
		if (folders.size === 0) {
			throw new Error(
				`None of the configured Postbox subfolders were found: ${desiredNames.join(", ")}.`,
			);
		}
		return folders;
	}

	async listMarkdownFiles(options: ListMarkdownOptions): Promise<DriveFilePage> {
		if (options.folderIds.length === 0) {
			return { files: [] };
		}

		const parentQuery = options.folderIds
			.map((folderId) => `${quote(folderId)} in parents`)
			.join(" or ");
		const clauses = [
			`(${parentQuery})`,
			"trashed = false",
			`mimeType = ${quote(MARKDOWN_MIME_TYPE)}`,
		];
		if (options.modifiedAfter) {
			clauses.push(`modifiedTime > ${quote(options.modifiedAfter)}`);
		}
		if (options.modifiedThrough) {
			clauses.push(`modifiedTime <= ${quote(options.modifiedThrough)}`);
		}

		const params = new URLSearchParams({
			q: clauses.join(" and "),
			pageSize: String(options.pageSize),
			fields:
				"files(id,name,mimeType,createdTime,modifiedTime,size,parents,webViewLink),nextPageToken",
			orderBy: "modifiedTime,name",
		});
		if (options.pageToken) params.set("pageToken", options.pageToken);

		const payload = await this.getJson<{
			files?: DriveFile[];
			nextPageToken?: string;
		}>(`/files?${params}`);
		return {
			files: payload.files ?? [],
			nextPageToken: payload.nextPageToken,
		};
	}

	async downloadFile(fileId: string): Promise<Uint8Array> {
		await this.wait();
		const response = await this.fetchImpl(
			`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`,
			{ headers: this.headers() },
		);
		if (!response.ok) await throwDriveError(response);
		return new Uint8Array(await response.arrayBuffer());
	}

	private async getJson<T>(path: string): Promise<T> {
		await this.wait();
		const response = await this.fetchImpl(`${DRIVE_API_BASE}${path}`, {
			headers: this.headers(),
		});
		if (!response.ok) await throwDriveError(response);
		return (await response.json()) as T;
	}

	private headers(): HeadersInit {
		return {
			Authorization: `Bearer ${this.accessToken}`,
			Accept: "application/json",
		};
	}
}

export function buildSourceUrl(file: Pick<DriveFile, "id" | "webViewLink">): string {
	return (
		file.webViewLink ??
		`https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`
	);
}

function quote(value: string): string {
	return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

async function throwDriveError(response: Response): Promise<never> {
	let detail = response.statusText;
	try {
		const payload = (await response.json()) as { error?: { message?: string } };
		detail = payload.error?.message ?? detail;
	} catch {
		// Keep the status text when the response is not JSON.
	}
	throw new DriveApiError(
		`Google Drive request failed (${response.status}): ${detail}`,
		response.status,
	);
}
