# AX_AIDD 웹 앱

개발사항마다 메일로 사내 논의 내용을 수집하고, LLM으로 점검해 PRD를 만들고, Architecture·QA 문서를 대조하고, 진행상황을 추적하는 웹 서비스입니다.

- 기준 문서: [`docs/proposals/2026-11-21_AX_AIDD-서비스-정의-v0.2.md`](../docs/proposals/2026-11-21_AX_AIDD-서비스-정의-v0.2.md)
- 배포 방법: [`docs/guides/배포-가이드.md`](../docs/guides/배포-가이드.md)

## 로컬 실행

```powershell
cd web
npm install
npm run dev          # http://localhost:3000
```

- `.env.local`이 없으면 개발용 계정 **admin / admin**으로 로그인합니다.
- DB는 설치가 필요 없는 내장 Postgres(PGlite)를 `web/.data/pglite`에 저장합니다. 폴더를 지우면 초기화됩니다.
- 환경 변수 목록은 [`env.example`](env.example)에 있습니다.
- `npm run dev` / `npm start`는 `NODE_OPTIONS=--use-system-ca`로 실행합니다. 회사망의 SSL 검사 장비 때문에 Node가 Gmail·Gemini 인증서를 거부하는 문제를 막기 위해서입니다(Windows 인증서 저장소의 사내 루트 인증서 사용).
- 메일 값이 없으면 **시뮬레이터 모드**(가상 메일함)로 동작합니다. 실제 Gmail 연결은 [`docs/guides/메일-연동-가이드.md`](../docs/guides/메일-연동-가이드.md)를 따릅니다.

## 스크립트

| 명령 | 내용 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` / `npm start` | 운영 빌드 / 실행 |
| `npm test` | 단위·저장소 테스트 (Vitest + 메모리 PGlite) |
| `npm run typecheck` | Next 라우트 타입 생성 후 TypeScript 검사 |
| `npm run lint` | ESLint |
| `npm run seed:demo` | 전체 데이터 초기화 후 6개 단위서비스 기준 시연 데이터 일괄 생성 (`-- --clear`로 비우기) |

> Windows의 Git Bash에서 `/c/...` 경로로 `npm test`를 실행하면 Vitest가 모듈을 두 번 불러와 실패할 수 있습니다. PowerShell이나 `C:\` 경로에서 실행하세요.

## 구조

```
src/
  proxy.ts                 로그인 확인 (Next 16의 미들웨어 = proxy)
  app/
    login/                 더미 로그인 화면
    page.tsx               메인 (트리 + 대시보드/상세)
    api/
      auth/login|logout    로그인 쿠키 발급·삭제
      tree                 전체 트리 + 개발사항 요약
      nodes, nodes/[id]    생성 / 이름 변경·이동·삭제
      items/[id]           개발사항 상세·수집 조건
      items/[id]/stages    단계 상태 변경
      items/[id]/collect-request  수집 요청 메일 미리보기(GET)·발송(POST)
      items/[id]/mails     개발사항의 메일 이력
      mail/poll            메일 확인 (POST: 화면 버튼, GET ?secret=: 외부 크론)
      mail/status          모드·미분류 개수·마지막 확인 시각
      mails, mails/[id]    미분류함 목록 / 메일 보기·지정·무시·되돌리기
      settings             현재 config (비밀값은 설정 여부만)
      sim/inject           시뮬레이터 샘플 메일 넣기
      settings/test        Gmail·Gemini 연결 테스트
      items/[id]/review    L1 수집 회신 점검 (GET 상태, POST 실행) · reviews/[id] 추가 입력 저장
      items/[id]/prd       L2 PRD 생성
      items/[id]/share     공유 기본값(GET)·발송(POST) ?kind=prd|arch|qa|progress
      items/[id]/docs      Architecture/QA 등록 상태(GET)·등록(POST) · items/[id]/doc-review 검토 리포트 다시 생성
      items/[id]/manual-reply  수집 회신 직접 입력
      items/[id]/progress-request  진행상황 요청 메일 미리보기(GET)·발송(POST)
      items/[id]/progress  진행상황 기록·이력(GET), 다시 해석·직접 입력(POST)
      sim/scenario         전체 시나리오 1~7단계 자동 실행 (시뮬레이터 모드)
      demo/seed            전체 데이터 초기화 및 6개 단위서비스 시연 데이터 일괄 생성
      items/[id]/documents 문서 버전 목록·편집본 저장 · documents/[id] 원문(?download=1)
  components/              화면 컴포넌트 (Workspace, TreePanel, ItemDetail, Mail, MailInbox, Settings …)
  lib/
    auth.ts                더미 로그인과 HMAC 서명 쿠키
    demo/                  6개 단위서비스·라벨링·개발사항 카탈로그 및 1~7단계 실무형 산출물 빌더
    db/                    Drizzle 스키마, 연결(Neon/PGlite), SQL 마이그레이션
    domain/                단계 정의, 트리 배치 규칙, 메일 태그·파일명 규칙
    mail/                  메일 config·본문 작성·분류/매칭·Gmail SMTP/IMAP·시뮬레이터 샘플
    llm/                   Gemini REST, L1 점검·L2 PRD·L3 분류·L4/L5 대조의 프롬프트·스키마·검증, 모의 LLM, 작업별 실행기
    repo/                  DB 작업 (트리, 개발사항, 단계, 이력, 메일, 점검·PRD·문서 버전, Architecture/QA 등록·리포트·공유)
tests/                     Vitest (테스트 이름 앞의 TC ID는 docs/test/의 시험 문서와 같음)
```

## DB 마이그레이션

- `src/lib/db/migrations.ts`에 SQL을 순서대로 추가합니다. 이미 있는 항목은 수정하지 않습니다.
- 서버가 처음 DB에 접근할 때 아직 적용되지 않은 항목을 자동으로 적용합니다(`_migrations` 테이블에 기록).
- `schema.ts`(Drizzle 타입)와 SQL을 함께 고칩니다.

## Next.js 16 주의 사항

이 프로젝트는 Next.js 16을 씁니다. 코드를 바꾸기 전에 `node_modules/next/dist/docs/`의 문서를 확인하세요(`web/AGENTS.md` 참고).

- 미들웨어는 `proxy.ts`로 이름이 바뀌었습니다.
- 라우트의 `params`는 `await`해서 씁니다.
- Cache Components가 켜져 있으므로, DB를 읽는 GET 핸들러는 `await connection()`으로 시작합니다.
