# Sermon Manager

A self-hosted sermon management application deployed on Vercel that allows a church pastor to upload sermons via a simple web form. The application automatically:

1. Stores audio files in Cloudflare R2
2. Generates a podcast-spec RSS feed that Spotify, Apple Podcasts, and other platforms consume
3. Displays sermons on the church's Squarespace website via an embeddable player

## Tech Stack

- **Language:** TypeScript
- **Frontend:** Static HTML + TypeScript (compiled with `tsc`)
- **Backend:** Vercel serverless functions (API routes)
- **Audio Storage:** Cloudflare R2 (S3-compatible)
- **Metadata Storage:** A `sermons.json` file stored in R2
- **Deployment:** Vercel (free tier)

## Project Structure

```
sermon-manager/
├── public/                     # Static frontend
│   ├── index.html              # Upload form page
│   ├── sermons.html            # Public sermon listing
│   ├── embed.html              # Embeddable player
│   ├── css/styles.css
│   └── js/                     # Compiled JS output
├── src/                        # Frontend TypeScript source
│   ├── upload.ts
│   ├── sermons.ts
│   └── embed.ts
├── api/                        # Vercel serverless functions
│   ├── upload.ts
│   ├── feed.ts
│   ├── sermons.ts
│   └── delete.ts
├── lib/                        # Shared server-side utilities
│   ├── r2.ts
│   ├── rss.ts
│   ├── auth.ts
│   └── types.ts
├── package.json
├── tsconfig.json
├── tsconfig.api.json
└── vercel.json
```

## Setup Instructions

### 1. Cloudflare R2 Setup

1. Create a Cloudflare account (free) at https://cloudflare.com
2. Go to **R2** in the Cloudflare dashboard
3. Create a bucket named `sermons`
4. Enable **Public Access** on the bucket (this generates a `pub-xxx.r2.dev` URL)
5. Go to **Manage R2 API Tokens** and create a new API token with:
   - **Permission:** Read & Write
   - **TTL:** No expiration (or set as needed)
6. Copy the **Access Key ID** and **Secret Access Key**
7. Copy your **Account ID** from the R2 overview page
8. Upload a podcast cover image to your bucket as `cover.jpg`:
   - Must be square, at least 1400x1400px, max 3000x3000px (Apple Podcast requirement)

### 2. Initialize Sermons Data

Upload an empty `sermons.json` file to your R2 bucket with the following content:

```json
{ "sermons": [] }
```

Create a `podcastMeta.json` file in your R2 bucket with your church's information:

```json
{
  "title": "Your Church Name Sermons",
  "description": "Weekly sermons from Your Church Name",
  "link": "https://yourchurch.com",
  "language": "en",
  "author": "Your Church Name",
  "email": "pastor@yourchurch.com",
  "imageUrl": "https://pub-xxx.r2.dev/cover.jpg",
  "category": "Religion & Spirituality",
  "subcategory": "Christianity"
}
```

### 3. Environment Variables

Copy `.env.example` to `.env.local` for local development, then replace every
placeholder. Set the same values in Vercel's project settings. Do not commit
`.env.local` or put real credentials in `.env.example`.

```
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET_NAME=sermons
R2_PUBLIC_URL=https://pub-xxxx.r2.dev
ADMIN_PASSWORD=choose_a_strong_password_here
ADMIN_SESSION_SECRET=choose_a_different_random_string_here
```

Use independent strong values for `ADMIN_PASSWORD` and
`ADMIN_SESSION_SECRET`. The latter signs session cookies and should not be the
administrator password.

### 4. Installation & Build

```bash
# Install dependencies
bun install

# Compile TypeScript to JavaScript
bun run build
```

### 5. Local Development

```bash
# Install Vercel CLI if you haven't already
bun install -g vercel

# Run locally
vercel dev
```

### Codex Cloud Development

