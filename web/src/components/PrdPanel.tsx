"use client";

import type { Toast } from "./Workspace";
import DocPanel from "./DocPanel";

/** 3단계 PRD 카드 */
export default function PrdPanel(props: {
  itemId: number;
  refreshToken: number;
  onChanged: () => Promise<void>;
  notify: (t: Toast) => void;
}) {
  return (
    <DocPanel
      {...props}
      kind="prd"
      shareKind="prd"
      title="PRD"
      emptyText="아직 PRD가 없습니다. 2단계 “수집 검토”에서 PRD를 생성하세요."
    />
  );
}
