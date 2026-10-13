# Provider Integration Matrix & Capability Specification

> **Date Last Checked:** October 2026 (Verified against latest vendor API references)  
> **Status:** Authoritative Specification for Discovery Waterfall & Outreach Automation

---

## 1. Overview & Strategy

This document establishes the official integration specifications, endpoint capabilities, credit economics, rate limits, error taxonomy, and fallback decisions for all external services connected to the **Automated Contact Discovery and Google Mail-Merge Pipeline**.

### Discovery Waterfall Strategy: Free-First, Quality-Aware
```
┌─────────────────────────────────────────────────────────────────┐
│ Input: Companies (names/domains) & Target Roles (e.g. Recruiter) │
└──────────────────────────────┬──────────────────────────────────┘
                               │
            ┌──────────────────▼──────────────────┐
            │ Stage A: Company & Domain Resolution│
            │   Normalize name & validate domain   │
            └──────────────────┬──────────────────┘
                               │
            ┌──────────────────▼──────────────────┐
            │ Stage B: Apollo People Search       │
            │   /api/v1/mixed_people/api_search   │
            │   (Free search: 0 export credits)   │
            │   Returns person IDs, names, titles │
            └──────────────────┬──────────────────┘
                               │
         Enrichment enabled    │  Enrichment disabled
         & within budget?      │  or no email returned
        ┌──────────────────────┴──────────────────────┐
        ▼                                             ▼
┌───────────────────────────────┐       ┌───────────────────────────────┐
│ Apollo People Bulk Match      │       │ Stage C: Hunter.io Discovery  │
│   /api/v1/people/bulk_match   │       │   1. /v2/domain-search        │
│   Consumes ~1 credit/verified │       │      (Domain contacts & roles)│
│   email returned              │       │   2. /v2/email-finder         │
└───────────────┬───────────────┘       │      (Name + Domain lookup)   │
                │                       └───────────────┬───────────────┘
                │                                       │
                │           Email unverified?           │
                │        ┌──────────────────────────────┘
                │        ▼
                │ ┌───────────────────────────────┐
                │ │ Hunter Email Verifier (Opt.)  │
                │ │   /v2/email-verifier          │
                │ │   (Consumes 1 verify credit)  │
                │ └──────────────┬────────────────┘
                │                │
                ▼                ▼
    ┌──────────────────────────────────────────────┐
    │ Stage D: Snov.io (Optional / Conditional)    │
    │   OAuth 2.0 Client Credentials               │
    │   /v2/domain-search/domain-emails            │
    └──────────────────────┬───────────────────────┘
                           │
            ┌──────────────▼──────────────────────┐
            │ Stage E: Deduplicate, Reconcile,    │
            │          & Validate Evidence        │
            └──────────────────┬──────────────────┘
                               │
            ┌──────────────────▼──────────────────┐
            │ Contact Table: Ready for Selection  │
            └─────────────────────────────────────┘
```

---

## 2. Apollo.io Integration Specification

### 2.1 Metadata & Documentation
* **Official Documentation URLs:**
  * People API Search: `https://docs.apollo.io/reference/people-api-search`
  * People Bulk Match & Enrichment: `https://docs.apollo.io/reference/people-enrichment`
  * API Pricing & Credits: `https://docs.apollo.io/docs/api-pricing`
  * Developer Overview: `https://docs.apollo.io/`
* **Date Last Checked:** October 2026.
* **Implementation Decision:** **Primary (Stage B Search) + Conditional (Enrichment Match based on budget).**

### 2.2 Endpoints & Capabilities
1. **People API Search (Prospect Discovery)**
   * **Endpoint:** `POST https://api.apollo.io/api/v1/mixed_people/api_search`
   * *Note on Migration:* The legacy `/mixed_people/search` endpoint is deprecated and returns `422 Unprocessable Entity` for new tokens. The current active route is `/api/v1/mixed_people/api_search`.
   * **Parameters:** Query parameters in URL string (e.g., `q_organization_domains[]`, `person_titles[]`, `page`, `per_page`).
   * **Capabilities:** Discovers person profiles matching company domain and job titles. Returns profile IDs, first name, last name, sanitized title, and organization metadata.
   * **Crucial Limitation:** Apollo `api_search` **does not** return verified emails directly in the search payload. It is strictly a prospect discovery endpoint.
