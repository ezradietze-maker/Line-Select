import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuthScreen, authModeFor, authTabTitle } from "./AuthScreen";
import { RecoveryCodePanel } from "./RecoveryCodePanel";

const screen = (initialMode: Parameters<typeof authModeFor>[0]) =>
  renderToStaticMarkup(createElement(AuthScreen, { onAuthenticated: () => {}, onContinueAsGuest: () => {}, initialMode: authModeFor(initialMode) }));

describe("the sign-in screen", () => {
  it("names the tab for the view it's on", () => {
    expect(authTabTitle("login")).toBe("Sign In · Line Select");
    expect(authTabTitle("signup")).toBe("Create Account · Line Select");
    expect(authTabTitle("forgot")).toBe("Reset Password · Line Select");
    expect(authTabTitle("reset")).toBe("Reset Password · Line Select");
  });

  it("opens on the view a link asks for, and on signing in for anything else", () => {
    expect(authModeFor("forgot")).toBe("forgot");
    expect(authModeFor("signup")).toBe("signup");
    expect(authModeFor(null)).toBe("login");
    expect(authModeFor("admin")).toBe("login");
    expect(screen("forgot")).toContain("Email me a reset link");
  });

  it("stops typing at the lengths the server takes", () => {
    const html = screen("signup");
    expect(html).toContain('maxLength="80"');
    expect(html).toContain('maxLength="200"');
    expect(html.match(/maxLength="500"/g)).toHaveLength(2);
  });

  it("says which of Log in and Create account is on, not only with the pill", () => {
    expect(screen("signup")).toMatch(/aria-pressed="false"[^>]*>.*?Log in/);
    expect(screen("signup")).toMatch(/aria-pressed="true"[^>]*>.*?Create account/);
    expect(screen(null)).toMatch(/aria-pressed="true"[^>]*>.*?Log in/);
  });

  it("puts the recovery code's heading where focus can go when it takes the form's place", () => {
    const html = renderToStaticMarkup(createElement(RecoveryCodePanel, { code: "ABCD-EFGH-JKMN-PQRS-TUVW", reason: "signup", onDone: () => {} }));
    expect(html).toMatch(/<h2[^>]*tabindex="-1"[^>]*>\s*Save your recovery code/i);
  });
});
