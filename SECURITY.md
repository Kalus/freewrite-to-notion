# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's security advisory
feature rather than opening a public issue. Do not include OAuth tokens,
personal access tokens, folder IDs, or document content in reports.

## Supported version

Security fixes are applied to the latest version on the default branch.

## Credential handling

All credentials are read from Notion Worker secrets. The repository must never
contain `.env`, `workers.json`, exported Google credentials, OAuth refresh
tokens, Notion tokens, Drive folder IDs, or real draft content.
