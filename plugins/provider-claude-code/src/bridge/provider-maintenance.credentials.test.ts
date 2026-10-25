import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const state = vi.hoisted(() => ({
  keychain: "",
  file: "",
}));

vi.mock("node:child_process", () => ({
  execFile: (
    _file: string,
    _args: readonly string[],
    _options: object,
    callback: (
      error: Error | null,
      result: { stdout: string; stderr: string },
    ) => void,
  ) => callback(null, { stdout: state.keychain, stderr: "" }),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: (file: string) =>
      Promise.resolve(
        file.endsWith(".credentials.json")
          ? state.file
          : JSON.stringify({ oauthAccount: { emailAddress: null } }),
      ),
  },
}));

vi.mock("@get-bb/plugin-sdk/provider-bridge", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@get-bb/plugin-sdk/provider-bridge")
  >()),
  experimental_resolveExecutablePath: () => Promise.resolve("/test/claude"),
}));

import {
  getClaudeProviderHealth,
  getClaudeProviderUsage,
} from "./provider-maintenance.js";

const originalPlatform = process.platform;

beforeAll(() => {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: "darwin",
  });
});

afterAll(() => {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: originalPlatform,
  });
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", undefined);
  const credentials = JSON.stringify({
    claudeAiOauth: {
      accessToken: "test-access-token",
      expiresAt: null,
      subscriptionType: "pro",
      rateLimitTier: "default_claude_max_5x",
    },
  });
  state.file = credentials;
  state.keychain = Buffer.from(credentials, "utf8").toString("hex");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ limits: [] }),
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Claude Code credential loading", () => {
  it("honors an unattended OAuth token over an expired saved login without reporting unrelated subscription usage", async () => {
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "test-unattended-oauth-token");
    const expired = JSON.stringify({
      claudeAiOauth: { accessToken: "expired-test-token", expiresAt: 0 },
    });
    state.keychain = expired;
    state.file = expired;

    expect(await getClaudeProviderHealth()).toMatchObject({
      supported: true,
      health: { status: "ready", accountEmail: null, planLabel: null },
    });
    expect(await getClaudeProviderUsage()).toEqual({ supported: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("loads a hex-encoded Keychain credential", async () => {
    const result = await getClaudeProviderUsage();

    expect(result).toEqual({
      supported: true,
      usage: expect.objectContaining({ status: "ok" }),
    });
  });

  it("uses the credential file when the Keychain value is invalid", async () => {
    state.keychain = "invalid-keychain-value";

    const result = await getClaudeProviderUsage();

    expect(result).toEqual({
      supported: true,
      usage: expect.objectContaining({ status: "ok" }),
    });
  });

  it("distinguishes usage-check throttling from an exhausted Claude limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429 }),
    );

    const result = await getClaudeProviderUsage();

    expect(result).toEqual({
      supported: true,
      usage: expect.objectContaining({
        status: "error",
        message:
          "Anthropic temporarily throttled this usage check. This does not mean your Claude limit is exhausted. Try again later.",
      }),
    });
  });
});
