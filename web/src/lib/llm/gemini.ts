/**
 * Gemini API (서비스 정의 5.2). REST로 직접 호출한다.
 * 모델: GEMINI_MODEL이 있으면 그것을, 없으면 사용 가능한 Flash-Lite 계열 중 최신 안정 버전을 쓴다.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiConfig {
  apiKey: string;
  model: string | null;
}

export function getGeminiConfig(): GeminiConfig {
  return {
    apiKey: (process.env.GEMINI_API_KEY ?? "").trim(),
    model: (process.env.GEMINI_MODEL ?? "").trim().replace(/^models\//, "") || null,
  };
}

async function call<T>(cfg: GeminiConfig, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey, ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string } };
  if (!res.ok) {
    throw new Error(`Gemini ${res.status} ${data.error?.status ?? ""}: ${data.error?.message ?? "요청 실패"}`.trim());
  }
  return data as T;
}

interface ModelInfo {
  name: string;
  supportedGenerationMethods?: string[];
}

/** generateContent를 지원하는 모델 이름 목록 (models/ 접두어 제거) */
export async function listModels(cfg: GeminiConfig): Promise<string[]> {
  const r = await call<{ models?: ModelInfo[] }>(cfg, "/models?pageSize=1000");
  return (r.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""));
}

/** Flash-Lite 계열 중 안정 버전(preview·exp 제외)을 버전 높은 순으로 */
export function pickFlashLite(models: string[]): string[] {
  const ver = (n: string) => Number(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  return models
    .filter((n) => /flash-lite/.test(n) && !/preview|exp|tts|image|live|audio/.test(n))
    .sort((a, b) => ver(b) - ver(a) || a.length - b.length);
}

export async function resolveModel(cfg: GeminiConfig): Promise<string> {
  if (cfg.model) return cfg.model;
  const cands = pickFlashLite(await listModels(cfg));
  if (!cands.length) throw new Error("사용 가능한 Flash-Lite 모델을 찾지 못했습니다. GEMINI_MODEL을 지정하세요.");
  return cands[0];
}

export const DEFAULT_TEMPERATURE = 0.2;

export interface GenerateOptions {
  system?: string;
  /** 지정하면 JSON 응답 (Gemini responseSchema, OpenAPI 부분집합) */
  schema?: Record<string, unknown>;
  temperature?: number;
}

export interface GenerateResult {
  text: string;
  usage: { input: number; output: number };
}

export async function generateText(
  cfg: GeminiConfig,
  model: string,
  prompt: string,
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const generationConfig: Record<string, unknown> = { temperature: opts.temperature ?? DEFAULT_TEMPERATURE };
  if (opts.schema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = opts.schema;
  }
  const r = await call<{
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    promptFeedback?: { blockReason?: string };
  }>(cfg, `/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    body: JSON.stringify({
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig,
    }),
  });
  if (r.promptFeedback?.blockReason) throw new Error(`Gemini가 요청을 차단했습니다: ${r.promptFeedback.blockReason}`);
  const text = r.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error(`Gemini 응답이 비어 있습니다 (${r.candidates?.[0]?.finishReason ?? "원인 미상"})`);
  return {
    text,
    usage: { input: r.usageMetadata?.promptTokenCount ?? 0, output: r.usageMetadata?.candidatesTokenCount ?? 0 },
  };
}
