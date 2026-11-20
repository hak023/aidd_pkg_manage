import type { StageKey, StageStatus } from "@/lib/db/schema";
import { STAGES, STATUS_LABEL } from "@/lib/domain/stages";

const DOT: Record<StageStatus, string> = {
  pending: "bg-line",
  in_progress: "bg-warn",
  done: "bg-ok",
};

/** 대시보드용 작은 단계 표시 */
export default function StageDots({ statuses }: { statuses: Partial<Record<StageKey, StageStatus>> }) {
  return (
    <span className="inline-flex gap-1" aria-label="단계별 상태">
      {STAGES.map((s) => {
        const st = statuses[s.key] ?? "pending";
        return (
          <span
            key={s.key}
            title={`${s.no}. ${s.label}: ${STATUS_LABEL[st]}`}
            className={`w-2.5 h-2.5 rounded-full ${DOT[st]}`}
          />
        );
      })}
    </span>
  );
}
