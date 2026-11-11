import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuthScreen, authModeFor, authTabTitle } from "./AuthScreen";

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
});
