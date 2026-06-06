# hermes-desktop 한국어 현지화 계획

## 개요
hermes-desktop Electron 앱의 UI를 한국어로 현지화한다.

## 기술 스택
- **i18n 라이브러리**: i18next + react-i18next
- **기존 로케일**: `src/shared/i18n/locales/` (현재 영어만)
- **타입스크립트**: `src/renderer/src/env.d.ts`에서 i18n 타입 정의

## 작업 단계

### Phase 1: i18n 설정 및 한국어 파일 생성
- [ ] `src/shared/i18n/locales/ko.json` 파일 생성
- [ ] `src/shared/i18n/index.ts`에서 한국어 지원 추가
- [ ] `package.json`에 `ko` 로케일 정보 추가
- [ ] 언어 선택 UI에 한국어 옵션 추가

### Phase 2: 화면별 번역
- [ ] Chat 화면 번역
- [ ] Settings 화면 번역
- [ ] Install/Setup 화면 번역
- [ ] Discover/Models 화면 번역
- [ ] Memory 화면 번역
- [ ] Office 화면 번역
- [ ] Agents/Skills/Tools 화면 번역
- [ ] Sessions/Kanban 화면 번역
- [ ] Providers 화면 번역
- [ ] Welcome/SplashScreen 화면 번역

### Phase 3: 글로벌 텍스트
- [ ] 에러/경고 메시지 번역
- [ ] 토스트 알림 메시지 번역
- [ ] 로딩 상태 텍스트 번역
- [ ] 빈 상태(Empty State) 메시지 번역

### Phase 4: README-KO.md 생성
- [ ] README.md를 한국어로 번역하여 README-KO.md 생성
- [ ] 설치 방법, 사용법, 기여 가이드 포함

### Phase 5: 테스트 및 검증
- [ ] `npm test`로 기존 테스트 통과 확인
- [ ] 한국어 로케일에서 UI 렌더링 테스트
- [ ] 텍스트 오버플로우, 자간, 줄바꿈 확인
- [ ] 언어 전환 시 상태 유지 확인

## 번역 원칙
- 어조: 존댓말(하십시오체)
- 기술 용어: 기존 한자어/외래어 유지
- 유지보수: ko.json은 영어 원문을 주석으로 포함
- 확장성: 새 키 추가 시 영어/한국어 동시 업데이트

## 예상 기간
- Phase 1: 1시간
- Phase 2: 4-6시간
- Phase 3: 1시간
- Phase 4: 1시간
- Phase 5: 1시간
- **총: 8-10시간**

## 출력물
- `src/shared/i18n/locales/ko.json` — 한국어 번역 파일
- `src/shared/i18n/index.ts` — 한국어 지원 추가
- `README-KO.md` — 한국어 README
- `package.json` — 로케일 메타데이터 업데이트
