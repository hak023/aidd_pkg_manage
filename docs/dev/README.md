# 개발 진행 현황

기능 기준: [서비스 정의 v0.2](../proposals/2026-11-21_AX_AIDD-서비스-정의-v0.2.md) 10장 · 문서 규칙: [AGENTS.md](../../AGENTS.md) 3장 · 시험 체계: [docs/test/README.md](../test/README.md)

| 단계 | 상태 | 범위 (요약) | 설계 | 시험 |
|---|---|---|---|---|
| P0 사전 검증 | 일부 | 계정 준비 완료, 로컬 Gmail SMTP·IMAP 로그인 확인. Gmail ↔ 회사 메일 송수신과 Copilot 회신 품질은 미확인 | — | — |
| P1 기반 | 완료 (배포 대기) | 더미 로그인, 트리(드래그), 7단계 진행 그래프, 대시보드, DB(Neon/PGlite) | [P1_기반.md](P1_기반.md) | [P1_시험.md](../test/P1_시험.md) |
| P2 메일 | 완료 (Gmail 로그인 확인, 실제 송수신 시험 대기) | 수집 요청 발송, 수신 확인(버튼·자동·크론), 태그 매칭, 미분류함, 시뮬레이터, 연결 테스트 | [P2_메일.md](P2_메일.md) | [P2_시험.md](../test/P2_시험.md) |
| P3 수집·PRD | 완료 (사용자 시험 대기) | L1 회신 점검, 추가 입력, L2 PRD 생성, md 편집·버전, PRD 공유 메일 | [P3_수집-PRD.md](P3_수집-PRD.md) | [P3_시험.md](../test/P3_시험.md) |
| P4 Architecture·QA | 완료 (사용자 시험 대기) | L3 분류, 문서 등록, L4·L5 검토 리포트, 편집·재등록, 공유, 회신·문서 직접 입력 | [P4_Architecture-QA.md](P4_Architecture-QA.md) | [P4_시험.md](../test/P4_시험.md) |
| P5 진행상황·완료 | 완료 (사용자 시험 대기) | 진행상황 요청, L6 해석(규칙 우선), 마일스톤 표·이력, 공유, 완료, 대시보드 상용적용 열, 전체 시나리오 실행 | [P5_진행상황-완료.md](P5_진행상황-완료.md) | [P5_시험.md](../test/P5_시험.md) |
| **배포** | **다음** | GitHub main push 완료, Vercel + Neon 배포, 배포 환경에서 Gmail 확인 | [배포 가이드](../guides/배포-가이드.md) | — |

## 남은 일 (단계 밖)

- Gmail 실제 발송·회신 수신 및 Copilot 회신 품질 확인
- Neon(`DATABASE_URL`) 경로는 배포 때 처음 확인
