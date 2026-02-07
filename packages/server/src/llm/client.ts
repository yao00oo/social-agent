import OpenAI from "openai";

export const llm = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": "https://social-agent.app",
    "X-Title": "Social Agent",
  },
});

export const DEFAULT_MODEL =
  process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4-20250514";

export async function chat(
  systemPrompt: string,
  userMessage: string,
  options?: { json?: boolean; model?: string }
): Promise<string> {
  const response = await llm.chat.completions.create({
    model: options?.model || DEFAULT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    response_format: options?.json ? { type: "json_object" } : undefined,
  });
  return response.choices[0].message.content || "";
}

export async function chatWithHistory(
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  options?: { json?: boolean; model?: string }
): Promise<string> {
  const response = await llm.chat.completions.create({
    model: options?.model || DEFAULT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages,
    ],
    response_format: options?.json ? { type: "json_object" } : undefined,
  });
  return response.choices[0].message.content || "";
}
