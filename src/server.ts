import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAgentTools } from "./tools/agent-tools.js";
import { registerPresetTools } from "./tools/preset-tools.js";
import { registerMemoryTools } from "./tools/memory-tools.js";
import { registerSwarmTools } from "./tools/swarm-tools.js";

export const server = new McpServer({ name: "agents-mcp", version: "1.2.0" });

registerAgentTools(server);
registerPresetTools(server);
registerMemoryTools(server);
registerSwarmTools(server);
