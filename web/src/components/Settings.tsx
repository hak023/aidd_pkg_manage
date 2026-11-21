"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { SAMPLE_LABEL, type SampleKey } from "@/lib/mail/sample-labels";
import type { TreeNodeDTO } from "@/lib/repo/tree";
import type { Toast } from "./Workspace";

interface SettingsDTO {
  mailMode: "gmail" | "simulator" | "unconfigured";
  mailModeLabel: string;
  rows: { key: string; value: string }[];
  effective: { from: string; collectTo: string };
  user: { id: string; name: string } | null;
}

/** 설정: 로그인 사용자 기준 config 확인 (비밀값은 설정 여부만), 시뮬레이터 샘플 메일 */
export default function Settings({
  flat,
  notify,
  onPoll,
  onChanged,
}: {
  flat: TreeNodeDTO[];
  notify: (t: Toast) => void;
  onPoll: () => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [s, setS] = useState<SettingsDTO | null>(null);
  const [itemId, setItemId] = useState<string>("");

  const loadSettings = useCallback(() => {
    api<SettingsDTO>("/api/settings")
      .then(setS)
      .catch((e: Error) => notify({ kind: "error", text: e.message }));
  }, [notify]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const items = flat.filter((n) => n.type === "item" && n.item);

  async function inject(sample: SampleKey) {
    try {
      const r = await api<{ subject: string }>("/api/sim/inject", {
        method: "POST",
        body: { sample, itemId: sample === "untagged_doc" ? null : itemId ? Number(itemId) : null },
      });
      notify({ kind: "ok", text: `가상 받은편지함에 넣었습니다: ${r.subject}` });
    } catch (e) {
      notify({ kind: "error", text: (e as Error).message });
    }
  }

  return (
    <div className="p-6 max-w-4xl space-y-4">
      <h1 className="text-[20px] font-bold">설정</h1>

      <MyMailSettings
        notify={notify}
        onSaved={async () => {
          loadSettings();
          await onChanged();
        }}
      />

      <section className="bg-panel border border-line rounded-xl p-5">
        <h2 className="font-semibold mb-1">메일 연동{s?.user ? ` · ${s.user.name} (${s.user.id})` : ""}</h2>
        {s && (
          <p className="text-[13px] mb-3">
            현재 모드:{" "}
            <b className={s.mailMode === "gmail" ? "text-ok" : s.mailMode === "simulator" ? "text-warn" : "text-danger"}>
              {s.mailModeLabel}
            </b>
            <span className="text-muted">
              {" "}
              · 보내는 주소 {s.effective.from || "-"} → 수집 요청 받는 주소 {s.effective.collectTo || "-"}
            </span>
          </p>
        )}
        <table className="w-full text-[13px]">
          <tbody>
            {s?.rows.map((r) => (
              <tr key={r.key} className="border-t border-line">
                <td className="py-1.5 pr-4 font-mono text-[12px] text-muted w-64">{r.key}</td>
                <td className="py-1.5 break-all">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[12px] text-muted mt-3">
          메일 주소·앱 비밀번호는 위 ‘내 메일 설정’에서 바꿉니다. 표의 시스템 값은 관리자가 환경 변수(로컬은{" "}
          <span className="font-mono">web/.env.local</span>, 배포는 Vercel 환경 변수)에서 바꿉니다. 비밀값은 화면에
          표시하지 않습니다.
        </p>
      </section>

      <ConnectionTest notify={notify} />

      {s?.mailMode === "simulator" && <ScenarioRunner notify={notify} onChanged={onChanged} />}

      <section className="bg-panel border border-line rounded-xl p-5">
        <h2 className="font-semibold mb-1">자동 메일 확인</h2>
        <ul className="text-[13px] list-disc pl-5 space-y-1">
          <li>사이트를 열어 둔 동안 2분마다 로그인한 사용자의 Gmail을 자동으로 확인합니다.</li>
          <li>머리글의 ‘메일 확인’ 버튼으로 바로 확인할 수도 있습니다. 사이트를 닫아 두면 확인하지 않습니다.</li>
        </ul>
      </section>

      <section className="bg-panel border border-line rounded-xl p-5">
        <h2 className="font-semibold mb-1">시뮬레이터 샘플 메일</h2>
        {s?.mailMode !== "simulator" ? (
          <p className="text-[13px] text-muted">
            시뮬레이터 모드(SIMULATOR_MODE=true)에서만 사용할 수 있습니다. 지금은 실제 Gmail로 동작합니다.
          </p>
        ) : (
          <>
            <p className="text-[13px] text-muted mb-3">
              “통화매니저 SSO 로그인 기능 개발” 기준의 합성 메일을 가상 받은편지함에 넣습니다. 넣은 다음 ‘메일 확인’을
              누르면 실제 수신과 같은 과정으로 처리됩니다.
            </p>
            <label className="block mb-3 text-[13px]">
              <span className="text-[12px] text-muted">대상 개발사항 (회신 제목·태그에 사용)</span>
              <select
                className="block w-full max-w-xl border border-line rounded-md px-2 py-1.5 bg-white mt-1"
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
              >
                <option value="">선택…</option>
                {items.map((n) => (
                  <option key={n.id} value={n.id}>
                    [{n.item!.code}] {n.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(SAMPLE_LABEL) as SampleKey[]).map((k) => (
                <button
                  key={k}
                  onClick={() => inject(k)}
                  disabled={k !== "untagged_doc" && !itemId}
                  className="text-[12px] px-3 py-1.5 rounded-md border border-line hover:border-accent disabled:opacity-40"
                >
                  {SAMPLE_LABEL[k]}
                </button>
              ))}
              <button
                onClick={onPoll}
                className="text-[12px] px-3 py-1.5 rounded-md bg-accent text-white font-semibold"
              >
                메일 확인
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

interface CheckStep {
  name: string;
  ok: boolean;
  detail: string;
}

type SettingSource = "user" | "admin" | "none";
interface MyMailSettingsDTO {
  gmailAddress: string;
  collectTo: string;
  appPasswordSet: boolean;
  appPasswordUnreadable: boolean;
  source: { gmailAddress: SettingSource; appPassword: SettingSource; collectTo: SettingSource };
  updatedAt: string | null;
}

const SOURCE_LABEL: Record<SettingSource, string> = { user: "내가 입력", admin: "관리자 기본값", none: "없음" };

/** 내 메일 설정: 로그인한 사용자가 직접 수정. 앱 비밀번호는 다시 보여 주지 않는다. */
function MyMailSettings({ notify, onSaved }: { notify: (t: Toast) => void; onSaved: () => Promise<void> }) {
  const [cur, setCur] = useState<MyMailSettingsDTO | null>(null);
  const [gmail, setGmail] = useState("");
  const [collectTo, setCollectTo] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = useCallback((d: MyMailSettingsDTO) => {
    setCur(d);
    setGmail(d.gmailAddress);
    setCollectTo(d.collectTo);
    setPw("");
  }, []);

  useEffect(() => {
    api<MyMailSettingsDTO>("/api/settings/mail")
      .then(apply)
      .catch((e: Error) => notify({ kind: "error", text: e.message }));
  }, [apply, notify]);

  async function save(body: Record<string, unknown>, okText: string) {
    setBusy(true);
    try {
      apply(await api<MyMailSettingsDTO>("/api/settings/mail", { method: "PUT", body }));
      notify({ kind: "ok", text: okText });
      await onSaved();
    } catch (e) {
      notify({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const input = "block w-full max-w-md border border-line rounded-md px-2 py-1.5 bg-white mt-1 text-[13px]";
  const src = (k: keyof MyMailSettingsDTO["source"]) =>
    cur ? <span className="text-[11px] text-muted ml-2">({SOURCE_LABEL[cur.source[k]]})</span> : null;

  return (
    <section className="bg-panel border border-line rounded-xl p-5">
      <h2 className="font-semibold mb-1">내 메일 설정</h2>
      <p className="text-[13px] text-muted mb-3">
        로그인한 계정으로 메일을 보내고 받을 때 쓰는 값입니다. 비워 두면 관리자 기본값(환경 변수)을 씁니다. 앱 비밀번호는
        암호화해 저장하고 화면에 다시 표시하지 않습니다.
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save({ gmailAddress: gmail, collectTo, appPassword: pw }, "내 메일 설정을 저장했습니다.");
        }}
      >
        <label className="block text-[13px]">
          <span className="text-[12px] text-muted">Gmail 주소 (보내고 받는 계정){src("gmailAddress")}</span>
          <input className={input} disabled={!cur} type="email" autoComplete="off" value={gmail} onChange={(e) => setGmail(e.target.value)} />
        </label>
        <label className="block text-[13px]">
          <span className="text-[12px] text-muted">
            Gmail 앱 비밀번호 (16자){src("appPassword")}
            {cur?.appPasswordUnreadable && <b className="text-danger ml-2">저장된 값을 읽을 수 없습니다. 다시 입력하세요.</b>}
          </span>
          <input
            className={input}
            disabled={!cur}
            type="password"
            autoComplete="new-password"
            placeholder={cur?.appPasswordSet ? "설정됨 · 바꿀 때만 입력" : "Google 계정 → 보안 → 앱 비밀번호"}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
        </label>
        <label className="block text-[13px]">
          <span className="text-[12px] text-muted">
            수집 요청 받는 주소 (내 회사 메일, 자동 발송은 이 주소로만){src("collectTo")}
          </span>
          <input
            className={input}
            disabled={!cur}
            type="email"
            autoComplete="off"
            value={collectTo}
            onChange={(e) => setCollectTo(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2 items-center">
          <button
            type="submit"
            disabled={busy || !cur}
            className="px-4 py-1.5 rounded-md bg-accent text-white font-semibold text-[13px] disabled:opacity-40"
          >
            {busy ? "저장 중…" : "저장"}
          </button>
          {cur?.source.appPassword === "user" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm("내가 입력한 앱 비밀번호를 지울까요? (관리자 기본값이 있으면 그 값을 씁니다)")) {
                  void save({ clearAppPassword: true }, "앱 비밀번호를 지웠습니다.");
                }
              }}
              className="px-3 py-1.5 rounded-md border border-line hover:border-danger hover:text-danger text-[13px] disabled:opacity-40"
            >
              앱 비밀번호 지우기
            </button>
          )}
          <span className="text-[12px] text-muted">저장한 뒤 아래 ‘연결 테스트’로 확인하세요.</span>
        </div>
      </form>
    </section>
  );
}

/** Gmail·Gemini 연결 테스트 */
function ConnectionTest({ notify }: { notify: (t: Toast) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ title: string; steps: CheckStep[] } | null>(null);

  async function run(target: "gmail" | "gemini", send = false) {
    if (send && !window.confirm("내 수집 요청 주소(회사 주소)로 테스트 메일 1통을 보낼까요?")) return;
    setBusy(target + (send ? "-send" : ""));
    try {
      const r = await api<{ steps: CheckStep[] }>("/api/settings/test", { method: "POST", body: { target, send } });
      setResult({ title: target === "gmail" ? "Gmail 연결 테스트" : "Gemini 연결 테스트", steps: r.steps });
    } catch (e) {
      notify({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const btn = "text-[12px] px-3 py-1.5 rounded-md border border-line hover:border-accent disabled:opacity-40";
  return (
    <section className="bg-panel border border-line rounded-xl p-5">
      <h2 className="font-semibold mb-1">연결 테스트</h2>
      <p className="text-[13px] text-muted mb-3">
        저장된 내 메일 설정으로 실제 서버에 접속해 봅니다. 시뮬레이터 모드여도 Gmail 값이 있으면 테스트할 수 있습니다.
      </p>
      <div className="flex flex-wrap gap-2">
        <button className={btn} disabled={!!busy} onClick={() => run("gmail")}>
          {busy === "gmail" ? "확인 중…" : "Gmail 로그인 확인"}
        </button>
        <button className={btn} disabled={!!busy} onClick={() => run("gmail", true)}>
          {busy === "gmail-send" ? "보내는 중…" : "Gmail 테스트 메일 보내기"}
        </button>
        <button className={btn} disabled={!!busy} onClick={() => run("gemini")}>
          {busy === "gemini" ? "확인 중…" : "Gemini 확인"}
        </button>
      </div>
      {result && (
        <div className="mt-4">
          <h3 className="text-[13px] font-semibold mb-1">{result.title}</h3>
          <ul className="text-[13px] space-y-1">
            {result.steps.map((s) => (
              <li key={s.name} className="flex gap-2">
                <span className={s.ok ? "text-ok" : "text-danger"}>{s.ok ? "✓" : "✕"}</span>
                <span className="font-semibold shrink-0">{s.name}</span>
                <span className="text-muted break-all">{s.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

interface ScenarioResultDTO {
  itemId: number | null;
  itemName: string;
  llm: string;
  ok: boolean;
  steps: { no: number; title: string; ok: boolean; detail: string; ms: number }[];
  totalMs: number;
}

/** 전체 시나리오 자동 실행 (서비스 정의 7.3): 새 개발사항으로 1~7단계를 차례로 진행하고 결과를 표로 */
function ScenarioRunner({ notify, onChanged }: { notify: (t: Toast) => void; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScenarioResultDTO | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const r = await api<ScenarioResultDTO>("/api/sim/scenario", { method: "POST" });
      setResult(r);
      await onChanged();
      notify(r.ok ? { kind: "ok", text: "전체 시나리오 1~7단계를 모두 통과했습니다." } : { kind: "error", text: "전체 시나리오 중 실패한 단계가 있습니다." });
    } catch (e) {
      notify({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-panel border border-line rounded-xl p-5">
      <h2 className="font-semibold mb-1">전체 시나리오 실행</h2>
      <p className="text-[13px] text-muted mb-3">
        “시나리오 시험” 단위서비스 아래에 개발사항을 새로 만들고, 합성 메일로 1~7단계를 차례로 진행하며 단계마다 넘어가는지
        확인합니다. LLM은 지금 설정(모의 또는 Gemini)을 그대로 씁니다. Gemini면 1분 정도 걸립니다.
      </p>
      <button
        onClick={run}
        disabled={busy}
        className="px-4 py-2 rounded-md bg-accent text-white font-semibold text-[13px] disabled:opacity-40"
      >
        {busy ? "실행 중…" : "전체 시나리오 실행"}
      </button>
      {result && (
        <div className="mt-4">
          <p className={`text-[13px] font-semibold mb-2 ${result.ok ? "text-ok" : "text-danger"}`}>
            {result.ok ? "모두 통과" : "실패"} · {result.llm} · {(result.totalMs / 1000).toFixed(1)}초 ·{" "}
            {result.itemId ? (
              <a className="text-accent underline" href={`#node-${result.itemId}`}>
                {result.itemName}
              </a>
            ) : (
              result.itemName
            )}
          </p>
          <table className="w-full text-[12.5px] border border-line rounded-lg">
            <tbody>
              {result.steps.map((st) => (
                <tr key={st.no} className="border-t border-line align-top">
                  <td className="px-3 py-1.5 w-8">{st.ok ? <span className="text-ok">✓</span> : <span className="text-danger">✕</span>}</td>
                  <td className="px-3 py-1.5 w-44 font-semibold">
                    {st.no}. {st.title}
                  </td>
                  <td className="px-3 py-1.5 break-words">{st.detail}</td>
                  <td className="px-3 py-1.5 w-20 text-right text-muted">{(st.ms / 1000).toFixed(1)}초</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
