"""시나리오 실행기 - Claude API를 호출하고 도구 호출을 캡처한다."""

from __future__ import annotations

import logging
from typing import Any

import anthropic

from .models import (
    ActualCall,
    Scenario,
    ScenarioResult,
    TokenUsage,
    Verdict,
)
from .tool_executor import ToolExecutor

logger = logging.getLogger(__name__)

# Task 도구의 subagent_type → agent 호출로 분류
_AGENT_TOOL = "Task"
_SKILL_TOOL = "Skill"


def _classify_call(tool_name: str, tool_input: dict[str, Any]) -> tuple[str, str]:
    """도구 호출을 (call_type, logical_name) 으로 분류.

    - Task 도구 → agent 호출, logical_name = subagent_type 또는 description
    - Skill 도구 → skill 호출, logical_name = skill 이름
    - 나머지 → tool 호출
    """
    if tool_name == _AGENT_TOOL:
        agent_type = tool_input.get("subagent_type", "unknown")
        return "agent", agent_type
    if tool_name == _SKILL_TOOL:
        skill_name = tool_input.get("skill", "unknown")
        return "skill", skill_name
    return "tool", tool_name


def _build_tools(scenario: Scenario) -> list[dict[str, Any]]:
    """시나리오의 ToolDefinition → Anthropic API tool 형식으로 변환."""
    return [
        {
            "name": t.name,
            "description": t.description,
            "input_schema": t.input_schema,
        }
        for t in scenario.tools
    ]


def _accumulate_usage(total: TokenUsage, usage: Any) -> TokenUsage:
    """API 응답의 usage를 누적."""
    return TokenUsage(
        input_tokens=total.input_tokens + getattr(usage, "input_tokens", 0),
        output_tokens=total.output_tokens + getattr(usage, "output_tokens", 0),
        cache_creation_input_tokens=(
            total.cache_creation_input_tokens
            + getattr(usage, "cache_creation_input_tokens", 0)
        ),
        cache_read_input_tokens=(
            total.cache_read_input_tokens
            + getattr(usage, "cache_read_input_tokens", 0)
        ),
    )


def _extract_tool_calls(
    response: Any, turn: int
) -> tuple[list[ActualCall], list[dict[str, Any]]]:
    """응답에서 tool_use 블록을 추출하고, tool_result 메시지를 생성."""
    calls: list[ActualCall] = []
    tool_results: list[dict[str, Any]] = []

    for block in response.content:
        if block.type == "tool_use":
            call_type, logical_name = _classify_call(block.name, block.input)
            calls.append(ActualCall(
                name=logical_name,
                call_type=call_type,
                input=block.input,
                turn=turn,
            ))
            # 더미 tool_result 생성 (실제 실행 없이 시뮬레이션)
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": "[harness] simulated tool result",
            })

    return calls, tool_results


class ScenarioRunner:
    """시나리오를 Claude API에 실행하고 결과를 수집."""

    def __init__(
        self,
        client: anthropic.Anthropic | None = None,
        tool_results_provider: dict[str, str] | None = None,
        tool_executor: ToolExecutor | None = None,
    ):
        self._client = client or anthropic.Anthropic()
        self._tool_results = tool_results_provider or {}
        self._tool_executor = tool_executor

    def _get_tool_result(self, tool_name: str, tool_input: dict) -> str:
        """도구 실행 결과를 반환.

        우선순위:
        1. ToolExecutor가 있으면 실제 실행
        2. tool_results_provider에 커스텀 결과가 있으면 사용
        3. 기본 시뮬레이션 결과
        """
        if self._tool_executor:
            return self._tool_executor.execute(tool_name, tool_input)
        if tool_name in self._tool_results:
            return self._tool_results[tool_name]
        return "[harness] simulated tool result"

    def run(self, scenario: Scenario) -> ScenarioResult:
        """시나리오를 실행하고 결과를 반환."""
        result = ScenarioResult(scenario_name=scenario.name)
        messages: list[dict[str, Any]] = list(scenario.messages)
        tools = _build_tools(scenario)
        token_usage = TokenUsage()
        max_turns = scenario.context_budget.max_turns or 10

        try:
            for turn in range(max_turns):
                kwargs: dict[str, Any] = {
                    "model": scenario.model,
                    "max_tokens": scenario.max_tokens,
                    "messages": messages,
                }
                if scenario.system_prompt:
                    kwargs["system"] = scenario.system_prompt
                if tools:
                    kwargs["tools"] = tools

                response = self._client.messages.create(**kwargs)
                token_usage = _accumulate_usage(token_usage, response.usage)
                result.raw_responses.append({
                    "turn": turn,
                    "stop_reason": response.stop_reason,
                    "usage": {
                        "input_tokens": response.usage.input_tokens,
                        "output_tokens": response.usage.output_tokens,
                    },
                })

                calls, tool_results = _extract_tool_calls(response, turn)
                result.actual_calls.extend(calls)

                # stop_reason이 tool_use가 아니면 종료
                if response.stop_reason != "tool_use":
                    result.turns = turn + 1
                    break

                # 도구 호출 결과를 대화에 추가하고 다음 턴 진행
                messages.append({"role": "assistant", "content": response.content})
                tool_result_contents = []
                for block in response.content:
                    if block.type == "tool_use":
                        tool_result_contents.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": self._get_tool_result(
                                block.name, block.input
                            ),
                        })
                messages.append({"role": "user", "content": tool_result_contents})
            else:
                result.turns = max_turns

            result.token_usage = token_usage

        except Exception as e:
            logger.exception("시나리오 실행 중 오류: %s", scenario.name)
            result.verdict = Verdict.ERROR
            result.error = str(e)

        return result