The repository includes an `AGENTS.md` with the project layout, commands,
coding conventions, and security guidance that Codex automatically uses while
working in this repository. The lockfile and `packageManager` field identify Bun
as the package manager.

Create a Codex Cloud environment for this repository with the following setup
script:

```bash
bun install --frozen-lockfile
```

No application secrets are needed to compile the project or run the automated
tests; the tests mock R2. Leave production credentials out of routine Codex
tasks. If a task explicitly requires live R2 or Vercel access, add only the
variables from `.env.example` as encrypted environment secrets in the Codex
Cloud environment. Never paste secret values into a prompt or commit them.

Use this command as the environment's validation command, or ask Codex to run it
after making changes:

```bash
bun run check
```

It compiles both the frontend and API TypeScript configurations before running
the test suite. For browser testing, `bunx vercel dev` starts the application
locally; live API requests require the applicable environment variables.

#### Production deployment from Codex Cloud

Do not put deployment in the Codex setup script: setup runs while preparing the
environment, not when a reviewed change is ready for release. This repository
has no staging environment, so every deployment command below immediately
updates the production website. Codex should deploy only when you explicitly
ask it to do so.

The existing `bun run deploy` command remains appropriate on a linked local
checkout where `vercel login` has already authenticated the CLI. Bun resolves
the project-local Vercel executable used by the package script, so `bunx` is not
needed.

For an unattended Codex Cloud deployment, add these values to the Codex Cloud
environment rather than committing `.vercel/project.json` or credentials:

- `VERCEL_TOKEN` — an access token for the Vercel account that owns the project.
- `VERCEL_ORG_ID` — the team or user ID recorded by `vercel link`.
- `VERCEL_PROJECT_ID` — the project ID recorded by `vercel link`.

Keep `VERCEL_TOKEN` as an encrypted secret. The two IDs can be regular
environment variables. The task environment must also allow outbound network
access to Vercel. After the change has been reviewed and you have explicitly
requested a production release, Codex can run:

```bash
bun run deploy:cloud
```

The cloud-specific script supplies the token and accepts Vercel's setup prompts
non-interactively. `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` identify the existing
project, preventing the unattended command from creating or selecting a
different project.

### 6. Deployment

```bash
# Deploy to Vercel
vercel --prod
```

Or connect your GitHub repository to Vercel for automatic deployments on push.

## Usage

### Uploading Sermons

1. Visit `https://your-app.vercel.app/index.html`
2. Enter the admin password (same as `ADMIN_PASSWORD` env var)
3. Fill in the sermon details and upload an MP3 file
4. The audio duration is automatically calculated client-side

Note: uploads are performed directly from the browser to Cloudflare R2 using a presigned URL. This avoids Vercel request body limits on the Hobby plan.

#### Cloudflare R2 CORS

Because the browser uploads directly to R2, you must allow CORS on your R2 bucket for your site origin.

In Cloudflare Dashboard -> R2 -> your bucket -> CORS, add a rule similar to:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "https://your-app.vercel.app"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

### Viewing and Editing Sermons

After logging in, open **View Sermons** to see all sermons with audio players.

Click **Edit**, to the left of **Delete**, to open a form populated with the stored title, speaker, date, description, tags, duration, and current audio. Change the fields and click **Save Changes**, or **Cancel** to discard edits. Editing is only available on this page; the latest sermon on the upload page has no editing controls.

Audio replacement is optional. Choose an MP3 of up to 200MB to replace it; its duration is calculated automatically and the file uploads directly to R2. The sermon keeps its existing ID and creation date. Previous audio files remain available for podcast clients with cached feed URLs.

Saved edits update `sermons.json`, which is used to generate the RSS feed. Cached feeds and podcast apps may take time to refresh.

Overlapping saves are protected by R2 conditional writes. If another upload, edit, or deletion changes the list while your request is saving, it returns a conflict; retry the save. An edit form left open while someone else edits the same sermon still contains its original field values, so reopen it to pick up those changes before editing.

