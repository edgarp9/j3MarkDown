# Third-Party License Compliance

This document is the canonical source for third-party dependency license compliance.

## Scope

- The required notice artifact is `THIRD-PARTY-NOTICES.txt` at the repository root.
- Runtime notices cover:
  - production frontend dependencies reported by `corepack pnpm licenses list --prod --json`
  - Rust runtime dependencies resolved for the Windows release target with `cargo metadata --locked --filter-platform x86_64-pc-windows-msvc`
- Development and build tooling licenses are reviewed separately when those tools are redistributed with source, build tooling, or release packages.

## Notice Artifact Rules

- Regenerate `THIRD-PARTY-NOTICES.txt` after any dependency or lockfile change.
- The notice artifact must include package names, versions, license expressions, package metadata when available, and package license or notice text when it can be read from the installed dependency.
- The app must expose `THIRD-PARTY-NOTICES.txt` through a modal UI reachable from the About flow.
- Release checks must fail when the generated notice artifact is stale.

## License Review Rules

- MIT, BSD, ISC, Zlib, Apache-2.0, Unicode-3.0, and similar notice-style licenses require preserving copyright, permission, warranty, attribution, and notice text.
- Dual-licensed dependencies may be handled under the more practical compatible option unless the package metadata or package notice text says otherwise.
- MPL-2.0 dependencies require recipients to be informed where the MPL-covered source code is available.
- If an MPL-covered dependency file is modified, the modified MPL-covered source file must remain available under MPL-2.0 terms.
- New dependencies with GPL, AGPL, LGPL, custom, unknown, or missing license metadata require explicit review before release.

## Required Commands

- Update notices: `corepack pnpm licenses:generate`
- Verify notices: `corepack pnpm licenses:check`
- General project check must include the license check.
