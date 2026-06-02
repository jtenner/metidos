# GitHub issue template render audit — 2026-06-02

## Scope

Checked the repository issue form templates under `.github/ISSUE_TEMPLATE/` for public-repository readiness:

- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `.github/ISSUE_TEMPLATE/install_problem.yml`
- `.github/ISSUE_TEMPLATE/plugin_issue.yml`
- `.github/ISSUE_TEMPLATE/config.yml`

This was a local desk-check, not a live GitHub preview of a public repository new-issue flow.

## Validation performed

Ran a Ruby/YAML validation script that:

- parses every issue-template YAML file;
- checks required top-level issue-form keys: `name`, `description`, `title`, and `body`;
- checks each non-markdown body field has a unique `id` and a visible `label`;
- checks markdown fields have non-empty `value` content;
- checks dropdown and checkbox fields have options;
- checks `config.yml` has a boolean `blank_issues_enabled` value and complete contact-link fields.

Command outcome:

```text
ok .github/ISSUE_TEMPLATE/bug_report.yml (9 fields)
ok .github/ISSUE_TEMPLATE/config.yml (config)
ok .github/ISSUE_TEMPLATE/feature_request.yml (5 fields)
ok .github/ISSUE_TEMPLATE/install_problem.yml (10 fields)
ok .github/ISSUE_TEMPLATE/plugin_issue.yml (9 fields)
```

## Findings

- All tracked issue-template YAML files parse successfully.
- Each issue form has the required GitHub issue-form structure for local validation.
- Field IDs are unique within each form.
- Required dropdowns and checkbox groups have options.
- Referenced labels are covered by the suggested public label set in `.github/labels.md`:
  - `bug`
  - `needs-repro`
  - `help-wanted`
  - `install`
  - `plugin-system`
- The templates include secret-redaction guidance for logs, screenshots, local paths, tokens, cookies, provider keys, and plugin runtime data where relevant.

## Result

The issue templates are ready for public-repository use from a local syntax and structure perspective. If maintainers want extra assurance after repository visibility changes, the remaining optional check is to open GitHub's new issue flow in a browser and preview each template without submitting an issue.
