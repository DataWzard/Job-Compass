# Publish Job Compass on GitHub Pages

Job Compass uses only free services. GitHub Pages hosts the interface, and a scheduled GitHub Action refreshes the public job index from ATS feeds. There is no paid search API or visitor subscription.

1. Commit and push these changes with GitHub Desktop.
2. Open the `DataWzard/Job-Compass` repository on GitHub.
3. Select **Settings**, then **Pages**.
4. Under **Build and deployment**, select **Deploy from a branch**.
5. Choose branch **main** and folder **/docs**, then select **Save**.
6. Open **Actions**, select **Refresh public job index**, then choose **Run workflow** once to populate the first live index.
7. GitHub Pages will publish `https://datawzard.github.io/Job-Compass/`.

The refresh runs every eight hours. Add more supported ATS boards to `crawler/sources.json` as the discovery catalog grows.