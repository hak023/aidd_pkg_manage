/**
 * LLM 작업 실행기. Gemini 또는 모의 응답을 고른다 (설계: docs/dev/P3_수집-PRD.md 4장).
 * - LLM_MOCK=true → 모의
 * - GEMINI_API_KEY 있음 → Gemini
 * - 로컬 개발에서 키 없음 → 모의
 * - 운영에서 키 없음 → 오류 (가짜 결과가 나가지 않게)
 */
import { DomainError } from "@/lib/repo/errors";
import { DEFAULT_TEMPERATURE, generateText, getGeminiConfig, resolveModel } from "./gemini";
import {
  buildPrdPrompt,
  cleanPrdBody,
  missingPrdSections,
  mockPrdBody,
  PRD_SYSTEM,
  prdFooter,
  prdHeader,
  type PrdInput,
} from "./prd";
import { buildReviewPrompt, mockReview, normalizeReview, REVIEW_SCHEMA, REVIEW_SYSTEM, type ReviewResult } from "./review";
import {
  buildClassifyPrompt,
  CLASSIFY_SCHEMA,
  CLASSIFY_SYSTEM,
  mockClassify,
  normalizeClassify,
  type ClassifyResult,
  type ItemCandidate,
} from "./classify";
import {
  buildDocReviewPrompt,
  docReviewSchemaFor,
  DOCREVIEW_SYSTEM,
  mockDocReview,
  normalizeDocReview,
  type DocReviewResult,
  type Requirement,
  type ReviewKind,
} from "./docreview";
import {
  buildProgressPrompt,
  normalizeProgress,
  parseProgressTable,
  PROGRESS_SCHEMA,
  PROGRESS_SYSTEM,
  type Milestone,
} from "./progress";

export type LlmProvider = "gemini" | "mock";
export type LlmTask = "review" | "prd" | "classify" | "docreview" | "progress";

export function getLlmProvider(): LlmProvider {
  const mock = (process.env.LLM_MOCK ?? "").trim().toLowerCase();
  if (mock === "true" || mock === "1") return "mock";
  if (getGeminiConfig().apiKey) return "gemini";
  if (process.env.NODE_ENV !== "production") return "mock";
  throw new DomainError(503, "GEMINI_API_KEY가 설정되지 않았습니다.");
}

const TASK_MODEL_ENV: Record<LlmTask, string> = {
  review: "GEMINI_MODEL_REVIEW",
  prd: "GEMINI_MODEL_PRD",
  classify: "GEMINI_MODEL_CLASSIFY",
  docreview: "GEMINI_MODEL_DOCREVIEW",
  progress: "GEMINI_MODEL_PROGRESS",
};

/** 작업별 temperature. 화면 공개(disclosure.ts)도 이 값을 쓴다. */
export const TASK_TEMPERATURE: Partial<Record<LlmTask, number>> = { prd: 0.3 };

export function temperatureFor(task: LlmTask): number {
  return TASK_TEMPERATURE[task] ?? DEFAULT_TEMPERATURE;
}

/** 지금 설정에서 이 작업이 어떻게 실행되는지 (모델 목록 조회 없이 설정값만 본다) */
export function describeLlmRuntime(task: LlmTask): { provider: LlmProvider | "unset"; modelEnv: string; model: string | null; error?: string } {
  const modelEnv = TASK_MODEL_ENV[task];
  const model = (process.env[modelEnv] ?? "").trim() || getGeminiConfig().model;
  try {
    return { provider: getLlmProvider(), modelEnv, model };
  } catch (e) {
    return { provider: "unset", modelEnv, model, error: e instanceof Error ? e.message : String(e) };
  }
}

async function modelFor(task: LlmTask): Promise<string> {
  const cfg = getGeminiConfig();
  const specific = (process.env[TASK_MODEL_ENV[task]] ?? "").trim();
  return specific || resolveModel(cfg);
}

export interface LlmRun<T> {
  provider: LlmProvider;
  model: string;
  output: T;
}

