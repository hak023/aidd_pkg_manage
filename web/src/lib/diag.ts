/**
 * 연결 테스트 (설정 화면). 결과에는 비밀값을 넣지 않는다.
 */
import { getMailConfig } from "@/lib/mail/config";
import { getGeminiConfig, listModels, pickFlashLite, generateText } from "@/lib/llm/gemini";

export interface CheckStep {
  name: string;
  ok: boolean;
  detail: string;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Gmail: SMTP 로그인 확인, IMAP 로그인·받은편지함 확인, (선택) 회사 주소로 테스트 메일 1통 */
export async function testGmail(opts: { send: boolean }): Promise<CheckStep[]> {
  const cfg = getMailConfig();
  const steps: CheckStep[] = [];
  const missing = [
    process.env.GMAIL_ADDRESS?.trim() ? null : "GMAIL_ADDRESS",
    process.env.GMAIL_APP_PASSWORD?.trim() ? null : "GMAIL_APP_PASSWORD",
    process.env.COLLECT_TO_ADDRESS?.trim() ? null : "COLLECT_TO_ADDRESS",
  ].filter(Boolean);
  steps.push({
    name: "설정값",
    ok: missing.length === 0,
    detail: missing.length
      ? `없음: ${missing.join(", ")}`
      : `모드: ${cfg.mode}${cfg.mode === "simulator" ? " (SIMULATOR_MODE=true라 실제 송수신은 하지 않습니다)" : ""}`,
  });
  if (missing.length) return steps;

  const auth = { user: process.env.GMAIL_ADDRESS!.trim(), pass: process.env.GMAIL_APP_PASSWORD!.replace(/\s+/g, "") };

  const nodemailer = await import("nodemailer");
  const smtp = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth });
  try {
    await smtp.verify();
    steps.push({ name: "SMTP 로그인 (발송)", ok: true, detail: "smtp.gmail.com:465 로그인 성공" });
  } catch (e) {
    steps.push({ name: "SMTP 로그인 (발송)", ok: false, detail: errText(e) });
  }

  const { ImapFlow } = await import("imapflow");
  const imap = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth, logger: false });
  try {
    await imap.connect();
    const st = (await imap.status("INBOX", { messages: true, unseen: true })) || {
      messages: undefined,
      unseen: undefined,
    };
    steps.push({
      name: "IMAP 로그인 (수신)",
      ok: true,
      detail: `imap.gmail.com:993 로그인 성공 · 받은편지함 ${st.messages ?? "?"}통 (안 읽음 ${st.unseen ?? "?"})`,
    });
  } catch (e) {
    steps.push({ name: "IMAP 로그인 (수신)", ok: false, detail: errText(e) });
  } finally {
    await imap.logout().catch(() => undefined);
  }

  if (opts.send && steps.every((s) => s.ok)) {
    try {
      // 자동 발송 허용 대상(COLLECT_TO_ADDRESS)으로만 보낸다
      const info = await smtp.sendMail({
        from: `AX_AIDD 시스템 <${auth.user}>`,
        to: process.env.COLLECT_TO_ADDRESS!.trim(),
        subject: "[AX_AIDD시스템] 메일 연결 테스트",
        text: [
          "AX_AIDD 시스템의 메일 연결 테스트입니다.",
          "이 메일이 회사 메일함(또는 스팸함)에 도착했는지 확인해 주세요.",
          "회신할 필요는 없습니다.",
          "",
          `보낸 시각: ${new Date().toISOString()}`,
        ].join("\n"),
      });
      steps.push({ name: "테스트 메일 발송", ok: true, detail: `회사 주소로 1통 발송 (응답: ${info.response})` });
    } catch (e) {
      steps.push({ name: "테스트 메일 발송", ok: false, detail: errText(e) });
    }
  }
  return steps;
}

/** Gemini: 키 확인, 모델 목록, 짧은 생성 요청 1회 */
export async function testGemini(): Promise<CheckStep[]> {
  const cfg = getGeminiConfig();
  const steps: CheckStep[] = [];
  if (!cfg.apiKey) {
    steps.push({ name: "설정값", ok: false, detail: "없음: GEMINI_API_KEY" });
    return steps;
  }
  steps.push({ name: "설정값", ok: true, detail: `GEMINI_MODEL: ${cfg.model ?? "(비어 있음 → Flash-Lite 최신 안정 버전 자동 선택)"}` });

  let model = cfg.model;
  try {
    const models = await listModels(cfg);
    const lite = pickFlashLite(models);
    steps.push({
      name: "모델 목록",
      ok: true,
      detail: `사용 가능 ${models.length}개 · Flash-Lite 안정 버전: ${lite.join(", ") || "없음"}`,
    });
    if (!model) model = lite[0] ?? null;
    if (cfg.model && !models.includes(cfg.model)) {
      steps.push({ name: "지정 모델 확인", ok: false, detail: `GEMINI_MODEL(${cfg.model})이 목록에 없습니다.` });
    }
  } catch (e) {
    steps.push({ name: "모델 목록", ok: false, detail: errText(e) });
    return steps;
  }
  if (!model) {
    steps.push({ name: "생성 요청", ok: false, detail: "사용할 모델이 없습니다. GEMINI_MODEL을 지정하세요." });
    return steps;
  }
  try {
    const t0 = Date.now();
    const r = await generateText(cfg, model, "다음 문장을 그대로 한 번만 출력하세요: AX_AIDD 연결 확인");
    steps.push({
      name: "생성 요청",
      ok: r.text.includes("AX_AIDD"),
      detail: `모델 ${model} · ${Date.now() - t0}ms · 토큰 입력 ${r.usage.input}/출력 ${r.usage.output} · 응답: ${r.text.trim().slice(0, 80)}`,
    });
  } catch (e) {
    steps.push({ name: "생성 요청", ok: false, detail: `모델 ${model}: ${errText(e)}` });
  }
  return steps;
}
