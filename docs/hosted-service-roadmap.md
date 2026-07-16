# Hosted service roadmap

The open-source worker is intentionally user-owned: each user deploys into
their own Notion workspace and controls both OAuth grants. That is the lowest
overhead and smallest credential-custody boundary.

## Recommended first paid offering

Offer concierge installation, configuration, and support for user-owned
deployments. This can be charged as a setup or support service without running
a central document-processing backend. Keep the Freewrite/Astrohaus
non-affiliation notice prominent and avoid implying an official partnership.

## Hosted SaaS feasibility gate

Do not turn the Notion Worker deployment into a multi-tenant service. A hosted
product should be a separate application with:

- Google OAuth for Drive access
- a [Notion public connection](https://developers.notion.com/guides/get-started/public-connections)
- encrypted per-tenant token storage and rotation
- a scheduler or job queue with tenant-level isolation and backoff
- onboarding that selects the source folder and Notion destination
- deletion/export controls, privacy policy, terms, support, audit logging, and
  billing

Before building that system, prototype Google Picker with the non-sensitive
`drive.file` scope and verify that selecting the Postbox folder makes its
existing and future descendants readable. Do not assume recursive access. If
it does not work, the service would need `drive.readonly`, which Google
classifies as restricted. A public product that transmits or stores restricted
Drive data may require OAuth verification and an independent security
assessment. See Google's [Drive scope requirements](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## Policy and legal gates

The present design reads a copy that the user has deliberately synchronized to
Google Drive; it never automates Postbox. That reduces, but does not eliminate,
commercial policy and trademark risk.

Before launching a paid hosted product:

1. Obtain written clarification from Astrohaus or appropriate legal review for
   the proposed marketing and use of Freewrite/Postbox names.
2. Review the current [Freewrite Terms of Service](https://getfreewrite.com/pages/terms-of-service),
   Google API Services User Data Policy, Google OAuth verification rules, and
   Notion developer requirements.
3. Complete Google and Notion production review requirements before accepting
   users outside a controlled pilot.
4. Publish accurate data retention, deletion, subprocessors, incident response,
   and support policies.

This document is an engineering roadmap, not legal advice.
