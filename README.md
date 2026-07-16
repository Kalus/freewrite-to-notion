# Freewrite to Notion

A self-hosted [Notion Worker](https://developers.notion.com/workers/get-started/overview)
that syncs Markdown drafts from the Google Drive folder populated by Freewrite
Postbox into a managed Notion database.

The integration is one-way: Google Drive owns the synced page body. It never
logs into Postbox, calls undocumented Postbox endpoints, or writes back to
Freewrite or Google Drive.

## What it does

- Imports every `text/markdown` file directly inside configured Postbox
  subfolders (A, B, and C by default).
- Creates one Notion page per Drive file, keyed by the stable Drive file ID.
- Preserves Markdown and derives the page title and draft date from the first
  nonblank line, falling back to the filename.
- Converts `[[Search Term]]` outside code spans and code fences into a Notion
  page mention for the first active title-search result, ordered by most
  recently edited.
- Leaves unresolved `[[...]]` markers visible and retries them during the next
  daily reconciliation.
- Syncs new and changed files every five minutes and fully reconciles the
  source daily, including deletions and moves out of A/B/C.
- Preserves user-added database properties. The worker-managed properties and
  page body remain controlled by the sync.

Legacy DOCX files and the deprecated Postbox folder are intentionally out of
scope.

## Managed database

The worker creates **Freewrite Drafts** with these managed properties:

| Property | Purpose |
| --- | --- |
| Title | Parsed writing title |
| Drive File ID | Stable primary key |
| Draft Date | Date parsed from the source header or filename |
| Postbox Folder | A, B, C, or another configured folder name |
| Source Filename | Exact Drive filename |
| Source URL | Link to the original Drive file |
| Drive Created / Modified | Source timestamps |
| Unresolved Links | Count of unresolved wiki-link occurrences |
| Sync Status / Sync Error | Deterministic content validation status |

Distinct Drive files remain distinct pages, including device conflict copies
and same-day drafts.

## Prerequisites

- Node.js 22+ and npm 10.9+
- The [Notion CLI](https://developers.notion.com/cli/get-started/installation)
  installed and logged in
- A Google Cloud project with the Google Drive API enabled
- A Notion personal access token with content read capability, used for title
  search from scheduled syncs
- The Drive folder ID for the active `Postbox` folder (not the deprecated one)

The Google Workspace CLI (`gws`), Google Cloud CLI (`gcloud`), and Google Drive
MCP API are not runtime dependencies.

## Install

```shell
git clone https://github.com/Kalus/freewrite-to-notion.git
cd freewrite-to-notion
npm install
npm test
npm run check
```

Copy `.env.example` to `.env` only for local development. Never commit `.env`.

## Google OAuth setup

This worker needs a user-managed Google OAuth connection because Postbox files
already exist in your Drive. The narrow `drive.file` scope cannot normally see
files created by Freewrite, so the personal worker requests read-only Drive
access.

1. Select or create a Google Cloud project and enable **Google Drive API**.
2. Configure the Google OAuth consent screen. Add yourself as a test user while
   developing.
3. From this project directory, create and initially deploy the Notion Worker:

   ```shell
   ntn workers create --name "Freewrite to Notion"
   ntn workers deploy
   ntn workers oauth show-redirect-url
   ```

4. In Google Cloud Console, create an OAuth client with application type
   **Web application**. Add the exact URL printed by
   `ntn workers oauth show-redirect-url` as an authorized redirect URI.
   A Desktop client made for `gws` cannot be reused because its redirect is
   localhost-only.
5. Store the client credentials, Notion token, and active Postbox folder ID as
   worker secrets:

   ```shell
   ntn workers env set GOOGLE_CLIENT_ID=your-client-id
   ntn workers env set GOOGLE_CLIENT_SECRET=your-client-secret
   ntn workers env set NOTION_API_TOKEN=ntn_your-personal-access-token
   ntn workers env set POSTBOX_FOLDER_ID=your-active-postbox-folder-id
   ```

6. Redeploy after setting the OAuth client credentials, then authorize Google:

   ```shell
   ntn workers deploy
   ntn workers oauth start googleDriveAuth
   ```

The worker requests offline access and Notion stores and refreshes the Google
token. Changing the Google client ID or secret requires another deploy.

### Google testing versus production

For an external OAuth app in Testing, refresh tokens for scopes beyond basic
identity can expire after seven days. For stable personal use, publish the
consent screen to Production and complete the unverified-app confirmation for
your own account. Google documents a personal-use verification exception, but
a broadly available hosted service can require restricted-scope verification
and possibly a security assessment. See Google's
[verification guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
and [Drive scope reference](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## Configure

Required secrets:

| Variable | Description |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Google Web OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google Web OAuth client secret |
| `NOTION_API_TOKEN` | Notion personal access token used for search |
| `POSTBOX_FOLDER_ID` | Active Postbox root folder ID |

Optional settings:

| Variable | Default | Description |
| --- | --- | --- |
| `POSTBOX_SUBFOLDERS` | `A,B,C` | Comma-separated direct child folders |
| `SYNC_BATCH_SIZE` | `10` | Files processed per execution |
| `DELTA_BUFFER_MS` | `60000` | Consistency delay behind current time |
| `MAX_CONTENT_BYTES` | `460800` | Maximum Markdown body size |

The Notion CLI login authenticates deployment, but it does not automatically
authenticate Notion API calls made by scheduled syncs. That is why
`NOTION_API_TOKEN` is separate.

## Preview and start syncing

Preview the full reconciliation without writing:

```shell
ntn workers sync trigger freewriteDraftsReconcile --preview
```

If the preview returns `hasMore: true`, pass its returned context to another
preview call as described by the CLI output. Then run the initial import:

```shell
ntn workers sync trigger freewriteDraftsReconcile
ntn workers sync status
```

The delta sync runs every five minutes. You can preview or trigger it manually:

```shell
ntn workers sync trigger freewriteDraftsDelta --preview
ntn workers sync trigger freewriteDraftsDelta
```

For local OAuth testing, authorize the deployed worker once, run
`ntn workers env pull`, and then add `--local` to the preview command. Local
access tokens expire; pull again when needed.

## Markdown and wiki-link behavior

Given:

```markdown
2026-07-16: Project notes

Continue work on [[Project Atlas]].
```

the Notion page is titled `Project notes`, its Draft Date is `2026-07-16`, and
the first line is omitted from the body. `[[Project Atlas]]` becomes a real
Notion page mention when search finds an active page.

Wiki markers are not interpreted when escaped, empty, malformed, nested, inside
inline code, or inside fenced code. Search is title-based and eventually
consistent; directly accessible pages produce the most reliable results.

## Source-of-truth and errors

- Editing a synced Notion page body is temporary. The next Drive update or
  daily reconciliation replaces it.
- User-added database properties survive syncs.
- Files deleted, trashed, or moved out of the configured folders disappear
  after the next daily reconciliation.
- A transient Drive or Notion API error fails the current batch so the runtime
  retries it.
- Invalid UTF-8 and oversized content set `Sync Status` to `Needs Attention`.
  Existing Notion body content is preserved because the failed upsert omits a
  replacement body.

## Troubleshooting

- **`redirect_uri_mismatch`**: copy the exact result of
  `ntn workers oauth show-redirect-url` into the Google Web OAuth client's
  authorized redirect URIs, then redeploy.
- **Google authorization expires weekly**: the consent screen is probably
  still in Testing. Review the production guidance above.
- **`Missing POSTBOX_FOLDER_ID`**: set the remote worker secret; local `.env`
  values are not automatically available to deployed workers.
- **No configured subfolders found**: confirm the root ID points to the active
  Postbox folder and that the configured child names exist.
- **Notion searches return nothing**: verify the PAT has content-read and search
  capability and that the target page is accessible to its user.
- **A file vanished during a run**: a Drive 404 after listing is safely skipped;
  daily reconciliation cleans up its Notion row.

Inspect recent executions with:

```shell
ntn workers runs list
ntn workers sync status
```

## Security, privacy, and commercial use

See [Security and data flow](docs/security-and-data-flow.md) for credential and
content handling, and [Hosted service roadmap](docs/hosted-service-roadmap.md)
for a cautious path from self-hosting to a paid offering.

Freewrite and Postbox are trademarks or services of Astrohaus, Inc. This
project is independent and is not affiliated with or endorsed by Astrohaus or
Notion. Review the current [Freewrite Terms of Service](https://getfreewrite.com/pages/terms-of-service)
and obtain appropriate advice before marketing a hosted commercial service.

## Development

```shell
npm test
npm run check
npm run build
```

Tests use synthetic drafts only.

## License

[MIT](LICENSE)
