# Retired Metidos WebView page extraction

Metidos previously shipped built-in Bun WebView tools (`webview_*`) for rendered-page interaction, HTML/Markdown extraction, and screenshots. Those tools have been removed from the Metidos runtime.

Current browser automation and screenshot capture should be implemented through Plugin System browser plugins, primarily `core_plugins/chrome_browser`, which owns Chrome DevTools control and screenshot file handling.