2. **People Bulk Match (Email Enrichment)**
   * **Endpoint:** `POST https://api.apollo.io/api/v1/people/bulk_match`
   * **Payload:** `{ "details": [ { "id": "...", "first_name": "...", "last_name": "...", "domain": "..." } ] }` (Up to 10 records per request).
   * **Capabilities:** Unlocks work email addresses, personal emails, direct dials, and LinkedIn URLs.

### 2.3 Authentication & Headers
* **Header:** `X-Api-Key: <APOLLO_API_KEY>` (or `Authorization: Bearer <TOKEN>`).
* **Content-Type:** `application/json`
* **Deprecated:** Passing `api_key` in request body or URL query is deprecated.

### 2.4 Quotas, Credits & Free Tier Rules
* **Free Tier Allocation:** Apollo free plans typically grant 5–10 export/enrichment credits per month and up to 50 search queries/day.
* **Credit Consumption:**
  * `api_search`: **0 credits** (does not consume export credits).
  * `bulk_match` / `match`: Consumes **1 export credit per matched person profile with verified contact information**. Apollo does *not* charge credits if no email or record is found.
* **Rate Limits:**
  * Free/Basic: ~50 requests per minute, 100–300 requests per hour.
  * Standard: Up to 100 req/min.
  * Batch Size: Max 10 records per `bulk_match` invocation.
* **Timeouts:** Recommended client timeout: 15,000 ms.

### 2.5 Required Response Fields
* Person ID: `id` (string)
* Name: `first_name`, `last_name`, `name`
* Job Details: `title`, `headline`
* Organization: `organization.name`, `organization.primary_domain`
* Contact Data (post-enrichment): `email`, `email_status` (`verified`, `guessed`, `extrapolated`, `unavailable`), `linkedin_url`

### 2.6 Error Codes & Handling
* `400 / 422 Unprocessable Entity`: Malformed query parameter or invalid format (do not retry blindly).
* `401 Unauthorized`: Invalid API key. Prompt user in Settings to check key.
* `403 Forbidden`: Account plan does not have access to bulk match endpoint. Disable enrichment gracefully and fall back to Hunter.
* `429 Too Many Requests`: Respect `Retry-After` header. Exponential backoff with jitter (initial delay: 2000 ms).
* `500 / 503 Server Error`: Max 3 retries with exponential backoff (`2^n * 1000ms + random_jitter`).

---

## 3. Hunter.io Integration Specification

### 3.1 Metadata & Documentation
* **Official Documentation URLs:**
  * Hunter API Reference: `https://hunter.io/api-documentation/`
  * Plans & API Limits: `https://help.hunter.io/en/articles/12149400-hunter-api-for-data-plans`
  * API Overview & Errors: `https://help.hunter.io/en/articles/1970956-hunter-api`
* **Date Last Checked:** October 2026.
* **Implementation Decision:** **Primary Alternative (Domain Search & Email Finder) + Conditional (Email Verifier).**

### 3.2 Endpoints & Capabilities
1. **Domain Search**
   * **Endpoint:** `GET https://api.hunter.io/v2/domain-search`
   * **Parameters:** `domain` (required), `company` (optional), `limit` (default 10, max 100), `type` (`personal`), `department`, `seniority`.
   * **Capabilities:** Finds all public email addresses indexed for a domain, along with person names, positions, confidence scores, and source URLs.
2. **Email Finder**
   * **Endpoint:** `GET https://api.hunter.io/v2/email-finder`
   * **Parameters:** `domain` (required), `first_name` (required), `last_name` (required), `company` (optional).
   * **Capabilities:** Identifies the direct email address for a known person at a specific company domain.
3. **Email Verifier**
   * **Endpoint:** `GET https://api.hunter.io/v2/email-verifier`
   * **Parameters:** `email` (required).
   * **Capabilities:** Delivers multi-layer SMTP and DNS validation: status (`valid`, `invalid`, `accept_all`, `webmail`, `disposable`, `unknown`), score (0–100), MX records, and SMTP connection checks.
4. **Account Details & Usage**
   * **Endpoint:** `GET https://api.hunter.io/v2/account`
   * **Capabilities:** Fetches real-time quota usage, plan name, available searches, and verification balance.

### 3.3 Authentication & Headers
* **Header:** `X-API-KEY: <HUNTER_API_KEY>` or query parameter `?api_key=<KEY>`.
* **Content-Type:** `application/json`