### Podcast RSS Feed

The RSS feed is available at:

```
https://your-app.vercel.app/api/feed
```

Submit this URL to:

- Apple Podcasts: https://podcastsconnect.apple.com
- Spotify: https://podcasters.spotify.com
- Google Podcasts

### Embedding in Squarespace

Add an **Embed Block** to your Squarespace page with this code:

```html
<iframe
  src="https://your-app.vercel.app/embed.html?limit=5"
  width="100%"
  height="600"
  frameborder="0"
  style="border:none;"
>
</iframe>
```

The `limit` parameter controls how many sermons to display (default is 5).

## API Endpoints

### POST /api/login

- Authenticates an admin password and sets an HTTP-only session cookie
- JSON body: `{ "password": "..." }`
- On success: returns `{ ok: true }`

### POST /api/logout

- Clears the HTTP-only session cookie
- Returns `{ ok: true }`

### POST /api/upload-url

- Returns a presigned URL for directly uploading audio to R2
- Requires a valid admin session cookie (set by `POST /api/login`)
- JSON body fields: `title`, `description`, `speaker`, `date`, `durationSeconds`, `contentType`, `fileSize`

### POST /api/upload-complete

- Finalizes an upload by saving sermon metadata to `sermons.json`
- Requires a valid admin session cookie (set by `POST /api/login`)
- JSON body fields: `id`, `title`, `description`, `speaker`, `date`, `durationSeconds`, `audioUrl`, `audioFileSize`

### POST /api/upload (legacy)

- Legacy multipart upload endpoint (kept for compatibility)
- Requires a valid admin session cookie (set by `POST /api/login`)
- Form data fields: `title`, `description`, `speaker`, `date`, `audio` (MP3 file), `durationSeconds`

### GET /api/feed

- Returns podcast RSS feed
- Public endpoint, no authentication required

### GET /api/sermons

- Returns list of sermons as JSON
- Query params: `?page=N&limit=M` for pagination
- Public endpoint, no authentication required

### PUT /api/update

- Updates an existing sermon without creating a new episode
- Requires a valid admin session cookie (set by `POST /api/login`)
- JSON fields: `id`, `title`, `description`, `speaker`, `date`, `durationSeconds`, `keywords` (array; use `[]` to clear tags)
- Optional replacement fields: `audioUrl`, `audioFileSize`, supplied together after uploading through `/api/upload-url`; the API verifies the uploaded object
- Returns the updated sermon; unknown IDs return 404 and invalid fields return 400
- Returns 409 if the sermon list changes during the save, leaving the newer data intact

### DELETE /api/delete

- Delete a sermon by ID
- Requires a valid admin session cookie (set by `POST /api/login`)
- Request body: `{ "id": "sermon-uuid" }`

## Security Notes

- The `ADMIN_PASSWORD` is a simple shared secret. Keep it secure.
- The app uses an HTTP-only session cookie (not readable by JS) to avoid storing passwords in browser storage.
- Basic in-memory rate limiting is applied to failed auth attempts.
- Only authenticated requests can upload, edit, or delete sermons.
- File uploads are limited to 200MB.
- Only MP3 files are accepted.

## Development

The project uses:

- **TypeScript** for type safety
- **Vercel** for serverless hosting
- **Cloudflare R2** for object storage (S3-compatible)
- **Busboy** for multipart form parsing

To modify the frontend:

1. Edit files in `src/`
2. Run `bun run build` to compile to `public/js/`

To modify API routes:

1. Edit files in `api/` or `lib/`
2. Changes are automatically compiled by Vercel

Run `bun run test` to compile the API and run the update regression tests using Node's built-in test runner. These tests use mocked R2 storage and do not access production data.

## Future Enhancements

- YouTube video upload automation
- Sermon series and tags
- Search functionality
- Analytics dashboard

## License

MIT
