"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { SAMPLE_LABEL, type SampleKey } from "@/lib/mail/sample-labels";
import type { TreeNodeDTO } from "@/lib/repo/tree";
import type { Toast } from "./Workspace";

interface SettingsDTO {
  mailMode: "gmail" | "simulator" | "unconfigured";
  mailModeLabel: string;
  rows: { key: string; value: string }[];
  effective: { from: string; collectTo: string };
}

/** 설정: 현재 config 확인 (비밀값은 설정 여부만), 외부 크론 주소, 시뮬레이터 샘플 메일 */
export default function Settings({
  flat,
  notify,
  onPoll,
}: {
  flat: TreeNodeDTO[];
  notify: (t: Toast) => void;
  onPoll: () => Promise<void>;
}) {
  const [s, setS] = useState<SettingsDTO | null>(null);
  const [itemId, setItemId] = useState<string>("");
  const [origin] = useState(() => (typeof window !== "undefined" ? window.location.origin : ""));

  useEffect(() => {
    api<SettingsDTO>("/api/settings")
      .then(setS)
      .catch((e: Error) => notify({ kind: "error", text: e.message }));
  }, [notify]);

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

      <section className="bg-panel border border-line rounded-xl p-5">
        <h2 className="font-semibold mb-1">메일 연동</h2>
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
          값은 환경 변수(로컬은 <span className="font-mono">web/.env.local</span>, 배포는 Vercel 환경 변수)에서 바꿉니다.
          비밀값은 화면에 표시하지 않습니다.
        </p>
      </section>

      <section className="bg-panel border border-line rounded-xl p-5">
        <h2 className="font-semibold mb-1">자동 메일 확인</h2>
        <ul className="text-[13px] list-disc pl-5 space-y-1">
          <li>사이트를 열어 둔 동안 2분마다 자동으로 확인합니다. 머리글의 ‘메일 확인’ 버튼으로 바로 확인할 수도 있습니다.</li>
          <li>
            사이트를 닫아 두어도 확인하려면 외부 크론(cron-job.org 등)이 5~10분마다 아래 주소를 호출하게 설정합니다.
            <div className="font-mono text-[12px] bg-bg rounded px-2 py-1 mt-1 break-all">
              {origin}/api/mail/poll?secret=<span className="text-accent">POLL_SECRET 값</span>
            </div>
          </li>
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
