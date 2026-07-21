# Publish Job Compass with GitHub Desktop and Cloudflare

Job Compass is a full-stack application. Deploy it as a **Cloudflare Worker with static assets**, not as a static Pages site. The interface and `/api/scan` endpoint will then share one domain.

## 1. Publish the repository with GitHub Desktop

1. Extract `job-compass-github-ready.zip` to a permanent folder on your computer.
2. Open GitHub Desktop and sign in to GitHub.
3. Select **File > Add local repository**.
4. Choose the extracted Job Compass folder.
5. If GitHub Desktop says the folder is not a Git repository, select **create a repository** for that folder.
6. Open the **Changes** tab. Confirm that `node_modules`, `dist`, and `.wrangler` are not listed; the included `.gitignore` excludes them.
7. Enter `Initial Job Compass application` in the Summary box.
8. Select **Commit to main**.
9. Select **Publish repository**.
10. Use the repository name `job-compass`. Add a description if desired.
11. Leave **Keep this code private** selected for a private repository, or clear it for a public repository.
12. Select your personal account or organization, then select **Publish repository**.

For later changes: review the Changes tab, enter a summary, select **Commit to main**, then select **Push origin**. Every push to `main` will trigger Cloudflare after the integration below is connected.

## 2. Connect the GitHub repository to Cloudflare

1. Sign in to the Cloudflare dashboard.
2. Open **Workers & Pages**.
3. Choose **Create application**, then choose the option to import/connect a Git repository for a Worker.
4. Authorize Cloudflare to access GitHub. For a private repository, grant access to `job-compass` when GitHub asks.
5. Select the `job-compass` repository.
6. Use these settings exactly:

| Setting | Value |
|---|---|
| Worker/project name | `job-compass` |
| Production branch | `main` |
| Root directory | `/` or leave blank |
| Build command | `pnpm run build` |
| Deploy command | `pnpm exec wrangler deploy --config dist/server/wrangler.json` |
| Non-production deploy command | `pnpm exec wrangler versions upload --config dist/server/wrangler.json` |
| Build caching | Enabled |

7. In **Build variables and secrets**, add `NODE_VERSION` with the value `22.13.0`. It is a normal build variable, not a secret.
8. No runtime variables or secrets are required for the first version.
9. Save and deploy. Cloudflare will install dependencies, run the build, and deploy the generated Worker configuration.

The Worker name must remain `job-compass`, because the generated Wrangler configuration uses that name.

## 3. Verify the deployment

1. Open the assigned `https://job-compass.<your-subdomain>.workers.dev` address.
2. Confirm the sample jobs appear.
3. Paste one public Greenhouse, Ashby, Lever, or SmartRecruiters company board URL.
4. Select **Scan job pages**.
5. Confirm returned jobs open their original source URLs.
6. Add a note and select **Export as CSV**.
7. Test the page on a phone-sized browser window.

LinkedIn search URLs are intentionally skipped and reported as warnings. Protected pages may also return warnings; the app does not attempt to bypass access controls.

## 4. Add a custom domain (optional)

1. Open the `job-compass` Worker in Cloudflare.
2. Open **Settings > Domains & Routes**.
3. Select **Add > Custom Domain**.
4. Enter a hostname such as `jobs.example.com`.
5. Follow Cloudflare's DNS prompts. A domain already using Cloudflare DNS is the simplest setup.
6. After the certificate becomes active, use the custom address as the public URL.

## 5. Normal update workflow

1. Make or receive updated project files.
2. Open GitHub Desktop and select the `job-compass` repository.
3. Review the changed files.
4. Enter a clear commit summary.
5. Select **Commit to main**.
6. Select **Push origin**.
7. Watch the new build under Cloudflare's Worker deployment/build history.

For risky changes, create a branch in GitHub Desktop and push it. The non-production deploy command creates a Cloudflare preview version without replacing production.

## Troubleshooting

- **Worker name mismatch:** The Cloudflare Worker/project name must be `job-compass`.
- **Missing entry point:** Confirm the build succeeded and the deploy command includes `--config dist/server/wrangler.json`.
- **Wrong Node version:** Confirm the build variable `NODE_VERSION=22.13.0` exists.
- **Dependency install failure:** Confirm `pnpm-lock.yaml` and `pnpm-workspace.yaml` are committed and the build uses pnpm.
- **The page loads but scanning fails:** Confirm this was deployed as a Worker, not as a static Pages site.
- **One source fails:** The source may block automated requests or require JavaScript/login. Try its public ATS board URL instead of its marketing careers page.
- **LinkedIn returns no results:** This is expected. Add public job links manually or use an approved LinkedIn data source later.
- **A company site returns too few jobs:** Add its sitemap/ATS board as a source. Sitemap-first discovery and recurring change detection are planned ingestion upgrades.
