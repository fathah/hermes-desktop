export default {
  title: "칸반",
  subtitle:
    "에이전트가 스스로 집어 처리할 작업을 위한 견고한 멀티 에이전트 보드입니다.",

  // Header actions
  refresh: "새로고침",
  refreshTooltip: "에이전트에서 보드와 작업을 다시 불러옵니다",
  dispatch: "디스패치",
  dispatchTooltip:
    "디스패처를 한 번 실행 — 준비된 작업을 승격하고 워커를 생성합니다",
  newTask: "새 작업",
  newTaskTooltip: "현재 보드에 새 작업을 생성합니다",
  newBoard: "새 보드",
  newBoardTooltip: "새 칸반 보드를 생성합니다",

  // Remote-mode unsupported notice
  remoteUnsupportedTitle:
    "칸반은 로컬 Hermes 설치 또는 SSH 터널 모드가 필요합니다.",
  remoteUnsupportedHint:
    "단순 원격(HTTP + API 키) 모드는 아직 칸반 API를 노출하지 않습니다. 보드를 관리하려면 설정에서 로컬 또는 SSH 터널 모드로 전환하세요.",

  // Column / task statuses
  status: {
    triage: "분류",
    todo: "할 일",
    ready: "준비",
    running: "실행 중",
    blocked: "차단됨",
    done: "완료",
  },

  // Card action tooltips
  cardSpecify: "구체화 (스펙 확장 → 할 일)",
  cardMarkDone: "완료 표시",
  cardReclaim: "워커 회수",
  cardUnblock: "차단 해제",
  cardBlock: "차단",
  cardArchive: "보관",

  // Create-task modal
  createTitle: "새 칸반 작업",
  fieldTitle: "제목",
  titlePlaceholder: "무엇을 해야 하나요?",
  fieldBody: "본문 (선택)",
  bodyPlaceholder: "컨텍스트, 인수 기준, 링크…",
  fieldAssignee: "담당 프로필",
  assigneeNone: "— 분류 (담당 없음)",
  fieldPriority: "우선순위",
  priorityNormal: "보통 (0)",
  priorityLow: "낮음 (P2)",
  priorityHigh: "높음 (P1)",
  priorityUrgent: "긴급 (P0)",
  fieldWorkspace: "워크스페이스",
  workspaceScratch: "스크래치 (임시 디렉터리)",
  workspaceWorktree: "워크트리 (현재 저장소)",
  workspaceChoose: "폴더 선택…",
  workspaceNoFolder: "폴더가 선택되지 않음",
  browse: "찾아보기…",
  triageCheckbox: "분류에 보관 (specifier가 스펙을 확장한 뒤 할 일로 승격)",
  create: "작업 생성",
  creating: "생성 중…",

  // New-board modal
  newBoardTitle: "새 보드",
  fieldSlug: "Slug",
  slugPlaceholder: "케밥 케이스, 예: atm10-server",
  fieldDisplayName: "표시 이름 (선택)",
  displayNamePlaceholder: "ATM10 Server",
  createBoard: "보드 생성",

  // Task-detail modal
  detailFallbackTitle: "작업",
  detailBody: "본문",
  detailSummary: "최근 실행 요약",
  detailResult: "결과",
  detailComments: "댓글 ({{count}})",
  detailEvents: "이벤트 ({{count}})",
  commentAnon: "익명",

  // Prompts / confirmations
  blockReasonPrompt: "차단 사유는?",
  confirmMarkDone: '"{{title}}"을(를) 완료로 표시할까요?',
  confirmArchive: '"{{title}}"을(를) 보관할까요?',

  // Errors
  moveNotAllowed:
    "데스크톱에서 {{from}} → {{to}} 이동은 허용되지 않습니다. 에이전트나 CLI를 사용하세요.",
  errLoadBoards: "보드를 불러오지 못했습니다",
  errLoadTasks: "작업을 불러오지 못했습니다",
  errMoveTask: "작업 이동 실패",
  errPickFolder: "먼저 워크스페이스 폴더를 선택하세요.",
  errCreateTask: "작업 생성 실패",
  errSwitchBoard: "보드 전환 실패",
  errCreateBoard: "보드 생성 실패",
  errSpecify: "작업 구체화 실패",
  errArchive: "작업 보관 실패",
  errReclaim: "회수 실패",
  errDispatch: "디스패치 실패",
  hqBoardTooltip: "Claw3D 본부 보드 (읽기 전용 미러)",
  hqReadOnlyBanner:
    "Claw3D 본부 보드의 읽기 전용 미러입니다. 여기서 한 수정은 동기화되지 않으니, 본부 작업은 오피스 화면에서 관리하세요.",
  columnEmpty: "—",
  cardReadOnly: "읽기 전용",
  assigneeAriaLabel: "담당 프로필",
  priorityAriaLabel: "우선순위",
  workspaceAriaLabel: "워크스페이스",
  closeDetailsTitle: "작업 세부 정보 닫기",
  dismissError: "오류 닫기",
} as const;
