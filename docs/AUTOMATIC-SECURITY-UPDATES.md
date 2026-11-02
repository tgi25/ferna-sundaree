# Automatic weekly security updates

Chrome gets a security update about once a week. Ferna Sundaree's Chromium engine is part of its
Electron runtime, so those fixes arrive as Electron patch releases. The workflow
`.github/workflows/chromium-patches.yml` turns each one into a Ferna Sundaree release without manual work:

1. **Thursdays 03:17 UTC** (08:47 in Sri Lanka) it checks whether Electron has a newer patch of the
   major version in `package.json` (`tools/electron-patch.js`).
2. If so, it pins that patch, bumps the app's patch version (0.6.2 → 0.6.3), commits to a branch
   `auto/security-<version>` and runs the normal release workflow on it: audit, unit tests, end-to-end
   tests with the sandbox on, Windows and Linux builds, smoke tests.
3. It signs `update.json` with `UPDATE_SIGNING_KEY`, publishes the GitHub release and, if configured,
   copies everything to the update mirror.
4. It moves the default branch to the released commit (or opens a pull request if the branch moved).
5. Installed copies find the update within 6 hours and install it after checking the signature and
   checksums.

If anything fails, nothing is published and an issue is opened (GitHub also e-mails you).
A new Electron **major** version (about every 8 weeks) is never adopted automatically: the workflow
opens an issue so the upgrade can be tested and released by hand (`npm i -D -E electron@<major>`, test, tag).

## One-time setup

### 1. Choose how releases are published

Settings → Secrets and variables → Actions → **Variables** → New repository variable:

| Name | Value | Effect |
|---|---|---|
| `PATCH_RELEASE_MODE` | `approve` (default if unset) | Everything is built and tested, then GitHub e-mails you: open the run and press **Review deployments → Approve and deploy**. |
| | `auto` | Publishes as soon as all tests pass. |

For `approve`: Settings → **Environments** → New environment `release-approval` → tick **Required
reviewers** and add yourself → Save. (Free for public repositories.) The workflow refuses to run in
approve mode if this environment has no required reviewer, so nothing goes out unreviewed by mistake.
For `auto`, no environment set-up is needed (`auto-release` is created on first use).

### 2. Keep the signing key where it is

`UPDATE_SIGNING_KEY` stays a repository secret (already set). The workflow never prints it.

### 3. Optional: an update mirror outside GitHub

Installed copies ask every update source at once and take the newest validly signed release, so a
mirror keeps updates flowing if GitHub is down or blocked, and a stale or tampered mirror can never
hold an update back or slip one in. Any S3-compatible storage works; Cloudflare R2 is a good free choice
(10 GB storage, no download charges).

1. Cloudflare dashboard → R2 → **Create bucket** (for example `ferna-updates`).
2. Bucket → Settings → **Public access**: connect a custom domain (recommended, e.g.
   `updates.yourdomain`) or enable the `r2.dev` address (fine for testing; rate-limited).
3. R2 → **Manage API tokens** → Create token with *Object Read & Write* for this bucket. Note the
   Access Key ID, Secret Access Key and the S3 endpoint `https://<account-id>.r2.cloudflarestorage.com`.
4. GitHub → Settings → Secrets and variables → Actions → **Secrets**:
   `MIRROR_S3_BUCKET` (bucket name), `MIRROR_S3_KEY_ID`, `MIRROR_S3_SECRET`, `MIRROR_S3_ENDPOINT`.
5. **Variables**: `UPDATE_MIRROR_URLS` = the public folder, e.g.
   `https://updates.yourdomain/ferna-sundaree/latest/` (several, comma-separated, are allowed).
   This address is built into each release, so copies installed from that release onwards also check
   the mirror.

The release job uploads to `ferna-sundaree/v<version>/` and `ferna-sundaree/latest/` (installers first,
the signed manifest last) and keeps the newest three versions.

### 4. Organisations: their own update server

Copy `update.json`, `update.json.sig` and the installers of a release into a folder on an internal HTTPS
server and set the policy **UpdateMirror** to its address (Group Policy on Windows, a JSON policy file on
Linux). Copies then update only from there, still only with Ferna-signed releases.

## Running it by hand

Actions → *Weekly Chromium security update* → **Run workflow**. Tick *force* to build a patch release
even when Electron has no new patch (for example to ship a fix of your own on the same schedule).
