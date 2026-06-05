# Zed Setup

## Required Extensions

- **[Oxc](https://zed.dev/extensions/oxc)** — Linting (oxlint) and formatting (oxfmt)

Zed includes built-in Tailwind CSS support — no extension needed.

Install Oxc from Zed's extension panel. Format on save is configured in `settings.json` using the Oxc language server. Tailwind IntelliSense is configured to work inside `cva()` and `cx()` calls via `classFunctions` in the LSP settings.
