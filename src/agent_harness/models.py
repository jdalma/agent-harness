"""시나리오, 결과, 토큰 사용량 등 핵심 데이터 모델."""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class ToolDefinition(BaseModel):
    """Claude API에 전달할 도구 정의."""

    name: str
    description: str
    input_schema: dict[str, Any] = Field(default_factory=lambda: {
        "type": "object",
        "properties": {},
    })


class ExpectedCall(BaseModel):
    """기대하는 도구/에이전트/스킬 호출."""

    name: str
    call_type: str = "tool"  # "tool" | "agent" | "skill"
    required: bool = True  # True면 반드시 호출되어야 함
    args_contain: dict[str, Any] | None = None  # 인자에 포함되어야 하는 값


class ForbiddenCall(BaseModel):
    """호출되면 안 되는 도구/에이전트/스킬."""

    name: str
    call_type: str = "tool"
    reason: str = ""


class ContextBudget(BaseModel):
    """컨텍스트 윈도우 사용 제한."""

    max_input_tokens: int | None = None
    max_output_tokens: int | None = None
    max_total_tokens: int | None = None
    max_turns: int | None = None  # 최대 대화 턴 수


class Scenario(BaseModel):
    """하나의 테스트 시나리오."""

    name: str
    description: str = ""
    system_prompt: str = ""
    tools: list[ToolDefinition] = Field(default_factory=list)
    messages: list[dict[str, Any]] = Field(default_factory=list)
    expected_calls: list[ExpectedCall] = Field(default_factory=list)
    forbidden_calls: list[ForbiddenCall] = Field(default_factory=list)
    context_budget: ContextBudget = Field(default_factory=ContextBudget)
    model: str = "claude-sonnet-4-20250514"
    max_tokens: int = 4096
    tags: list[str] = Field(default_factory=list)
    # 실제 프로젝트 연동
    project_path: str | None = None  # 프로젝트 디렉토리 경로
    execute_tools: bool = False  # True면 실제 도구 실행, False면 시뮬레이션


# ── 실행 결과 모델 ──


class TokenUsage(BaseModel):
    """API 응답에서 추출한 토큰 사용량."""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    @property
    def cache_hit_rate(self) -> float:
        total_input = self.input_tokens + self.cache_read_input_tokens
        if total_input == 0:
            return 0.0
        return self.cache_read_input_tokens / total_input


class ActualCall(BaseModel):
    """실제로 발생한 도구 호출."""

    name: str
    call_type: str = "tool"
    input: dict[str, Any] = Field(default_factory=dict)
    turn: int = 0  # 몇 번째 턴에서 호출되었는지


class Verdict(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    ERROR = "error"


class ValidationFailure(BaseModel):
    """검증 실패 상세."""

    rule: str  # e.g. "expected_call", "forbidden_call", "context_budget"
    message: str
    expected: Any = None
    actual: Any = None


class ScenarioResult(BaseModel):
    """시나리오 실행 + 검증 결과."""

    scenario_name: str
    verdict: Verdict = Verdict.PASS
    actual_calls: list[ActualCall] = Field(default_factory=list)
    token_usage: TokenUsage = Field(default_factory=TokenUsage)
    turns: int = 0
    failures: list[ValidationFailure] = Field(default_factory=list)
    error: str | None = None
    raw_responses: list[dict[str, Any]] = Field(default_factory=list)
