export default {
  title: "구성 상태 점검",
  description:
    "데스크톱 구성(환경 변수, config.yaml, 모델)을 점검합니다. 채팅 실패의 흔한 원인인 불일치를 찾아내고, 자동으로 적용해도 안전한 항목은 클릭 한 번으로 고칠 수 있습니다.",
  rerun: "다시 점검",
  allGood: "발견된 문제가 없습니다. 구성이 일관됩니다.",
  banner: {
    lead: "구성 문제가 발견되었습니다:",
    errors: "오류 {{count}}개",
    warnings: "경고 {{count}}개",
    infos: "참고 {{count}}개",
    showDetails: "자세히 보기",
  },
  apiKeyBanner: {
    lead: "API 서버 키가 설정되지 않아 채팅이 실패합니다.",
    setNow: "지금 설정",
  },
  apiKeyModal: {
    title: "API 서버 키 설정",
    description:
      "Hermes 게이트웨이가 요청을 인증하려면 API_SERVER_KEY가 필요합니다. 채팅을 사용하려면 지금 설정하세요. 비밀값을 볼트(KeePassXC, Bitwarden 등)에 보관하고 Hermes의 `secrets.provider`가 이미 그 볼트를 가리키고 있다면 이 경고는 무시해도 됩니다. 제공자가 키를 직접 전달합니다.",
    label: "API 서버 키",
    placeholder: "sk-… 또는 임의의 비밀값",
    autoGenerate: "자동 생성",
    hint: "직접 키를 붙여넣거나 임의의 UUID를 생성할 수 있습니다.",
  },
  fix: {
    apply: "수정 적용",
    running: "적용 중…",
    success: "수정을 적용했습니다.",
    failure: "수정에 실패했습니다.",
  },
};
