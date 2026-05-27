export default {
  title: "도구",
  subtitle:
    "대화 중 에이전트가 사용할 수 있는 도구 묶음을 활성화/비활성화하세요",
  web: {
    label: "웹 검색",
    description: "웹을 검색하고 URL에서 내용을 추출합니다",
  },
  browser: {
    label: "브라우저",
    description: "웹 페이지를 탐색·클릭·입력하며 상호작용합니다",
  },
  terminal: {
    label: "터미널",
    description: "셸 명령과 스크립트를 실행합니다",
  },
  file: {
    label: "파일 작업",
    description: "파일을 읽기·쓰기·검색·관리합니다",
  },
  code_execution: {
    label: "코드 실행",
    description: "Python과 셸 코드를 직접 실행합니다",
  },
  vision: { label: "비전", description: "이미지와 시각 콘텐츠를 분석합니다" },
  image_gen: {
    label: "이미지 생성",
    description: "DALL-E 등으로 이미지를 생성합니다",
  },
  tts: {
    label: "텍스트 음성 변환",
    description: "텍스트를 음성으로 변환합니다",
  },
  skills: {
    label: "스킬",
    description: "재사용 가능한 스킬을 생성·관리·실행합니다",
  },
  memory: {
    label: "메모리",
    description: "지속 가능한 지식을 저장하고 회상합니다",
  },
  session_search: {
    label: "세션 검색",
    description: "지난 대화 전반을 검색합니다",
  },
  clarify: {
    label: "명확화 질문",
    description: "필요할 때 사용자에게 명확화를 요청합니다",
  },
  delegation: {
    label: "위임",
    description: "병렬 작업을 위해 서브 에이전트를 생성합니다",
  },
  cronjob: {
    label: "크론 작업",
    description: "예약된 작업을 만들고 관리합니다",
  },
  moa: {
    label: "에이전트 혼합",
    description: "여러 AI 모델을 함께 조율합니다",
  },
  todo: {
    label: "작업 계획",
    description: "복잡한 작업을 위한 할 일 목록을 만들고 관리합니다",
  },
  mcpServers: "MCP 서버",
  mcpDescription:
    "config.yaml에 구성된 Model Context Protocol 서버입니다. 터미널에서 <code>hermes mcp add/remove</code>로 관리하세요.",
  http: "HTTP",
  stdio: "stdio",
  disabled: "비활성",
} as const;
