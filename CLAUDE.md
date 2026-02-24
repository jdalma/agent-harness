# CLAUDE.md

## Project Overview

Tamburins 이커머스

| 모듈 | 기술 | 설명 |
|------|------|------|
| `tamburins-backend/` | Java, Spring Boot, Gradle | ecom 백엔드 (base: `com.iicombined.ecom`) |
| `tamburins-oms-backend/` | Java, Spring Boot, Gradle | OMS 백엔드 (base: `com.iicombined.oms`) |
| `tam-admin-front/` | React 18, TypeScript | Admin 프론트엔드 (port 8988) |
| `tam-oms-front/` | React 18, TypeScript | OMS 프론트엔드 (port 8990) |
## Domain Context System

이 프로젝트는 `.claude/domain/`에 도메인 비즈니스 컨텍스트가 구축되어 있다.
15개 도메인 에이전트가 `.claude/agents/`에 정의되어 있으며, description이 시스템 프롬프트에 자동 로드된다.

### 자동 라우팅 규칙

**비즈니스 도메인에 대한 질문, 분석, 코드 작업 시** 아래 절차를 따른다:

1. 사용자 요청과 도메인 에이전트 description을 대조하여 관련 도메인을 식별한다 (에이전트 description은 `.claude/agents/`에서 자동 로드됨)
2. 관련 도메인이 식별되면 **반드시 스킬 또는 에이전트를 경유**하여 컨텍스트에 접근한다 (직접 Read 금지)
3. 복수 도메인이 관련되면 domain-orchestrator에게 위임한다 (팀즈 기반 오케스트레이션)

**도메인 지식에 직접 접근하지 않는다** — 모든 접근은 스킬 또는 에이전트를 경유한다.

### 라우팅 모드

- 관련 에이전트 **1개** → **스킬 경유** (`/domain:ask` 절차에 따라 컨텍스트 로드 + 답변)
- 관련 에이전트 **2개+** → **오케스트레이터 위임** (domain-orchestrator가 팀즈로 도메인 에이전트 오케스트레이션)
- 영향 분석/범위 산정 → **전용 스킬** (`/domain:impact`, `/domain:scope`)
- 매칭 불가 → 도메인 목록 표시 후 사용자에게 선택 요청

### 복수 도메인 판별 패턴

- "A와 B": 명시적 복수 도메인
- "A에서 B로": 도메인 간 흐름
- "A 후 B": 순차적 도메인 관계
- 하나의 도메인 dependencies.md에서 다른 도메인이 핵심 의존인 경우

### 라우팅 대상 판별

다음 상황에서 자동 라우팅한다:
- 도메인 비즈니스 로직 질문 (예: "주문 취소 조건", "결제 환불 플로우")
- 코드 수정/추가 시 관련 도메인 파악 (예: "SalesOrder에 필드 추가")
- 영향 분석 또는 범위 산정

다음 상황에서는 라우팅하지 않는다:
- 빌드/배포/설정 관련 작업
- 일반적인 프로그래밍 질문

### 도메인 레지스트리

#### Tier 1: 핵심 도메인

| 에이전트 | 키워드 | 컨텍스트 경로 |
|---------|--------|-------------|
| order | 주문, 취소, 반품, 장바구니, 배송 | order/ |
| payment | 결제, 환불, PG, PortOne, Stripe | payment/ |
| inventory | 재고, 입출고, 예약, 캐시 | inventory/ |
| product | 상품, 카탈로그, SKU, 번들, 옵션 | product/ |
| promotion | 프로모션, 쿠폰, 할인, GWP, CartPriceRule | promotion/ |
| member | 회원, 관리자, 권한, 그룹 | member/ |

#### Tier 2: 보조 도메인

| 에이전트 | 키워드 | 컨텍스트 경로 |
|---------|--------|-------------|
| content | FAQ, 공지, 배너, 키워드 | content/ |
| customer-support | CS, 상담, 이벤트 예약, CTI | customer-support/ |
| integration | Salesforce, 레거시, 동기화, Maersk | integration/ |
| channel | 채널, 셀러, 매핑, 멀티채널 | channel/ |
| qna | Q&A, 질문, 답변, Shoplinker | qna/ |
| oms-settings | OMS 설정, OMS 관리자, OMS 그룹, OMS 메뉴, 국가 | oms-settings/ |
| oms-log | 감사 로그, 액션 추적, 변경 이력 | oms-log/ |
| admin-front | Admin 화면, 관리자 UI, 어드민 페이지 | admin-front/ |
| oms-front | OMS 화면, OMS UI, OMS 페이지 | oms-front/ |

### 스킬 (명시적 호출)

| 스킬 | 용도 |
|------|------|
| `/domain:ask` | 도메인 질문 답변 (단일 도메인 라우팅의 기본 경로) |
| `/domain:impact` | 변경 영향 분석 (항상 에이전트 모드) |
| `/domain:scope` | 작업 범위 산정 (WBS) |
| `/domain:scan` | 코드 분석 → 컨텍스트 갱신 |
| `/domain:init` | 새 도메인 에이전트 생성 |
