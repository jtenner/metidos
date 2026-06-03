import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  accessDescriptionPopoverPlacement,
  ThreadAccessControl,
  type ThreadAccessValue,
} from "./thread-access-control";

const BASE_ACCESS_VALUE: ThreadAccessValue = {
  agentsAccess: false,
  gitAccess: false,
  githubAccess: false,
  metidosAccess: true,
  permissions: ["metidos:threads", "metidos:crons", "metidos:web-search"],
  pluginAccessGroups: [],
  sqliteAccess: false,
  threadsAccess: true,
  cronsAccess: true,
  unsafeMode: false,
  webSearchAccess: true,
};

describe("accessDescriptionPopoverPlacement", () => {
  it("keeps desktop descriptions away from the right-aligned access menu edge", () => {
    expect(accessDescriptionPopoverPlacement("desktop")).toBe("right");
    expect(accessDescriptionPopoverPlacement("mobile")).toBe("left");
  });
});

describe("ThreadAccessControl", () => {
  it("renders a dialog trigger with the supplied access-control description", () => {
    const markup = renderToStaticMarkup(
      <ThreadAccessControl
        disabled={false}
        onChange={() => {}}
        title="Choose permissions before starting a test thread."
        value={BASE_ACCESS_VALUE}
        variant="desktop"
      />,
    );

    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain(
      'title="Choose permissions before starting a test thread."',
    );
    expect(markup).toContain("Access");
  });

  it("disables the access trigger when edits are not allowed", () => {
    const markup = renderToStaticMarkup(
      <ThreadAccessControl
        disabled={true}
        onChange={() => {}}
        value={BASE_ACCESS_VALUE}
        variant="desktop"
      />,
    );

    expect(markup).toContain('disabled=""');
    expect(markup).toContain('aria-expanded="false"');
  });
});
