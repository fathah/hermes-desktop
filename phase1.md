# Phase 1: i18n 설정 및 한국어 파일 생성

## 목표
- `src/shared/i18n/locales/ko.json` 파일 생성
- `src/shared/i18n/index.ts`에서 한국어 지원 추가
- `package.json`에 `ko` 로케일 정보 추가
- 언어 선택 UI에 한국어 옵션 추가

## 진행 기록

### 1. 기존 영어 파일 분석
- 파일 위치: `src/shared/i18n/locales/en.json`
- 전체 키 수: TBD (분석 후 기록)
- 주요 네임스페이스: common, chat, settings, install, memory, office, agents, skills, tools, sessions, kanban, providers, welcome, setup, discover, models, layout, screens

### 2. 한국어 파일 생성
- 파일: `src/shared/i18n/locales/ko.json`
- 번역 원칙: 존댓말(하십시오체), 기술 용어는 기존 한자어/외래어 유지

### 3. i18n 설정 수정
- `src/shared/i18n/index.ts`에 `ko` 로케일 추가
- 기본 로케일: `en`, 지원 로케일: `['en', 'ko']`

### 4. 언어 선택 UI 수정
- `ProfileSwitcher.tsx` 또는 설정에서 언어 선택 옵션에 `ko` 추가

## 결과
- [ ] ko.json 생성 완료
- [ ] i18n 설정 수정 완료
- [ ] 언어 선택 UI 수정 완료

## 비고