### 3.4 Quotas, Credits & Free Tier Rules
* **Free Tier Allocation:** Hunter Free plan provides **25 monthly searches** and **50 monthly verifications**.
* **Credit Consumption:**
  * `domain-search`: Consumes **1 search credit per 10 email addresses returned**. If no email is found, **0 credits** are consumed.
  * `email-finder`: Consumes **1 search credit** per successful email found. Unsuccessful search consumes **0 credits**.
  * `email-verifier`: Consumes **1 verification credit** per request (independent of search credits).
* **Rate Limits:**
  * Free plan: 10 requests / minute.
  * Paid plans: 50–500 requests / minute.
* **Timeouts:** Recommended client timeout: 12,000 ms.

### 3.5 Required Response Fields
* `data.emails[]`:
  * `value` (email string)
  * `first_name`, `last_name`
  * `position` (job title)
  * `confidence` (integer 0–100)
  * `sources[]` (`domain`, `uri`, `extracted_on`)
  * `verification.status` (`valid`, `accept_all`, etc.)

### 3.6 Error Codes & Handling
* `400 Bad Request`: Missing mandatory parameters (`domain`, `email`).
* `401 Unauthorized`: No API key provided or key is invalid.
* `403 Forbidden`: Upgrade required or account suspended.
* `429 Too Many Requests`: Exceeded rate limit or monthly quota exhausted (`data.errors.details`). Mark provider quota exhausted, skip further paid requests.
* `5xx`: Exponential backoff with jitter (max 3 attempts).

---

## 4. Snov.io Integration Specification

### 4.1 Metadata & Documentation
* **Official Documentation URLs:**
  * Snov.io API v2 Documentation: `https://snov.io/knowledge-base/` & `https://api.snov.io/`
* **Date Last Checked:** October 2026.
* **Implementation Decision:** **Optional & Conditional.** Only activated when user provides both `API User ID` and `API Secret` in Settings and explicitly enables Snov.io.

### 4.2 Endpoints & Capabilities
1. **OAuth 2.0 Access Token**
   * **Endpoint:** `POST https://api.snov.io/v1/oauth/access_token`
   * **Body:** `{ "grant_type": "client_credentials", "client_id": "<USER_ID>", "client_secret": "<SECRET>" }`
   * **Response:** `{ "access_token": "...", "expires_in": 3600 }`. Token cached server-side for 50 minutes.
2. **Domain Search (V2 Async)**
   * **Start Endpoint:** `POST https://api.snov.io/v2/domain-search/domain-emails/start`
   * **Payload:** `{ "domain": "...", "type": "all" }`
   * **Result Endpoint:** `GET https://api.snov.io/v2/domain-search/domain-emails/result/{task_hash}`
3. **Domain Email Count (Pre-check)**
   * **Endpoint:** `POST https://api.snov.io/v1/get-domain-emails-count`
   * **Payload:** `{ "domain": "..." }` (Returns count without spending full credits).

### 4.3 Quotas & Credit Costs
* **Free Tier:** 50 credits on signup.
* **Credit Consumption:** 1 credit per discovered prospect email.
* **Error Handling:** 401 on token expiration -> auto-refresh token once.

---

## 5. Google Workspace Integrations Specification

### 5.1 Metadata & Documentation
* **Official Documentation URLs:**
  * Google OAuth 2.0 Web Server Flow: `https://developers.google.com/identity/protocols/oauth2/web-server`
  * Google Drive API v3: `https://developers.google.com/workspace/drive/api`
  * Google Sheets API v4: `https://developers.google.com/workspace/sheets/api`
  * Google Docs API v1: `https://developers.google.com/workspace/docs/api`
  * Gmail API v1 (Drafts & Send): `https://developers.google.com/workspace/gmail/api/guides/drafts`
* **Date Last Checked:** October 2026.
* **Implementation Decision:** **Primary Delivery Platform (Sheets, Docs, Drive, Native Gmail).**

### 5.2 Required OAuth 2.0 Scopes (Least Privilege Principle)
1. `https://www.googleapis.com/auth/spreadsheets`
   * Required to create, format, and populate Google Sheets with discovered contact records.
2. `https://www.googleapis.com/auth/documents`
   * Required to create and update the Google Docs mail-merge template with merge tags.
