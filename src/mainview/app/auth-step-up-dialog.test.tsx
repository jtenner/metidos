/**
 * @file src/mainview/app/auth-step-up-dialog.test.tsx
 * @description Rendering tests for the step-up authentication dialog content.
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AuthStepUpDialogContent } from "./auth-step-up-dialog";

describe("AuthStepUpDialogContent", () => {
  it("renders primary factor and TOTP fields for sensitive action retry", () => {
    const noop = () => {};
    const markup = renderToStaticMarkup(
      <AuthStepUpDialogContent
        actionLabel="Verify and retry"
        error="Recent authentication is required."
        loading={false}
        onCancel={noop}
        onPrimaryFactorChange={noop}
        onSubmit={noop}
        onTotpCodeChange={noop}
        primaryFactor=""
        primaryFactorInputId="primary-factor"
        totpCode=""
        totpCodeInputId="totp-code"
      />,
    );

    expect(markup).toContain("PIN or password");
    expect(markup).toContain("TOTP code");
    expect(markup).toContain("Recent authentication is required.");
    expect(markup).toContain("Verify and retry");
    expect(markup).toContain('autoComplete="one-time-code"');
  });
});
