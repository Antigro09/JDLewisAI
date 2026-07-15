import { afterEach, describe, expect, it, vi } from "vitest";

// With the desktop gate configured, self-signup must be rejected before any
// input parsing or database work — the test DB URL points nowhere, so if the
// action ever reached the db the test would fail with a connection error.

async function importSignUp(gateSecret?: string) {
  vi.resetModules();
  if (gateSecret === undefined) delete process.env.DESKTOP_GATE_SECRET;
  else process.env.DESKTOP_GATE_SECRET = gateSecret;
  const { signUpAction } = await import("@/app/(auth)/actions");
  return signUpAction;
}

afterEach(() => {
  delete process.env.DESKTOP_GATE_SECRET;
});

describe("signup lockdown", () => {
  it("rejects signup when the desktop gate is enabled", async () => {
    const signUpAction = await importSignUp("a-sufficiently-long-secret");
    const form = new FormData();
    form.set("name", "New User");
    form.set("email", "new@example.com");
    form.set("password", "long-enough-password");
    const result = await signUpAction({}, form);
    expect(result.error).toMatch(/disabled/i);
  });

  it("still validates input when the gate is off (dev)", async () => {
    const signUpAction = await importSignUp();
    const form = new FormData();
    form.set("name", "");
    form.set("email", "not-an-email");
    form.set("password", "short");
    const result = await signUpAction({}, form);
    // Reaches normal validation instead of the lockdown error.
    expect(result.error).toBeTruthy();
    expect(result.error).not.toMatch(/disabled/i);
  });
});
