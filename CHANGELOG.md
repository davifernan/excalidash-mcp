# Changelog

All notable changes to this project are documented here.

## 1.0.0 - 2026-08-20

- Publish the server as an `npx`-ready CLI with explicit Node.js 22 support.
- Add an explicit Chromium setup command and actionable startup preflight.
- Keep Chromium's process sandbox enabled by default; unsafe opt-out requires an environment variable and emits a warning.
- Bundle Excalidraw 0.18.1 and all of its fonts locally so conversion and PNG export do not execute CDN code or require network access.
- Restrict the npm package to runtime source and generated converter assets.
- Audit the complete dependency tree and pin patched transitive build dependencies.
- Add release automation with npm provenance, a clean tarball installation smoke test, and
  package-content checks.
- Document first-release token permissions and the immediate migration to npm Trusted Publishing.
