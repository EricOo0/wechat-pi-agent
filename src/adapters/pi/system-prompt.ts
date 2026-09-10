import { readFile } from "node:fs/promises";

export async function loadSystemPrompt(path: string): Promise<string> {
  let prompt: string;
  try {
    prompt = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new Error(`Unable to read system prompt at ${path}${code ? ` (${code})` : ""}`, { cause: error });
  }
  const normalized = prompt.trim();
  if (!normalized) throw new Error(`System prompt is empty: ${path}`);
  return normalized;
}
