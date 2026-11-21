# [2026-11-21 #07] P4 Architecture·QA 구현

| 항목 | 내용 |
|---|---|
| 날짜 | 2026-11-21 |
| 순번 | 07 |
| 요청 요약 | P4로 진행 |
| 관련 문서 | 설계 [dev/P4_Architecture-QA.md](../dev/P4_Architecture-QA.md), 시험 [test/P4_시험.md](../test/P4_시험.md) |

## 1. 요청 내용

- P4(Architecture·QA 검토)를 진행해 달라.

## 2. 수행 내용

AGENTS.md 3장 규칙에 따라 설계 문서를 먼저 쓰고, 구현과 시험을 진행한 뒤 시험 문서에 기록했습니다.

### 2.1 구현

| 기능 | 내용 |
|---|---|
| 문서 등록 | 전달 메일의 md 첨부를 키워드로 판별합니다. 애매할 때만 L3를 씁니다. 태그 없는 메일은 L3가 개발사항까지 추정합니다(확신도 0.7 이상이면 자동 지정, 미만이면 미분류함에 추천). 화면에서 첨부를 골라 등록하거나 md를 직접 붙여 넣을 수 있습니다. 개정본은 새 버전으로 쌓입니다 |
| 단계 진행 | 등록하면 4단계 또는 5단계 완료 |
| L4/L5 검토 리포트 | 등록하면 자동으로 생성하고, "다시 생성"도 할 수 있습니다. PRD의 FR/NFR별로 판정합니다(반영·부분·미반영·확인 불가). QA 리포트에는 시험 누락 점검이 들어갑니다. LLM은 JSON만 만들고, md(요약 건수, 면책 문구)는 코드가 만듭니다 |
| 리포트 편집 | PRD와 같은 편집기(`DocPanel`)를 씁니다. 새 버전은 대상 문서·기준 PRD 연결을 이어 받습니다 |
| 공유 | `/api/items/[id]/share?kind=prd/arch/qa`로 통합했습니다. Architecture·QA 공유에는 문서와 리포트를 함께 첨부하고, 제목은 4.6 양식을 따릅니다 |
| 미분류함 | L3 추천(개발사항, 유형, 확신도, 이유)을 표시하고 지정란에 미리 넣어 둡니다 |
| 수집 회신 직접 입력 | Gmail 없이 실제 Copilot 회신으로 2·3단계를 진행할 수 있습니다(P3 사용자 시험용) |
| DB | 마이그레이션 `0004_docs`: documents에 연결 열 4개, mails에 suggestion |

### 2.2 시험 (자세한 기록은 [test/P4_시험.md](../test/P4_시험.md))

| 범위 | 결과 |
|---|---|
| A 자동 TC-P4-01~17 (전체 63건) | 통과 |
| B 브라우저: P4 3개 시나리오와 P3 회귀 | 통과, 콘솔 오류 0건 |
| C 실제 Gemini L3·L4·L5 | 통과 (L5는 결함 2건을 고친 뒤 통과) |
| typecheck, lint, build | 통과 |
| D 사용자 시험 | 미확인 |

### 2.3 실제 Gemini 시험에서 찾아 고친 결함

1. **QA 리포트가 설계서를 근거로 인용했습니다.**
   - QA 커버리지는 시험항목서로만 판정해야 하는데, 함께 넣은 Architecture 문서를 근거로 비기능 요구사항을 "부분"으로 판정했습니다.
   - 프롬프트로 금지해도 계속 인용했습니다.
   - **조치:** QA 점검 요청에서 Architecture를 뺐습니다. 서비스 정의 5.1에서도 선택 입력입니다.
2. **판정이 다른 요구사항 ID에 붙었습니다.** NFR 판정이 FR-01·02 ID로 나왔습니다.
   - **조치:** 응답 스키마에서 ID를 PRD의 요구사항 ID로만 제한하고(enum), 행 수를 요구사항 수로 고정했습니다.
   - 이후 2회 연속 정확했고, Architecture 리포트 결과도 그대로 유지되었습니다.

**결과 예시 (합성 자료)**
- **Architecture 리포트:** 샘플 설계서에 일부러 넣은 차이를 모두 지적했습니다.
  - 로그인 응답: PRD 3초 vs 설계서 2초
  - 로그 보관: PRD 1년 vs 설계서 180일
  - 계정 일괄 전환 (PRD에 없는 내용)
- **QA 리포트:** FR 4건은 TC ID 근거로 반영, 비기능 2건은 미반영으로 판정하고 누락 점검에 넣었습니다.

## 3. 결과물

| 구분 | 경로 |
|---|---|
| 신규 | `docs/dev/P4_Architecture-QA.md`, `docs/test/P4_시험.md` |
| 신규 | `web/src/lib/llm/classify.ts`, `docreview.ts`, `web/src/lib/repo/docs.ts` |
| 신규 | `web/src/app/api/items/[id]/`: `docs`, `doc-review`, `share`, `manual-reply` (`prd/share` 삭제) |
| 신규 | `web/src/components/DocPanel.tsx`, `DocReviewPanel.tsx`, `web/tests/docs.test.ts` |
| 수정 | `schema.ts`, `migrations.ts`(0004), `provider.ts`, `repo/prd.ts`, `repo/mail.ts`, `PrdPanel.tsx`(DocPanel 사용), `ItemDetail.tsx`, `ReviewPanel.tsx`, `MailInbox.tsx`, `Mail.tsx`, `tests/mail.test.ts`(TC-P2-10), `tests/prd.test.ts`, `env.example`, `web/README.md`, `docs/dev/README.md`, `docs/test/README.md` |

## 4. 결정 사항 / 미결 사항

**결정:** [P4 설계 문서](../dev/P4_Architecture-QA.md) 8장에 기록했습니다.
- QA 점검에 Architecture를 넣지 않음
- 요구사항 ID를 enum으로 고정
- 공유와 편집 화면을 통합
- 자동 지정 기준은 확신도 0.7

**미결**
- **사용자 시험(TC-P3-U1, TC-P4-U1):** 실제 Copilot 회신과 개발사 문서로 확인해야 합니다. 이제 "회신 직접 입력"과 "md 직접 붙여 넣기"로 Gmail 없이 할 수 있습니다.
- **git 커밋:** 사용자가 나중에 `scripts/git-push.ps1`로 진행합니다.

## 5. 다음 단계

- **P5 진행상황·완료:**
  - 진행상황 요청 메일
  - L6 회신 파싱
  - 마일스톤 표(미정 표시)와 이력
  - 공유
  - 완료
  - 1~7단계 전체 시나리오 자동 시험