/** L1. 형식이 틀리면 한 번 재시도하고, 그래도 실패하면 예외 (G-05). */
export async function runReview(ctx: { itemName: string; path: string }, source: string): Promise<LlmRun<ReviewResult>> {
  const provider = getLlmProvider();
  if (provider === "mock") return { provider, model: "mock", output: mockReview(source) };

  const cfg = getGeminiConfig();
  const model = await modelFor("review");
  const prompt = buildReviewPrompt(ctx, source);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await generateText(cfg, model, prompt, { system: REVIEW_SYSTEM, schema: REVIEW_SCHEMA, temperature: temperatureFor("review") });
      return { provider, model, output: normalizeReview(JSON.parse(r.text)) };
    } catch (e) {
      lastErr = e;
      // HTTP 오류(키·권한·한도)는 재시도해도 같으므로 바로 중단
      if (e instanceof Error && /^Gemini \d{3}/.test(e.message)) break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** L2. 12개 장이 모두 있어야 성공. 빠지면 한 번 재시도. */
export async function runPrd(input: PrdInput): Promise<LlmRun<string>> {
  const provider = getLlmProvider();
  const wrap = (body: string) => `${prdHeader(input)}\n${body.trim()}\n${prdFooter(input)}`;
  if (provider === "mock") return { provider, model: "mock", output: wrap(mockPrdBody(input)) };

  const cfg = getGeminiConfig();
  const model = await modelFor("prd");
  const prompt = buildPrdPrompt(input);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await generateText(cfg, model, prompt, { system: PRD_SYSTEM, temperature: temperatureFor("prd") });
      const body = cleanPrdBody(r.text);
      const missing = missingPrdSections(body);
      if (missing.length) throw new Error(`PRD에 빠진 장이 있습니다: ${missing.join(", ")}`);
      return { provider, model, output: wrap(body) };
    } catch (e) {
      lastErr = e;
      if (e instanceof Error && /^Gemini \d{3}/.test(e.message)) break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** JSON 응답 작업 공통: 형식이 틀리면 1회 재시도, HTTP 오류는 바로 중단 (G-05) */
async function runJson<T>(
  task: LlmTask,
  system: string,
  prompt: string,
  schema: Record<string, unknown>,
  normalize: (raw: unknown) => T,
): Promise<{ model: string; output: T }> {
  const cfg = getGeminiConfig();
  const model = await modelFor(task);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await generateText(cfg, model, prompt, { system, schema, temperature: temperatureFor(task) });
      return { model, output: normalize(JSON.parse(r.text)) };
    } catch (e) {
      lastErr = e;
      if (e instanceof Error && /^Gemini \d{3}/.test(e.message)) break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** L3 수신 문서 분류·매칭 */
export async function runClassify(
  mail: { subject: string; body: string; attachments: { filename: string; content: string }[] },
  items: ItemCandidate[],
  fixedItemCode: string | null,
): Promise<LlmRun<ClassifyResult>> {
  const provider = getLlmProvider();
  if (provider === "mock") return { provider, model: "mock", output: mockClassify(mail, items, fixedItemCode) };
  const codes = fixedItemCode ? [fixedItemCode] : items.map((i) => i.code);
  const r = await runJson("classify", CLASSIFY_SYSTEM, buildClassifyPrompt(mail, items, fixedItemCode), CLASSIFY_SCHEMA, (raw) =>
    normalizeClassify(raw, codes),
  );
  return { provider, ...r };
}

/** L4/L5 PRD 대비 문서 점검 */
export async function runDocReview(
  kind: ReviewKind,
  reqs: Requirement[],
  prd: string,
  doc: string,
  arch: string | null,
): Promise<LlmRun<DocReviewResult>> {
  const provider = getLlmProvider();
  if (provider === "mock") return { provider, model: "mock", output: mockDocReview(kind, reqs, doc) };
  const r = await runJson("docreview", DOCREVIEW_SYSTEM, buildDocReviewPrompt(kind, reqs, prd, doc, arch), docReviewSchemaFor(reqs), (raw) =>
    normalizeDocReview(raw, reqs),
  );
  return { provider, ...r };
}

/**
 * L6 진행상황 회신 해석. 양식 표를 따르면 규칙 해석기(provider "rule"),
 * 표가 깨졌을 때만 LLM. 모의 LLM에서 규칙으로 못 읽으면 실패로 둔다.
 */
export async function runProgress(
  itemName: string,
  source: string,
): Promise<{ provider: "rule" | LlmProvider; model: string; output: Milestone[] }> {
  const ruled = parseProgressTable(source);
  if (ruled) return { provider: "rule", model: "규칙 해석", output: ruled };
  const provider = getLlmProvider();
  if (provider === "mock") throw new Error("양식 표를 찾지 못했습니다 (모의 LLM은 표만 해석합니다).");
  const r = await runJson("progress", PROGRESS_SYSTEM, buildProgressPrompt(itemName, source), PROGRESS_SCHEMA, normalizeProgress);
  return { provider, ...r };
}
