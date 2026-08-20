# Releasing `excalidash-mcp`

Releases are built from a clean checkout, tested, packed once, and published from the exact tarball
that passed CI. Never publish from a developer workstation or from a directory with untracked files.

## First release only

npm cannot attach a trusted publisher to a package that does not exist yet. Bootstrap `v1.0.0` with
a short-lived granular access token:

1. Enable 2FA on the npm account.
2. Create a granular token named `excalidash-mcp bootstrap`.
3. Enable **Bypass two-factor authentication** so the non-interactive GitHub job can publish.
4. Set **Packages and scopes** to **Read and write** and **All packages**. The package cannot be
   selected individually before its first publication.
5. Give the token **No access** to organizations.
6. Use the shortest practical expiration. Do not add an IP allow-list for GitHub-hosted runners,
   whose outbound addresses are not stable.
7. Save the token as the GitHub Actions secret `NPM_TOKEN`.

Merge the release changes, confirm the `main` workflow is green, then create and push the matching
tag:

```bash
git tag -s v1.0.0 -m "excalidash-mcp v1.0.0"
git push origin v1.0.0
```

The workflow refuses a tag that does not match `package.json`, reruns all tests, rebuilds the local
converter, inspects and installs the tarball, and only then publishes it.

## Switch to trusted publishing immediately

After `v1.0.0` exists on npm, open the package settings and add a trusted publisher with:

- Provider: GitHub Actions
- Owner: `davifernan`
- Repository: `excalidash-mcp`
- Workflow: `release.yml`
- Environment: `npm`
- Allowed action: `npm publish`

Run the next release through the workflow. Once it succeeds through OIDC, delete the `NPM_TOKEN`
GitHub secret, remove the `NODE_AUTH_TOKEN` block from `release.yml`, revoke the granular token on
npm, and set the package's publishing access to require 2FA while disallowing tokens. Trusted
publishing continues to work because it does not use an npm access token.

## Later releases

Update the version and changelog in a pull request. After `main` is green, create a signed tag whose
name exactly matches the package version. For example, version `1.0.1` requires tag `v1.0.1`.

Use `@1` in MCP client configurations to receive compatible minor and patch releases automatically.
Pin an exact version only where reproducibility is more important than automatic updates.