3. `https://www.googleapis.com/auth/drive.file`
   * Required to manage only the files created by this application (does *not* request broad `drive` scope reading all user files).
4. `https://www.googleapis.com/auth/gmail.compose`
   * Required to create Gmail drafts and send approved messages on behalf of the user. (Avoids full `gmail.modify` or `gmail.readonly`).
5. `openid`, `https://www.googleapis.com/auth/userinfo.email`, `https://www.googleapis.com/auth/userinfo.profile`
   * Required to display the connected account's email and profile picture.

### 5.3 Google Token Lifecycle & Security
* **Flow:** Standard authorization code flow with server-side secret, redirect URI verification, and state parameter (HMAC / cryptographically signed session token) to prevent CSRF.
* **Tokens at Rest:** All `access_token` and `refresh_token` entries are encrypted using AES-256-GCM before storage in the database.
* **Token Refresh:** Automated background refresh via Google OAuth client when token expiry is within 5 minutes.
* **Revocation:** Disconnect action revokes token at `https://oauth2.googleapis.com/revoke` and purges database records.

### 5.4 Google Sheets API v4 Execution
* **Creation:** `POST https://sheets.googleapis.com/v4/spreadsheets`
  * Sheet title: `Outreach Campaign - {CampaignName} - {Date}`
  * Header Row: `["Email", "FirstName", "LastName", "Company", "JobTitle", "Role", "JobURL", "Notes", "Status"]`
* **Formatting (`batchUpdate`):**
  * Freeze row 1 (`frozenRowCount: 1`).
  * Bold header text with subtle professional background fill (`#F1F5F9`).
  * Enable basic filter across all columns.
  * Auto-resize column widths (`autoResizeDimensions`).
* **Idempotency & Resumption:** If a spreadsheet was already created for the campaign, the service appends or updates rows rather than creating duplicate orphan sheets.

### 5.5 Google Docs API v1 Execution
* **Creation:** `POST https://docs.googleapis.com/v1/documents`
  * Document title: `Template - {CampaignName} - {Date}`
* **Content Insertion (`batchUpdate`):**
  * Inserts the subject line header and body text containing template merge variables:
    * `{{FirstName}}`, `{{LastName}}`, `{{Company}}`, `{{JobTitle}}`, `{{Role}}`, `{{JobURL}}`.
* **Handoff:** Returns direct browser link (`https://docs.google.com/document/d/{docId}/edit`).

### 5.6 Native Gmail Fallback Execution
* **API Route:** `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send` or `POST https://gmail.googleapis.com/gmail/v1/users/me/drafts`
* **Message Encoding:** RFC 2822 standard email message encoded in URL-safe base64.
* **Safety Controls:**
  * **Zero Mass-To:** Every outreach email is created as a single, discrete recipient message.
  * **Application Daily Cap:** Default configurable threshold (e.g., 30 emails/day for personal outreach) to protect sender reputation.
  * **Explicit Preview & Approval:** No email is dispatched without user previewing rendered merge tags and approving the campaign.
  * **Suppression Check:** Automatic pre-flight check against bounced, replied, or unsubscribed addresses.

---

## 6. Mailmeteor & Google Docs Mail Merge Workflow

### 6.1 Documentation & Interface Review
* **Official Reference:** `https://mailmeteor.com/docs/`
* **Marketplace Listing:** `Mailmeteor for Google Docs` & `Mailmeteor for Google Sheets`
* **Date Last Checked:** October 2026.
* **Technical Reality:**
  * Mailmeteor does **not** provide an open external REST API allowing arbitrary third-party web apps to trigger headless mail-merge runs inside a user's Google account without user interaction.
  * Its supported workflow is executed via its official Google Workspace Add-on inside Google Docs / Google Sheets.

### 6.2 Reliable Application Handoff
1. **Automated File Generation:** The pipeline builds the Google Sheet with properly named columns matching standard Mailmeteor merge fields (`Email`, `FirstName`, `LastName`, `Company`, `Role`, etc.).
2. **Automated Template Construction:** The pipeline builds the Google Doc containing the corresponding `{{FirstName}}`, `{{Company}}` merge tags.
3. **One-Click Handoff Actions:**
   * Button 1: **"Open Google Docs Template"** (opens in new tab).
   * Button 2: **"Open Google Sheet Recipient List"** (opens in new tab).
