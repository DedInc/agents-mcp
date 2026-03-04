#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PRESETS_DIR } from "./config.js";
import { seedBundledPresets } from "./presets/presets.js";
import { server } from "./server.js";

await seedBundledPresets();

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("agents-mcp started on stdio | presets:", PRESETS_DIR);
