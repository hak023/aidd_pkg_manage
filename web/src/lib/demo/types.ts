/**
 * 시연 데이터 카탈로그 타입 정의.
 * 실제 인물·실제 사내 메일·고객 정보를 포함하지 않으며 실무 문체로 구성한다.
 */

export interface PersonProfile {
  name: string;
  dept: string;
  role: "요청" | "결정" | "개발" | "운영" | "검증";
  email: string;
}

export interface LabelSpec {
  name: string;
  /** 상용 반영 기준일 (YYYY-MM-DD) */
  releaseDate: string;
  /** 개발 착수 기준일 (YYYY-MM-DD) */
  kickoffDate: string;
}

export interface ReqItem {
  id: string;
  title: string;
  criteria: string;
  priority: "상" | "중";
  archSection: string;
  qaTcId: string;
  qaStep: string;
  qaExpected: string;
}

export interface NonFuncItem {
  id: string;
  title: string;
  criteria: string;
  archSpec: string;
  archVerdict: "반영" | "부분";
  archNote: string;
}

export interface ItemBlueprint {
  title: string;
  keywords: string;
  searchPeriod: string;
  memo: string;
  background: string;
  currentIssue: string;
  goal: string;
  inScope: string;
  outOfScope: string;
  linkedSystem: string;
  securityOps: string;
  conflictIssue: string;
  conflictResolution: string;
  extraFollowUpQuestion: string;
  extraFollowUpAnswer: string;
  archOverview: string;
  archModules: string[];
  archFlow: string[];
  archExtraFeature: string;
  funcReqs: [ReqItem, ReqItem, ReqItem];
  nonFuncReqs: [NonFuncItem, NonFuncItem];
}

export interface ServiceCatalog {
  name: string;
  labels: [LabelSpec, LabelSpec, LabelSpec];
  vendorName: string;
  people: {
    requester: PersonProfile;
    pm: PersonProfile;
    vendorDev: PersonProfile;
    ops: PersonProfile;
    qa: PersonProfile;
  };
  items: ItemBlueprint[];
}
