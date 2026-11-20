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

## 스크립트

| 명령 | 내용 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` / `npm start` | 운영 빌드 / 실행 |
| `npm test` | 단위·저장소 테스트 (Vitest + 메모리 PGlite) |
| `npm run typecheck` | Next 라우트 타입 생성 후 TypeScript 검사 |
| `npm run lint` | ESLint |

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
  components/              화면 컴포넌트 (Workspace, TreePanel, ItemDetail …)
  lib/
    auth.ts                더미 로그인과 HMAC 서명 쿠키
    db/                    Drizzle 스키마, 연결(Neon/PGlite), SQL 마이그레이션
    domain/                단계 정의, 트리 배치 규칙, 메일 태그·파일명 규칙
    repo/                  DB 작업 (트리, 개발사항, 단계, 이력)
tests/                     Vitest
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
