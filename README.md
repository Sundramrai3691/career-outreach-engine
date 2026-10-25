# Automated Contact Discovery & Google Mail-Merge Pipeline

A full-stack professional outreach engine designed to automate contact discovery across multiple providers (Apollo.io, Hunter.io, Snov.io), prepare mail-merge campaigns in Google Sheets and Google Docs, and send personalized emails through your own Google account or the Mailmeteor Google Docs add-on.

Built with **React**, **TypeScript**, **Vite**, **Node.js**, **Express**, **Prisma ORM (SQLite / PostgreSQL)**, and official **Google Workspace APIs**.

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             REACT + VITE FRONTEND                           │
│  Dashboard • New Discovery • Live Progress • Contacts Table • Templates     │
│             Mail Merge Handoff • Native Gmail Sender • Settings            │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ REST API (/api)
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                         NODE.JS + EXPRESS BACKEND                           │
│  - Discovery Waterfall Orchestrator     - Budget & Spending Cap Manager     │
│  - Multi-Stage Verification Pipeline    - AES-256 Token Encryption at Rest │
│  - Suppression & Bounces Guard          - Idempotency & Send Guards         │
└───────┬──────────────────────────────┬───────────────────────────────┬──────┘
        │                              │                               │
┌───────▼────────┐             ┌───────▼────────┐              ┌───────▼──────┐
│    PROVIDERS   │             │   PERSISTENCE  │              │    GOOGLE    │
│  Apollo.io     │             │  SQLite / PG   │              │ Google OAuth │
│  Hunter.io     │             │  Prisma ORM    │              │ Sheets API   │
│  Snov.io       │             │  15 Relational │              │ Docs API     │
│  Mock Provider │             │     Models     │              │ Gmail API    │
└────────────────┘             └────────────────┘              └──────────────┘
```

---

## 2. Key Features

### 🔍 Multi-Provider Waterfall Contact Discovery
- **Free-First, Quality-Aware Strategy:**
  1. **Stage A:** Resolves company names and normalizes canonical domains (strips protocols, subpaths, legal entity suffixes).
  2. **Stage B:** Discovers target profiles via **Apollo People API Search** (0 export credits consumed).
  3. **Stage C:** Conditionally enriches profiles via **Apollo Bulk Match** (if within budget) or falls back to **Hunter.io Domain Search & Email Finder**.
  4. **Stage D:** Optional user-enabled **Snov.io** OAuth 2.0 domain search.
  5. **Stage E:** Multi-stage email verification, deduplication, and provenance preservation.
- **Budget & Credit Protection:** Pre-flight cost estimation, hard spending caps per provider, and zero-spend free mode.
- **Persistent Job Model:** Real-time progress updates per company (`waiting` ➔ `resolving_company` ➔ `searching_contacts` ➔ `finding_emails` ➔ `verifying` ➔ `completed`).

### 🧭 Public Job Opening Discovery
- Searches configured Greenhouse and Lever public job boards without API credentials, then uses a bounded official-company-careers-page fallback.
- Requires an explicit `JOB_BOARD_REGISTRY` mapping for hosted boards; company names/domains are never used to guess a platform or board identifier.
- Filters postings deterministically by selected roles and locations, and persists normalized fields, original titles/descriptions/URLs, source provenance, external IDs, and first/last-seen/check timestamps.
- Shows matched postings and original links in run progress. Job discovery never creates a contact or guesses an email address; contact discovery remains a separate stage.
- The official-site fallback checks `robots.txt` (including `Crawl-delay`), uses HTTPS on the supplied company domain, rate-limits requests per host, and does not scrape LinkedIn.

### 📊 Deduplicated Contact Management Table
- Comprehensive filtering by company, role, provider source, email verification status, and outreach state.
- **Honest Verification Categorization:** `verified`, `unverified`, `accept_all`, `unknown`, `invalid`, `unavailable`. (Does not collapse into misleading binary labels).
- Full source evidence inspection drawer showing raw extracted URLs, confidence scores, and provider provenance.
- Bulk selection, CSV export, and suppression controls.

### 📄 Google Docs & Sheets Mail Merge Preparation
- Server-side **OAuth 2.0 flow** with CSRF state verification and AES-256-GCM token encryption at rest.
- **Automated Google Spreadsheet Creation:** Formats header row, freezes row 1, sets background styling, and enables basic filters.
- **Automated Google Docs Template:** Inserts user draft with supported merge tags: `{{FirstName}}`, `{{LastName}}`, `{{FullName}}`, `{{Company}}`, `{{JobTitle}}`, `{{Role}}`, `{{JobURL}}`.
- Direct one-click links to created Google Drive files.

### ✉️ Mailmeteor & Google Docs Add-on Workflow
- Formats Google Sheet columns and Google Doc tags specifically for standard Mailmeteor merge fields.
- Provides step-by-step in-app guidance for launching the Mailmeteor add-on inside Google Docs (`Extensions > Mailmeteor > New campaign`).
- Prevents file duplication by reusing campaign artifacts unless intentionally regenerated.

### 🚀 Native Gmail Direct Sending Fallback
- No add-on required: Create personalized **Gmail drafts** or dispatch discrete individual messages directly via the Gmail API.
- **Zero Mass-To / BCC:** Every message is delivered as a discrete individual email.
- **Safety First:**
  - Conservative configurable daily sending cap (default 30 emails/day).
  - Pre-flight rendered preview inspector for every recipient.
  - Automatic suppression check (bounced, opted-out, or unsubscribed addresses).
  - Explicit final confirmation modal before dispatching.
  - Idempotency keys (`idempotencyKey`) prevent sending twice to the same contact.

---

## 3. Quick Start & Local Development

### Prerequisites
- **Node.js** >= 18 (Tested on Node.js v24)
- **npm** >= 9

### Installation
Clone the repository and install all dependencies:
```bash
# Clone repository
git clone <repo-url>
cd Referral_Engine

