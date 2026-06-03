# README external badge URL pre-public audit — 2026-06-03

Scope: bounded slice of the final pre-public checklist item “README is updated and accurate.” This audit checked the external README badge/workflow URLs that can be validated before publication. It does not validate public rendering after the repository becomes public, nor does it prove CI passes.

## Environment

- Workspace: `/home/jtenner/Projects/jt-ide`
- Date: 2026-06-03
- OS: Linux `bf28335b6a4b` 6.12.90+deb13.1-amd64 on Debian 13
- Node: `v20.19.2`
- GitHub CLI: `gh version 2.46.0`
- Repository visibility observed by `gh repo view`: `PRIVATE`

## README external URLs checked

The README currently references these external URLs:

- `https://github.com/jtenner/metidos/actions/workflows/ci.yml`
- `https://github.com/jtenner/metidos/actions/workflows/ci.yml/badge.svg`
- `https://github.com/jtenner/metidos/actions/workflows/codeql.yml`
- `https://github.com/jtenner/metidos/actions/workflows/codeql.yml/badge.svg`
- `https://img.shields.io/badge/license-Apache--2.0-blue.svg`
- `https://img.shields.io/badge/status-pre--1.0-orange.svg`

The checked-in workflow files backing the GitHub links exist locally:

- `.github/workflows/ci.yml` with workflow name `CI`
- `.github/workflows/codeql.yml` with workflow name `CodeQL`

## Commands

```sh
grep -n 'https\?://' README.md

gh repo view jtenner/metidos --json nameWithOwner,visibility,url

node <<'NODE'
const urls = [
  'https://github.com/jtenner/metidos/actions/workflows/ci.yml',
  'https://github.com/jtenner/metidos/actions/workflows/ci.yml/badge.svg',
  'https://github.com/jtenner/metidos/actions/workflows/codeql.yml',
  'https://github.com/jtenner/metidos/actions/workflows/codeql.yml/badge.svg',
  'https://img.shields.io/badge/license-Apache--2.0-blue.svg',
  'https://img.shields.io/badge/status-pre--1.0-orange.svg',
];
for (const url of urls) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    console.log(`${url} -> ${res.status} ${res.url}`);
  } catch (err) {
    console.log(`${url} -> ERROR ${err && err.message ? err.message : err}`);
  }
}
NODE
```

## Result

```text
{"nameWithOwner":"jtenner/metidos","url":"https://github.com/jtenner/metidos","visibility":"PRIVATE"}

https://github.com/jtenner/metidos/actions/workflows/ci.yml -> 404 https://github.com/jtenner/metidos/actions/workflows/ci.yml
https://github.com/jtenner/metidos/actions/workflows/ci.yml/badge.svg -> 404 https://github.com/jtenner/metidos/actions/workflows/ci.yml/badge.svg
https://github.com/jtenner/metidos/actions/workflows/codeql.yml -> 404 https://github.com/jtenner/metidos/actions/workflows/codeql.yml
https://github.com/jtenner/metidos/actions/workflows/codeql.yml/badge.svg -> 404 https://github.com/jtenner/metidos/actions/workflows/codeql.yml/badge.svg
https://img.shields.io/badge/license-Apache--2.0-blue.svg -> 200 https://img.shields.io/badge/license-Apache--2.0-blue.svg
https://img.shields.io/badge/status-pre--1.0-orange.svg -> 200 https://img.shields.io/badge/status-pre--1.0-orange.svg
```

The Shields.io badge URLs are reachable. The GitHub workflow and workflow badge URLs currently return `404` to this unauthenticated public-style fetch while the repository is private, even though the corresponding workflow files are checked in. Treat that as expected pre-public behavior, not a broken checked-in README URL.

## Follow-up

After the repository is public, re-run the external URL check and visually inspect the rendered README on GitHub. The GitHub workflow page and badge URLs should no longer return the private-repository `404`, and the badges should render with the intended `CI status` and `CodeQL status` alt text.
