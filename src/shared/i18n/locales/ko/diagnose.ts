export default {
  title: "구성 건강",
  description: "데스크톱의 구성 감사 (환경 변수, config.yaml, 모델). 채팅 실패의 일반적인 원인인 불일치를 표시하고 자동 적용이 안전한 경우 한 번의 클릭으로 수정합니다.",
  rerun: "감사 재실행",
  allGood: "문제가 감지되지 않았습니다. 구성이 일관되어 보입니다.",
  banner: {
    lead: "구성 문제가 감지되었습니다:",
    errors: "오류 {{count}}개",
    warnings: "경고 {{count}}개",
    infos: "참조 {{count}}개",
    showDetails: "세부정보 보기",
  },
  apiKeyBanner: {
    lead: "API 서버 키가 설정되지 않음 — 채팅이 실패합니다.",
    setNow: "지금 설정",
  },
  apiKeyModal: {
    title: "API 서버 키 설정",
    description: "API_SERVER_KEY는 허머스 게이트웨이가 요청을 인증하는 데 필요합니다. 채팅을 활성화하려면 지금 설정하세요.",
    label: "API 서버 키",
    placeholder: "sk-… 또는 임의의 비밀",
    autoGenerate: "자동 생성",
    hint: "자신만의 키를 붙여넣거나 무작위 UUID를 생성할 수 있습니다.",
  },
  fix: {
    apply: "수정 적용",
    running: "적용 중…",
    success: "수정이 적용되었습니다.",
    failure: "수정 실패.",
  },
} as const;