# Install root, server, and client dependencies
npm install
```

### Public Job Board Configuration

Greenhouse and Lever board identifiers must be confirmed from a company's own careers page or supplied by an administrator. Configure only confirmed mappings in the backend environment:

```ini
JOB_BOARD_REGISTRY=[{"domain":"company.example","provider":"greenhouse","board":"confirmed-board-token"},{"domain":"another.example","provider":"lever","board":"confirmed-site-name"}]
```

This is optional and requires no credentials. An absent mapping does not disable official careers-page fallback. Unknown/unsupported sources are reported as such rather than treated as an empty successful search.

### Manual live-source smoke test

1. Confirm a real employer's Greenhouse board token or Lever site name from its official careers page; do not guess it. Set the corresponding `JOB_BOARD_REGISTRY` entry and restart the backend.
2. Start a discovery run in the UI for that employer, select a role and location known to be in a current posting, and provide the official company domain if it is not in the curated company list.
3. Open run progress. Confirm the matched posting title/location, source provider, original link, and timestamps; open the link and confirm it is still live.
4. Repeat the same search. The posting should update in place rather than create a duplicate. Check that contact results remain separate and that no email is inferred from the posting.
5. For a company without a configured hosted board, test the official careers page fallback and verify its `robots.txt` policy permits the page.

Automated tests mock all network responses. The smoke test above is the separate, manual live-provider validation step.

### Environment Setup
Copy the sample environment file and configure your keys:
```bash
cp .env.example server/.env
```

Edit `server/.env` with your settings:
```ini
PORT=5000
NODE_ENV=development
CLIENT_ORIGIN=http://localhost:5173
DATABASE_URL="file:./dev.db"
ENCRYPTION_SECRET=your_32_byte_secret_hex_key

# Google Cloud OAuth 2.0 Credentials
GOOGLE_CLIENT_ID=your_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_secret
GOOGLE_REDIRECT_URI=http://localhost:5000/api/google/oauth2callback

