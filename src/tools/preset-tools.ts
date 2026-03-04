import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errResp } from "../helpers.js";
import {
  parsePreset, renderPreset, loadPresetFile,
  savePresetFile, deletePresetFile, listPresetFiles, readPresetContent,
} from "../presets/presets.js";
import type { PresetMeta } from "../presets/presets.js";
import { effortEnum, promptSchema } from "./schemas.js";

export function registerPresetTools(server: McpServer): void {
  server.registerTool(
    "save_preset",
    {
      description: "Save or update an agent preset as a .md file.",
      inputSchema: {
        name:            z.string().min(1).max(256).describe('Preset name, e.g. "oracle".'),
        system_prompt:   promptSchema,
        description:     z.string().max(512).optional().describe("Short one-line description."),
        model:           z.string().max(256).optional().describe("Recommended model."),
        effort:          effortEnum.describe("Recommended reasoning effort."),
        inputs_required: z.string().max(1024).optional().describe("Comma-separated required inputs."),
        inputs_optional: z.string().max(1024).optional().describe("Comma-separated optional inputs."),
        outputs:         z.string().max(512).optional().describe("Output format description."),
        response_format: z.string().max(65536).optional().describe("Response format setting."),
        api_base:        z.string().url().optional().describe("API base URL for this preset."),
        api_key_env:     z.string().max(256).optional().describe("Env var name for API key."),
        overwrite:       z.boolean().optional().describe("Set true to overwrite existing."),
      },
    },
    async ({ name, system_prompt, description, model, effort, inputs_required, inputs_optional, outputs, response_format, api_base, api_key_env, overwrite }) => {
      try {
        const content = renderPreset({
          name, description: description ?? "", model, effort,
          inputs_required, inputs_optional, outputs, response_format,
          api_base, api_key_env, system_prompt,
        } satisfies PresetMeta);
        const { file, existed } = await savePresetFile(name, content, overwrite);
        return { content: [{ type: "text" as const, text: `${existed ? "Updated" : "Saved"} preset → ${file}` }] };
      } catch (err) {
        return errResp(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "list_presets",
    { description: "List all saved agent presets with metadata.", inputSchema: {} },
    async () => {
      try {
        const files = await listPresetFiles();
        const result = await Promise.all(files.map(async (f) => {
          const text = await loadPresetFile(f.replace(".md", ""));
          const p = parsePreset(text);
          return {
            name: f.replace(".md", ""), display_name: p.name, description: p.description,
            ...(p.model           && { model: p.model }),
            ...(p.effort          && { effort: p.effort }),
            ...(p.inputs_required && { inputs_required: p.inputs_required }),
            ...(p.inputs_optional && { inputs_optional: p.inputs_optional }),
            ...(p.outputs         && { outputs: p.outputs }),
            ...(p.response_format && { response_format: p.response_format }),
            ...(p.api_base        && { api_base: p.api_base }),
          };
        }));
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return errResp(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "delete_preset",
    {
      description: "Delete a saved preset by name.",
      inputSchema: { name: z.string().min(1).max(256).describe("Preset name (without .md).") },
    },
    async ({ name }) => {
      try {
        await deletePresetFile(name);
        return { content: [{ type: "text" as const, text: `Deleted preset '${name}'.` }] };
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT")
          return errResp(`Preset '${name}' not found.`);
        return errResp(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerResource(
    "preset-content",
    new ResourceTemplate("agents://presets/{name}", { list: undefined }),
    { description: "Returns the full content of a saved agent preset file." },
    async (uri, { name }) => {
      const content = await readPresetContent(String(name));
      if (!content) {
        return { contents: [{ uri: uri.href, mimeType: "text/plain", text: `Preset '${name}' not found.` }] };
      }
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: content }] };
    },
  );
}
