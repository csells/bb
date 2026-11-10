import { type AvailableModel } from "@get-bb/plugin-sdk/provider-bridge";
import { buildClaudeCodeModels } from "../model-list.js";
import { probeClaudeInitialization } from "./initialization-probe.js";
import { supplementPooledClaudeModels } from "./pooled-models.js";

async function probeClaudeCodeModels(env: NodeJS.ProcessEnv): Promise<{
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
}> {
  const initialization = await probeClaudeInitialization({
    env,
    cwd: process.cwd(),
  });
  if (initialization.models.length === 0) {
    throw new Error("Claude Code reported no models.");
  }
  return buildClaudeCodeModels(
    await supplementPooledClaudeModels(initialization.models, env),
  );
}

export async function listClaudeCodeBridgeModels(
  env: NodeJS.ProcessEnv = process.env,
): ReturnType<typeof probeClaudeCodeModels> {
  try {
    return await probeClaudeCodeModels(env);
  } catch (error) {
    if (
      env.ANTHROPIC_MODEL &&
      error instanceof Error &&
      error.message.includes("--client-data-url:") &&
      error.message.includes("pass the matching --model")
    ) {
      return probeClaudeCodeModels({ ...env, ANTHROPIC_MODEL: undefined });
    }
    throw error;
  }
}