4. **Clear In-App Instruction Banner:**
   > "1. Open your generated Google Doc.  
   >  2. In Google Docs menu, click **Extensions > Mailmeteor > New Campaign** (or use your preferred mail merge add-on).  
   >  3. Select your generated Google Sheet (`Outreach Campaign - ...`) as the recipient list.  
   >  4. Preview and send with one click!"
5. **No Add-on Dependency:** If the user does not have Mailmeteor installed, they can click **"Send via Native Gmail"** directly inside our application without leaving the dashboard.

---

## 7. Provider Capability Comparison Matrix

| Provider | Search Contacts by Title & Domain | Return Direct Emails | Email Verification | Live Quota / Balance API | Free Credits Available | Batch Support | Recommended Priority |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Apollo.io** | Yes (`api_search`) | Yes (`bulk_match`) | Yes (Provider status) | Yes (`/v1/users/me` or header) | Search: Yes / Enrich: Limited | 10 per batch | **Stage B (Primary Search)** |
| **Hunter.io** | Yes (`domain-search`) | Yes (`email-finder`) | Yes (`email-verifier`) | Yes (`/v2/account`) | 25 search / 50 verify / mo | Pagination up to 100 | **Stage C (Primary Email Fallback)** |
| **Snov.io** | Yes (`domain-search`) | Yes (`domain-emails`) | Yes (`verification`) | Yes (`/v1/get-user-balance`) | 50 trial credits | Async task hash | **Stage D (Optional / User-Enabled)** |
| **Google Drive / Docs / Sheets** | N/A (Storage/Docs) | N/A | N/A | Google Cloud Quotas | Free standard Google Account quotas | Batch spreadsheet & doc writes | **Output Pipeline** |
| **Gmail API** | N/A | N/A | N/A | 250–2,000 emails/day (Google quota) | Free personal Gmail | 1 msg per individual call | **Native Sending Delivery** |

---

## 8. Error Classification & Fallback Playbook

| HTTP Status | Root Cause | Provider Strategy | Google Strategy | UI Recovery Action |
| :--- | :--- | :--- | :--- | :--- |
| **400 / 422** | Invalid parameters or domain format | Log parameter violation; do not retry; skip invalid entity | Validate merge fields; report missing required columns | Prompt user to correct domain or template variables |
| **401** | Missing / Invalid API key or expired token | Mark provider status as `unauthenticated`; bypass to next provider | Trigger OAuth token refresh; if refresh token expired, set `reconnect_required` | "Update API Key in Settings" or "Reconnect Google Account" button |
| **403** | Insufficient tier or forbidden endpoint | Mark capability as `tier_unsupported`; fallback to alternate provider | Check missing scopes (`drive.file`, `spreadsheets`, `gmail.compose`) | Explain specific scope or plan requirement in error modal |
| **429** | Rate limit or quota exhausted | Read `Retry-After`; if quota 0, set provider `exhausted` and fall back | Exponential backoff (1s, 2s, 4s, 8s); pause sending queue | "Quota reached. Pausing until [time] or switch to Hunter" |
| **500 / 503** | Upstream provider outage | Max 3 retries with jitter; if unsuccessful, advance to next provider in waterfall | Max 3 retries with jitter; retain partially created Sheet/Doc IDs | Show warning: "Apollo service unavailable. Fallback to Hunter succeeded" |
| **Network Timeout** | Connection hung (> 15s) | Mark request ambiguous; do not deduct credits unless verified | Check if draft was created before retrying; prevent duplicate sends | "Connection timed out. Check campaign status." |

---

## 9. Budget and Credit Protection Rules

1. **Pre-flight Estimation:** Before starting any discovery run, calculate `EstimatedMaxCost = TargetCount * CostPerContact`.
2. **Zero-Spend Free Mode:** When enabled in Settings, the pipeline strictly uses Apollo `api_search` and Hunter Free queries, blocking any endpoint that would consume paid export credits.
3. **Enrichment Gate:** Bulk enrichment on Apollo is strictly guarded by an explicit user toggle (`allowEnrichment = true`) and spending cap.
4. **Hard Stopping Limit:** If credit balance drops below 1 or reaches the user's configured run limit, the discovery orchestrator halts further credit-consuming requests and saves all existing contacts.
5. **No Blind Deductions:** Failed searches (e.g. Hunter returning 0 contacts) consume 0 credits and are recorded as 0 cost.
