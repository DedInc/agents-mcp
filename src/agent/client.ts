import OpenAI from "openai";
import { DEFAULT_API_KEY, MAX_CLIENTS } from "../config.js";

const _clients = new Map<string, OpenAI>();

export function getClient(base_url: string, apiKey?: string): OpenAI {
  const key = `${base_url}::${apiKey ?? DEFAULT_API_KEY}`;
  const cached = _clients.get(key);
  if (cached) {
    _clients.delete(key);
    _clients.set(key, cached);
    return cached;
  }

  if (_clients.size >= MAX_CLIENTS) {
    const oldest = _clients.keys().next().value!;
    _clients.delete(oldest);
  }

  const client = new OpenAI({ baseURL: base_url, apiKey: apiKey ?? DEFAULT_API_KEY });
  _clients.set(key, client);
  return client;
}
