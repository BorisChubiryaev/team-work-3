import type { VercelRequest, VercelResponse } from "@vercel/node";

type AiRequest = {
  action?: "assist" | "summarize";
  payload?: unknown;
};

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

const prompts = {
  assist:
    "Ты редактор еженедельных рабочих отчетов. Улучши отчет на русском языке: сделай его конкретным, структурным, без канцелярита. Не выдумывай факты. Верни короткие рекомендации и улучшенную версию.",
  summarize:
    "Ты помощник руководителя. Суммаризируй еженедельные отчеты команды на русском языке. Выдели: главное, блокеры, риски, кому нужен follow-up, планы следующей недели. Не выдумывай факты.",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(501).json({ error: "OPENROUTER_API_KEY is not configured" });
  }

  const { action = "assist", payload } = req.body as AiRequest;
  const systemPrompt = prompts[action] ?? prompts.assist;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:5173",
      "X-Title": "Team Weekly Reports",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL ?? "openrouter/free",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(payload, null, 2) },
      ],
      temperature: 0.35,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    return res.status(response.status).json({ error: "OpenRouter request failed", details });
  }

  const data = (await response.json()) as OpenRouterResponse;
  const text = data?.choices?.[0]?.message?.content ?? "Не удалось получить ответ модели.";
  return res.status(200).json({ text });
}
