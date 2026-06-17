import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { ApiError } from '../lib/errors.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export interface FoodInput {
  name: string;
  grams?: number | null;
}

export interface AnalyzedItem {
  name: string;
  grams: number;
  calories: number;
  proteins: number;
  fats: number;
  carbs: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    groq: {
      /** True when a GROQ_API_KEY is configured. */
      readonly configured: boolean;
      /** Parse a food list into per-item macros (KБЖУ). */
      analyzeFood(items: FoodInput[]): Promise<AnalyzedItem[]>;
      /** Free-form completion for the daily recommendation. */
      recommend(system: string, user: string): Promise<string>;
    };
  }
}

// Strict parser prompt — returns a JSON object (json mode requires an object,
// so we wrap the array under `items`).
const FOOD_SYSTEM = `Ты — парсер еды и калькулятор нутриентов. На вход получаешь список продуктов; у каждого вес в граммах может быть указан или нет. Если вес не указан, прими разумную стандартную порцию и сам проставь её вес в граммах. Рассчитай КБЖУ для каждого продукта ИМЕННО для его порции (не на 100 г). Верни СТРОГО JSON-объект без какого-либо другого текста или markdown в формате:
{"items":[{"name":"название","grams":0,"calories":0,"proteins":0,"fats":0,"carbs":0}]}
calories — ккал; proteins, fats, carbs — граммы. Числа округляй до целых.`;

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
};

/** Tolerant extraction of the items array from the model's reply. */
function parseItems(content: string): AnalyzedItem[] {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    // Strip markdown fences / surrounding prose and retry on the first {...} or [...].
    const match = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) throw new ApiError(502, 'AI вернул нераспознаваемый ответ');
    raw = JSON.parse(match[0]);
  }
  const arr: unknown = Array.isArray(raw)
    ? raw
    : (raw as { items?: unknown })?.items;
  if (!Array.isArray(arr)) throw new ApiError(502, 'AI вернул ответ без списка продуктов');

  return arr.map((it) => {
    const o = (it ?? {}) as Record<string, unknown>;
    return {
      name: String(o.name ?? '').trim() || 'Без названия',
      grams: num(o.grams ?? o.weight),
      calories: num(o.calories ?? o.kcal),
      proteins: num(o.proteins ?? o.p),
      fats: num(o.fats ?? o.f),
      carbs: num(o.carbs ?? o.c),
    };
  });
}

async function callGroq(
  app: FastifyInstance,
  body: Record<string, unknown>,
): Promise<string> {
  if (!env.GROQ_API_KEY) {
    throw new ApiError(503, 'AI не настроен (нет GROQ_API_KEY)');
  }
  let res: Response;
  try {
    res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: env.GROQ_MODEL, ...body }),
    });
  } catch (err) {
    app.log.error({ err }, 'Groq request failed (network)');
    throw new ApiError(502, 'Не удалось связаться с AI-сервисом');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    app.log.error({ status: res.status, text }, 'Groq returned an error');
    throw new ApiError(502, 'AI-сервис вернул ошибку');
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? '';
}

/** Initialises the Groq client facade. */
export default fp(async function groqPlugin(app: FastifyInstance) {
  app.decorate('groq', {
    configured: Boolean(env.GROQ_API_KEY),

    async analyzeFood(items: FoodInput[]) {
      const list = items
        .map((i) =>
          i.grams && i.grams > 0
            ? `${i.name} — ${i.grams} г`
            : `${i.name} — стандартная порция`,
        )
        .join('\n');

      const content = await callGroq(app, {
        temperature: 0,
        max_tokens: 1024,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: FOOD_SYSTEM },
          { role: 'user', content: list },
        ],
      });
      return parseItems(content);
    },

    async recommend(system: string, user: string) {
      const content = await callGroq(app, {
        temperature: 0.6,
        max_tokens: 320,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      return content.trim();
    },
  });
});
