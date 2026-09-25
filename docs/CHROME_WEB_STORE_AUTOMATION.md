# GitHub → Chrome Web Store updates

The release workflow can build Clipstar, attach its ZIP and checksum to a GitHub release, and submit the same ZIP to the existing Chrome Web Store listing. Google still reviews the update; an accepted submission is not an immediate public release.

Ordinary pushes to `main` do not publish. Pushing a version tag such as `v1.2.1` submits an update only when the repository variable `CWS_PUBLISH_ENABLED` is exactly `true`. Manually running the workflow on `main` checks the connection without uploading or publishing anything.

## One-time setup

The workflow files alone do not connect the accounts. Complete the Google authorization below, then test it before enabling publishing. No service-account JSON key, personal GitHub token, or Google password belongs in this repository.

### 1. Choose a Google Cloud project

Open [Google Cloud Console](https://console.cloud.google.com/) with the account you intend to use. If first-time setup asks you to accept Google Cloud terms, review and accept those yourself. Create or select a project dedicated to Clipstar publishing. If Google asks for billing setup, review that separately before proceeding.

Open **Cloud Shell** in that project; it already has `gcloud` installed. You need permission to enable APIs, create a service account and identity pool, and edit the service account's IAM policy. Do not give the publishing service account an Owner or Editor role.

Replace the example project ID below with your actual project ID, then run the commands in this section in the same Cloud Shell session. Stop on any error rather than skipping a failed step.

```sh
CLIPSTAR_PROJECT_ID="replace-with-your-project-id"
CLIPSTAR_SERVICE_ACCOUNT="clipstar-publisher@${CLIPSTAR_PROJECT_ID}.iam.gserviceaccount.com"

gcloud services enable \
  chromewebstore.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  cloudresourcemanager.googleapis.com \
  --project="$CLIPSTAR_PROJECT_ID"

CLIPSTAR_PROJECT_NUMBER="$(gcloud projects describe "$CLIPSTAR_PROJECT_ID" --format='value(projectNumber)')"
CLIPSTAR_POOL="projects/${CLIPSTAR_PROJECT_NUMBER}/locations/global/workloadIdentityPools/clipstar-github"

gcloud iam service-accounts create clipstar-publisher \
  --project="$CLIPSTAR_PROJECT_ID" \
  --display-name="Clipstar Chrome Web Store publisher"
```

The APIs and service account support the keyless authentication described in [Google's deployment-pipeline guide](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines). The [API-enablement command reference](https://docs.cloud.google.com/sdk/gcloud/reference/services/enable) describes the required permissions.

### 2. Trust only Clipstar's release workflow

Create a dedicated pool and provider. Keep this pool exclusive to this connection. The condition below checks the immutable GitHub repository and owner IDs, the exact workflow path, and the permitted event/ref pair. Pull requests and other workflows cannot use this connection.

```sh
gcloud iam workload-identity-pools create clipstar-github \
  --project="$CLIPSTAR_PROJECT_ID" \
  --location=global \
  --display-name="Clipstar GitHub releases"

CLIPSTAR_ATTRIBUTE_CONDITION="attribute.repository_id == '1334799288' && attribute.repository_owner_id == '286188215' && attribute.workflow_ref == 'lchavess1024/Clipstar/.github/workflows/release.yml@' + attribute.ref && ((attribute.event_name == 'workflow_dispatch' && attribute.ref == 'refs/heads/main') || (attribute.event_name == 'push' && attribute.ref.startsWith('refs/tags/v')))"

gcloud iam workload-identity-pools providers create-oidc clipstar-release \
  --project="$CLIPSTAR_PROJECT_ID" \
  --location=global \
  --workload-identity-pool=clipstar-github \
  --display-name="Clipstar release workflow" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.workflow_ref=assertion.workflow_ref,attribute.ref=assertion.ref,attribute.event_name=assertion.event_name" \
  --attribute-condition="$CLIPSTAR_ATTRIBUTE_CONDITION"

gcloud iam service-accounts add-iam-policy-binding "$CLIPSTAR_SERVICE_ACCOUNT" \
  --project="$CLIPSTAR_PROJECT_ID" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/${CLIPSTAR_POOL}/attribute.repository_id/1334799288"
```

This grants the narrowly filtered GitHub identity permission to obtain short-lived tokens for the service account. It does not require a downloaded key or domain-wide delegation. See the [provider command reference](https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/providers/create-oidc), [IAM-binding command reference](https://docs.cloud.google.com/sdk/gcloud/reference/iam/service-accounts/add-iam-policy-binding), and [Google authentication action](https://github.com/google-github-actions/auth#workload-identity-federation-through-a-service-account).

Protect write access to this repository and its release workflow. Anyone who can change trusted release code and push allowed tags can potentially exercise this publishing authority. If the repository is renamed or moved, review the trust condition; do not simply remove its checks.

### 3. Authorize the service account in Chrome Web Store

Print the service account email:

```sh
printf '%s\n' "$CLIPSTAR_SERVICE_ACCOUNT"
```

In the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), open **Publisher → Settings → Service account** and add that email. Confirm the account is the intended publisher before saving. Google's documentation may call this the Account section.

This is a security-sensitive authorization: Chrome Web Store grants the service account access to **all items owned by that publisher**, not only Clipstar. Google currently permits one service account per publisher; do not replace an existing one without checking what uses it. The workflow itself targets only these fixed IDs:

| Target | ID |
| --- | --- |
| Publisher | `bad675f9-6a41-4b7c-849f-7e15fba1be63` |
| Clipstar extension | `hbgkgbmefkghajcmngcichciohckbkgj` |

This authorization must be knowingly approved by the publisher account owner. [Google's service-account instructions](https://developer.chrome.com/docs/webstore/service-accounts) describe its scope.

### 4. Add GitHub repository variables

Get the provider resource name:

```sh
gcloud iam workload-identity-pools providers describe clipstar-release \
  --project="$CLIPSTAR_PROJECT_ID" \
  --location=global \
  --workload-identity-pool=clipstar-github \
  --format='value(name)'
```

In [Clipstar's Actions variables](https://github.com/lchavess1024/Clipstar/settings/variables/actions), add these **repository variables**, not secrets:

| Name | Value |
| --- | --- |
| `CWS_WORKLOAD_IDENTITY_PROVIDER` | The full provider name printed above, beginning `projects/` |
| `CWS_SERVICE_ACCOUNT` | The service account email printed in step 3 |
| `CWS_PUBLISH_ENABLED` | `false` during setup |

The provider path uses the numeric Google Cloud project number. These identifiers are not passwords. The workflow requests a short-lived token scoped to `https://www.googleapis.com/auth/chromewebstore`; do not copy tokens into variables, logs, issues, or commits.

### 5. Test without releasing

1. Review the local changes in VS Code, stage only the intended automation changes, and commit them with your GitHub-linked author email. Keep unrelated local screenshots/assets out of that commit unless you intend to publish them.
2. Push that commit to `main`. The workflow must exist on GitHub's default branch before its manual button appears.
3. Allow several minutes for Google's new IAM configuration to propagate.
4. Open **Actions → Release → Run workflow**, choose `main`, and run it. This manual path checks authentication and reads the existing item's status. It never uploads a ZIP or submits a release.
5. Confirm the connection check succeeds for the correct item. Only then change `CWS_PUBLISH_ENABLED` to `true` when you are ready to allow future version-tag releases.

If the test fails, keep publishing disabled. Check the provider path, service account email, publisher linkage, enabled APIs, and the exact repository/workflow/ref condition. Do not widen the trust condition merely to suppress an error.

## Publish a future update

There is no need to bump or re-submit the currently live `1.2.0` just to set up automation.

1. Make and test the intended extension changes. Complete [the release checklist](RELEASE_CHECKLIST.md), including the manual Chrome smoke test and disclosure review.
2. Choose a version greater than the version already uploaded to Chrome Web Store. Set the same version in `extension/manifest.json`, `package.json`, and both version fields in `package-lock.json` (the top-level field and `packages[""].version`).
3. Run `npm run verify`. Review and commit the release changes, then push the release commit to `main` and confirm CI succeeds.
4. Tag that exact commit and push only that tag. For example, if `1.2.1` is the new version and is not already used:

```sh
git push origin main
git tag -a v1.2.1 -m "Release Clipstar 1.2.1"
git push origin v1.2.1
```

The tag must match the package and manifest version. Do not reuse, force-move, or delete an already submitted release tag. With publishing enabled, the Release workflow verifies the package, creates the GitHub release, uploads the ZIP through Chrome Web Store API v2, and submits it for review. Publication follows Google's approval; users receive the update through Chrome's normal update process. [Google's API guide](https://developer.chrome.com/docs/webstore/using-api) explains the upload and review flow.

If publishing is disabled, a tag can still create the GitHub release, but it will not update Chrome Web Store. Creating a GitHub release manually is not a substitute for pushing the version tag used by this workflow.

## Pause or recover

- Set `CWS_PUBLISH_ENABLED` to `false` to stop future automatic store submissions. This does not cancel an already-running upload or a submission already with Google; inspect Actions and the store dashboard separately.
- If a run fails after contacting the store, inspect the item's draft/review state before retrying. Do not repeatedly push new tags while an update is pending review.
- Use the store dashboard to resolve review warnings, rejections, visibility changes, or listing/disclosure requirements. Automation does not bypass these requirements.
- For a suspected credential or repository compromise, disable the Google identity provider and remove the publisher's service-account link as appropriate; turning off the workflow variable alone does not revoke Google's authorization.

No Google Cloud resources, IAM grants, repository variables, or store authorization are created merely by committing these files. Until the one-time setup and successful connection test are complete, the integration is prepared but not connected.
