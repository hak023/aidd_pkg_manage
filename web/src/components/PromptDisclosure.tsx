"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import type { DisclosedStage, PromptDisclosureDTO } from "@/lib/llm/disclosure";

/** 2~5단계: 입력 자료 → LLM 지시 → 시스템 처리 흐름과 프롬프트 원문 (설계: docs/dev/P6_프롬프트-공개.md) */
export default function PromptDisclosure({
  stage,
  onCopy,
}: {
  stage: DisclosedStage;
  onCopy: (text: string, what: string) => void;
}) {
  const [loaded, setLoaded] = useState<PromptDisclosureDTO | null>(null);
  const [failed, setFailed] = useState<{ stage: DisclosedStage; message: string } | null>(null);

  useEffect(() => {
    let alive = true;
    api<PromptDisclosureDTO>(`/api/prompts?stage=${stage}`)
      .then((r) => alive && setLoaded(r))
      .catch((e: Error) => alive && setFailed({ stage, message: e.message }));
    return () => {
      alive = false;
    };
  }, [stage]);

  const d = loaded?.stage === stage ? loaded : null;
  const error = failed?.stage === stage ? failed.message : null;

  return (
    <div className="mt-4 border-t border-line pt-4" aria-label="작성·검토 방식">
      {!d ? (
        <p className={`text-[12px] ${error ? "text-danger" : "text-muted"}`}>
          {error ? `작성·검토 방식을 불러오지 못했습니다: ${error}` : "작성·검토 방식을 불러오는 중…"}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-2">
            <h3 className="text-[13px] font-semibold">
              {d.title} <span className="font-normal text-muted">· {d.task}</span>
            </h3>
            <span className={`text-[12px] ${d.runtime.provider === "gemini" ? "text-muted" : "text-warn"}`}>{d.runtime.label}</span>
          </div>

          <div className="grid md:grid-cols-3 gap-3 text-[13px]">
            <Step no="①" title="입력 자료">
              <List items={d.inputs} />
            </Step>
            <Step no="②" title="LLM에 보내는 지시">
              <ul className="space-y-1 list-disc pl-4">
                <li>시스템 지시문 {lineCount(d.system)}줄</li>
                <li>작업 지시문 {lineCount(d.prompt)}줄</li>
                <li>응답 형식: {d.responseFormat.label}</li>
                <li>temperature {d.temperature}</li>
                <li>
                  모델 설정: <span className="font-mono text-[12px]">{d.runtime.modelEnv}</span> →{" "}
                  <span className="font-mono text-[12px]">GEMINI_MODEL</span> → 자동 선택
                </li>
              </ul>
            </Step>
            <Step no="③" title="시스템이 하는 처리">
              <List items={d.codeSteps} />
            </Step>
          </div>

          {d.notes.length > 0 && (
            <ul className="mt-2 text-[12px] text-muted space-y-0.5">
              {d.notes.map((n) => (
                <li key={n}>※ {n}</li>
              ))}
            </ul>
          )}

          <div className="mt-3 space-y-2">
            <Source title="시스템 지시문 원문" text={d.system} onCopy={onCopy} />
            <Source title="작업 지시문 원문" text={d.prompt} onCopy={onCopy} />
            {d.responseFormat.schema && (
              <Source title="응답 형식 (JSON 스키마)" text={d.responseFormat.schema} note={d.responseFormat.note} onCopy={onCopy} />
            )}
          </div>
          <p className="mt-2 text-[12px] text-muted">
            원문은 LLM에 보내는 글자 그대로입니다. <span className="font-mono">{"{ }"}</span>로 표시한 자리만 실행할 때 실제 자료로 바뀝니다.
          </p>
        </>
      )}
    </div>
  );
}

const lineCount = (t: string) => t.split("\n").length;

function Step(props: { no: string; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg rounded-lg p-3">
      <div className="text-[12px] font-semibold text-muted mb-1">
        {props.no} {props.title}
      </div>
      <div className="leading-relaxed">{props.children}</div>
    </div>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1 list-disc pl-4">
      {items.map((x) => (
        <li key={x}>{x}</li>
      ))}
    </ul>
  );
}

function Source(props: { title: string; text: string; note?: string | null; onCopy: (text: string, what: string) => void }) {
  return (
    <details className="border border-line rounded-lg bg-white">
      <summary className="cursor-pointer select-none px-3 py-2 text-[13px] font-semibold">
        {props.title} <span className="font-normal text-muted text-[12px]">· {lineCount(props.text)}줄</span>
      </summary>
      <div className="px-3 pb-3">
        {props.note && <p className="text-[12px] text-muted mb-2">{props.note}</p>}
        <div className="flex justify-end mb-1">
          <button
            onClick={() => props.onCopy(props.text, props.title)}
            className="text-[12px] px-2.5 py-1 rounded-md border border-line hover:border-accent"
          >
            복사
          </button>
        </div>
        <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed bg-bg rounded-md p-3 max-h-[480px] overflow-y-auto">
          {props.text}
        </pre>
      </div>
    </details>
  );
}
