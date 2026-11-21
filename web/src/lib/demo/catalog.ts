import { CATALOG_IN, expandItem } from "./catalog-in";
import { EXTRA_IN_1588, EXTRA_IN_RINGO_VIDEO, EXTRA_IN_RINGO_VOICE } from "./catalog-in-extra";
import { EXTRA_IN_RINGO_VIDEO_MORE, SERVICE_AI_ASSISTANT } from "./catalog-ai-1";
import { EXTRA_AI_ASSISTANT_MORE, SERVICE_080_AS } from "./catalog-080";
import { EXTRA_080_MORE, SERVICE_MODOO_AI } from "./catalog-modoo";
import type { ServiceCatalog } from "./types";

const EXTRA_MODOO_MORE = [
  expandItem({
    title: "모바일 사내업무 앱 음성 질의(STT)·요약 브리핑 핸즈프리 모드 개발",
    keywords: "모두의AI, 모바일음성질의, 핸즈프리브리핑, 이동중업무, 단말보안",
    memo: "외근·출장 이동 중 모바일 사내앱에서 음성으로 규정·보고서를 질의하고 요약 청취",
    background: "현장 점검 및 외근 비중이 높은 영업·운용 직군이 이동 중 작은 모바일 자판으로 긴 질문을 치기 어려워 음성 질의·청취 모드를 요청함.",
    currentIssue: "모바일 웹 화면에서 텍스트 입력 위주로만 동작하고 긴 표·문서 답변을 귀로 듣기 좋게 구어체 브리핑으로 요약해 주는 기능이 없음.",
    goal: "모바일 앱 내 원터치 음성 질문 인식과 핵심 3문장 구어체 요약 TTS 브리핑 모드를 제공해 외근 직군 활용성 강화.",
    inScope: "모바일 웹오디오/네이티브 브릿지 STT 입력, 장문 답변 3문장 음성 브리핑 변환, 이어폰 연결 해제 시 자동 일시정지 보호",
    outOfScope: "차량 인포테인먼트 전용 별도 스토어 앱 출시",
    linkedSystem: "모바일 사내업무 앱, 모두의AI 스트리밍 STT·TTS 서버, 모바일 MDM 인증 게이트웨이",
    securityOps: "공공장소 음성 유출 방지를 위해 블루투스·유선 이어폰 미연결 상태에서는 스피커폰 자동 재생을 막고 화면 탭 확인 후 재생.",
    conflictIssue: "음성 질문 녹음 오디오 원본 서버 보관 여부",
    conflictResolution: "사내 보안 원칙에 따라 음성 패킷은 메모리에서 STT 텍스트로 변환 즉시 폐기하고 텍스트 대화 이력만 일반 정책대로 관리",
    extraQ: "현장 소음이 심한 통신 국사·기계실에서도 전문 약어 인식이 잘 됩니까?",
    extraA: "통신·네트워크 사내 기술 약어(SBC, MRF, OIDC, CDR 등) 바이어싱 사전을 결합해 약어 오변환을 최소화합니다.",
    archOverview: "모바일 MDM 인증 세션에서 인메모리 STT 변환과 사내 약어 보정을 수행하고 이어폰 상태 연동 구어체 요약 브리핑을 송출한다.",
    archModules: ["사내 기술약어 보정 모바일 STT기", "장문 답변 3문장 브리핑 변환기", "출력 오디오 기기 보안 가드"],
    archFlow: [
      "모바일 음성 입력 스트림을 인메모리 STT 변환 후 오디오 버퍼 즉시 소거",
      "RAG·LLM 상세 답변 생성과 동시에 음성 청취용 3문장 요약문 추출",
      "이어폰 연결 여부 확인(미연결 시 수동 재생 확인) 후 스트리밍 TTS 재생",
      "재생 중 이어폰 분리 이벤트 감지 시 즉시 오디오 송출 일시정지",
    ],
    archExtra: "이전 답변·다음 핵심 항목으로 넘기는 모바일 잠금화면 미디어 컨트롤 연동",
    fr1: ["사내 기술약어 보정 음성 질의 인식 및 오디오 원본 즉시 메모리 소거", "음성 파일 디스크 적재 0건 및 주요 사내 약어 인식률 93% 이상"],
    fr2: ["상세 텍스트 답변과 별도 3문장 구어체 요약 TTS 브리핑 제공", "표·목록 포함 답변도 기호 낭독 없이 자연스러운 20초 내외 브리핑 재생"],
    fr3: ["이어폰 미연결 시 자동 스피커 출력 차단 및 분리 즉시 일시정지", "이어폰 해제 즉시 100ms 이내 재생 정지 동작"],
    nfr1: ["음성 발화 종료부터 첫 브리핑 음성 재생까지 지연", "2.5초 이내 브리핑 시작", "첫 문장 선행 합성 파이프라인으로 평균 1.6초 개시"],
    nfr2: ["모바일 지하철·이동 구간 네트워크 순단 재연결", "일시 끊김 시 기생성 텍스트 답변 유실 없이 화면 복구", "웹소켓 끊김 시 응답 전체 취소로 작성됨", "이동 중 셀 핸드오버가 잦으므로 마지막 수신 오프셋 기준 재연결(Resume) 버퍼를 설계에 추가해야 함"],
  }),
];

/**
 * 시연용 6개 단위서비스 전체 카탈로그.
 * 각 단위서비스는 라벨링 3개와 고유 개발사항 설계 원본 12개를 가진다.
 */
export const DEMO_CATALOG: ServiceCatalog[] = [
  {
    ...CATALOG_IN[0], // 전국대표번호
    items: [...CATALOG_IN[0].items, ...EXTRA_IN_1588],
  },
  {
    ...CATALOG_IN[1], // 음성링고
    items: [...CATALOG_IN[1].items, ...EXTRA_IN_RINGO_VOICE],
  },
  {
    ...CATALOG_IN[2], // 영상링고
    items: [...CATALOG_IN[2].items, ...EXTRA_IN_RINGO_VIDEO, ...EXTRA_IN_RINGO_VIDEO_MORE],
  },
  {
    ...SERVICE_AI_ASSISTANT, // AI통화비서
    items: [...SERVICE_AI_ASSISTANT.items, ...EXTRA_AI_ASSISTANT_MORE],
  },
  {
    ...SERVICE_080_AS, // 080착신형AS
    items: [...SERVICE_080_AS.items, ...EXTRA_080_MORE],
  },
  {
    ...SERVICE_MODOO_AI, // 모두의AI
    items: [...SERVICE_MODOO_AI.items, ...EXTRA_MODOO_MORE],
  },
];