# Provider Credentials (can also be entered via the UI Settings tab)
APOLLO_API_KEY=
HUNTER_API_KEY=
SNOV_CLIENT_ID=
SNOV_CLIENT_SECRET=

# Sending Cap (Personal Outreach Safety)
DAILY_GMAIL_SEND_CAP=30
```

### Database Initialization
The project uses SQLite out-of-the-box (zero external database setup required):
```bash
npm --prefix server run db:generate
npm --prefix server run db:push
```

### Running the Application Locally
Run backend and frontend servers in separate terminals (or concurrently):
```bash
# Terminal 1: Backend API (port 5000)
npm run dev:server

# Terminal 2: Frontend Client (port 5173)
npm run dev:client
```
Open your browser at: `http://localhost:5173`

---

## 4. Google Cloud Setup Guide

To connect your personal Google account for Google Sheets, Google Docs, and Gmail:

1. Visit the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project: `Referral-Engine-Outreach`.
3. Enable the following APIs under **APIs & Services > Library**:
   - **Google Sheets API**
   - **Google Docs API**
   - **Google Drive API**
   - **Gmail API**
4. Configure the **OAuth Consent Screen**:
   - User Type: **External**
   - App Name: `Referral Engine`
   - Scopes:
     - `https://www.googleapis.com/auth/spreadsheets`
     - `https://www.googleapis.com/auth/documents`
     - `https://www.googleapis.com/auth/drive.file`
     - `https://www.googleapis.com/auth/gmail.compose`
     - `openid`, `email`, `profile`
   - Test Users: Add your personal Google email address (allows testing without Google app verification).
5. Create OAuth Credentials:
   - Go to **APIs & Services > Credentials > Create Credentials > OAuth client ID**.
   - Application type: **Web application**.
   - Name: `Referral Engine Web Client`.
   - Authorized redirect URIs: `http://localhost:5000/api/google/oauth2callback`.
6. Copy the Client ID and Client Secret into your `server/.env` file.
7. Open the application, go to **Settings**, and click **Connect Google Account**.

---

## 5. Testing & Quality Assurance

The application includes unit tests, provider contract tests, and end-to-end workflow tests using Vitest:

```bash
# Run the complete automated test suite
npm test
```

### Test Coverage Highlights:
- **Unit Tests:** Domain canonicalization, company suffix removal, target role matching algorithms, template variable substitution, credit budget calculators, suppression checks.
- **Provider Contract Tests:** Verified request/response contracts for Apollo, Hunter, Snov, and Mock providers.
- **End-to-End Waterfall Tests:** Exercises the multi-company discovery journey, waterfall fallback, deduplication, and database persistence.
- **Google Integration Tests:** Verified spreadsheet generation, formatting, template merge variables, and native Gmail draft creation with idempotency guards.

### Production Build Validation:
```bash
# Compile server and bundle client
npm run build
```

---

## 6. Provider Matrix & Integration Specifications

For detailed documentation of endpoint URLs, rate limits, credit consumption economics, and error recovery strategies, see:
[`docs/integrations/PROVIDER_MATRIX.md`](file:///c:/Users/HP/Referral_Engine/docs/integrations/PROVIDER_MATRIX.md)

---

## 7. Security & Responsible Outreach

1. **Secret Storage:** All provider API keys and Google OAuth refresh tokens are stored encrypted at rest using AES-256-GCM.
2. **Least Privilege Scopes:** Google Drive access uses `drive.file` scope, strictly limiting file access to documents created by this application.
3. **No Indiscriminate Mass Emailing:** Every email is created as a single recipient message, with conservative daily sending caps and pre-flight rendered previews.
4. **Idempotency Protection:** Unique SHA-256 idempotency keys prevent double-sending to the same contact across retries or network timeouts.
5. **Suppression Enforcement:** Automatic exclusion of previously bounced, opted-out, or unsubscribed email addresses.
