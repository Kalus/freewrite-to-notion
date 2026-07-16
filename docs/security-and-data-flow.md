# Security and data flow

## Data path

```text
Freewrite device → Postbox → user's Google Drive → Notion Worker → user's Notion workspace
```

The worker begins at Google Drive. It does not authenticate to Postbox, scrape
Postbox, call internal Postbox routes, or write to the Freewrite ecosystem.

For each scheduled run, the worker:

1. Uses the Notion-managed Google OAuth token to list configured Drive folders.
2. Downloads matching Markdown files into the ephemeral Worker execution.
3. Searches titles visible to the configured Notion personal access token for
   each unique wiki-link term in the current file.
4. Returns managed database upserts to Notion.

The application does not maintain its own database or long-term copy of draft
content. Google OAuth tokens and Worker secrets are stored by the Notion Worker
runtime. Draft text is transmitted from Google to the Worker and then to
Notion, as requested by the user.

## Permissions

- Google: `https://www.googleapis.com/auth/drive.readonly`. This is necessary
  for a personal worker to read files that Freewrite created. The worker does
  not request Drive write access.
- Notion: a personal access token with content-read/search capability. It is
  used only to resolve page titles referenced by `[[...]]`; database writes are
  applied through the sync runtime.

## Content safety

- Only files reported as `text/markdown` and directly parented by configured
  folders are downloaded.
- UTF-8 decoding is strict.
- A configurable 450 KiB safety limit leaves room below Notion's request limit.
- Error text is flattened, truncated, and does not include credentials or
  document content.
- Real drafts are never used as committed test fixtures.

## Operational guidance

- Use a dedicated Google Cloud OAuth client for this worker.
- Rotate the client secret and Notion token if either may have been exposed.
- Review access grants periodically in Google and Notion.
- Keep dependency updates and GitHub security alerts enabled.
- Do not paste secrets into issues, logs, screenshots, or support requests.
