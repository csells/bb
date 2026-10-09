import { agentCommandSchema } from "./contracts.js";
import { RoomsStore } from "./store.js";
export function executeAgentCommand(
  store: RoomsStore,
  capability: string,
  input: unknown,
) {
  return store.agentCommand(capability, agentCommandSchema.parse(input));
}
