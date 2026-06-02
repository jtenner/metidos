/**
 * @file src/mainview/app/settings-panel.test.tsx
 * @description Tests for settings panel section navigation.
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  SettingsPanelSectionNavigation,
  settingsTabsForRole,
} from "./settings-panel";

function renderSettingsNavigation({
  activeTab = "general",
  isAdmin = true,
}: {
  activeTab?: "general" | "plugin";
  isAdmin?: boolean;
} = {}): string {
  return renderToStaticMarkup(
    <SettingsPanelSectionNavigation
      activeSettingsTab={activeTab}
      panelId="settings-fixture"
      selectedSettingsTabPanelId={`settings-fixture-${activeTab}-panel`}
      settingsTabs={settingsTabsForRole(isAdmin)}
      onSelectTab={() => undefined}
    />,
  );
}

describe("settings panel section navigation", () => {
  it("renders admin sections as accessible tabs and links only the selected tab to the active panel", () => {
    const markup = renderSettingsNavigation({ activeTab: "plugin" });

    expect(markup).toContain('aria-label="Settings sections"');
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-orientation="vertical"');
    expect(markup).toContain('id="settings-fixture-general-tab"');
    expect(markup).toContain('id="settings-fixture-plugin-tab"');
    expect(markup).toContain("General");
    expect(markup).toContain("Plugin");
    expect(markup).toContain(
      'aria-controls="settings-fixture-plugin-panel" aria-selected="true"',
    );
    expect(markup).toContain('aria-selected="false"');
    expect(markup).not.toContain(
      'aria-controls="settings-fixture-general-panel"',
    );
  });

  it("hides plugin navigation for non-admin settings", () => {
    const markup = renderSettingsNavigation({ isAdmin: false });

    expect(markup).toContain('id="settings-fixture-general-tab"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).not.toContain('id="settings-fixture-plugin-tab"');
    expect(markup).not.toContain("Plugin");
  });
});
