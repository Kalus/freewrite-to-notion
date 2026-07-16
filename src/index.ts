import { Worker } from "@notionhq/workers";
import * as Schema from "@notionhq/workers/schema";

import { getSyncConfig } from "./config.js";
import { DriveClient } from "./drive.js";
import { runDelta, runReconcile, type DeltaState, type ReconcileState } from "./sync.js";

const worker = new Worker();
export default worker;

const googleDriveAuth = worker.oauth("googleDriveAuth", {
	name: "freewrite-google-drive",
	authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
	tokenEndpoint: "https://oauth2.googleapis.com/token",
	scope: "https://www.googleapis.com/auth/drive.readonly",
	clientId: process.env.GOOGLE_CLIENT_ID ?? "",
	clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
	authorizationParams: {
		access_type: "offline",
		prompt: "consent",
		include_granted_scopes: "true",
	},
});

const freewriteDrafts = worker.database("freewriteDrafts", {
	type: "managed",
	initialTitle: "Freewrite Drafts",
	primaryKeyProperty: "Drive File ID",
	schema: {
		properties: {
			Title: Schema.title(),
			"Drive File ID": Schema.richText(),
			"Draft Date": Schema.date(),
			"Postbox Folder": Schema.richText(),
			"Source Filename": Schema.richText(),
			"Source URL": Schema.url(),
			"Drive Created": Schema.date(),
			"Drive Modified": Schema.date(),
			"Unresolved Links": Schema.number(),
			"Sync Status": Schema.select([
				{ name: "Synced", color: "green" },
				{ name: "Needs Attention", color: "red" },
			]),
			"Sync Error": Schema.richText(),
		},
	},
});

const driveApi = worker.pacer("googleDriveApi", {
	allowedRequests: 10,
	intervalMs: 1000,
});

const notionSearchApi = worker.pacer("notionSearchApi", {
	allowedRequests: 2,
	intervalMs: 1000,
});

worker.sync("freewriteDraftsDelta", {
	database: freewriteDrafts,
	mode: "incremental",
	schedule: "5m",
	execute: async (state: DeltaState | undefined, { notion }) => {
		const config = getSyncConfig();
		const drive = new DriveClient(
			await googleDriveAuth.accessToken(),
			() => driveApi.wait(),
		);
		return runDelta(state, {
			drive,
			notion,
			waitForNotion: () => notionSearchApi.wait(),
			config,
		});
	},
});

worker.sync("freewriteDraftsReconcile", {
	database: freewriteDrafts,
	mode: "replace",
	schedule: "1d",
	execute: async (state: ReconcileState | undefined, { notion }) => {
		const config = getSyncConfig();
		const drive = new DriveClient(
			await googleDriveAuth.accessToken(),
			() => driveApi.wait(),
		);
		return runReconcile(state, {
			drive,
			notion,
			waitForNotion: () => notionSearchApi.wait(),
			config,
		});
	},
});
