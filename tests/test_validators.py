"""검증기 단위 테스트 - API 호출 없이 로직만 검증."""

from __future__ import annotations

from agent_harness.models import (
    ActualCall,
    ContextBudget,
    ExpectedCall,
    ForbiddenCall,
    Scenario,
    ScenarioResult,
    TokenUsage,
    Verdict,
)
from agent_harness.validators import (
    validate,
    validate_call_order,
    validate_context_budget,
    validate_expected_calls,
    validate_forbidden_calls,
    validate_no_redundant_calls,
)


def _make_scenario(**kwargs) -> Scenario:
    defaults = {"name": "test", "messages": [{"role": "user", "content": "hello"}]}
    defaults.update(kwargs)
    return Scenario(**defaults)


def _make_result(**kwargs) -> ScenarioResult:
    defaults = {"scenario_name": "test"}
    defaults.update(kwargs)
    return ScenarioResult(**defaults)


# ── expected_calls 검증 ──


class TestExpectedCalls:
    def test_pass_when_tool_called(self):
        scenario = _make_scenario(expected_calls=[
            ExpectedCall(name="Read", call_type="tool", required=True),
        ])
        result = _make_result(actual_calls=[
            ActualCall(name="Read", call_type="tool", input={"file_path": "a.py"}),
        ])
        failures = validate_expected_calls(scenario, result)
        assert len(failures) == 0

    def test_fail_when_required_tool_missing(self):
        scenario = _make_scenario(expected_calls=[
            ExpectedCall(name="Read", call_type="tool", required=True),
        ])
        result = _make_result(actual_calls=[
            ActualCall(name="Grep", call_type="tool"),
        ])
        failures = validate_expected_calls(scenario, result)
        assert len(failures) == 1
        assert "Read" in failures[0].message

    def test_pass_when_agent_called(self):
        scenario = _make_scenario(expected_calls=[
            ExpectedCall(name="Explore", call_type="agent", required=True),
        ])
        result = _make_result(actual_calls=[
            ActualCall(name="Explore", call_type="agent", input={"prompt": "..."}),
        ])
        failures = validate_expected_calls(scenario, result)
        assert len(failures) == 0

    def test_pass_when_args_contain_match(self):
        scenario = _make_scenario(expected_calls=[
            ExpectedCall(
                name="Read", call_type="tool", required=True,
                args_contain={"file_path": "src/main.py"},
            ),
        ])
        result = _make_result(actual_calls=[
            ActualCall(
                name="Read", call_type="tool",
                input={"file_path": "src/main.py", "limit": 100},
            ),
        ])
        failures = validate_expected_calls(scenario, result)
        assert len(failures) == 0

    def test_fail_when_args_mismatch(self):
        scenario = _make_scenario(expected_calls=[
            ExpectedCall(
                name="Read", call_type="tool", required=True,
                args_contain={"file_path": "src/main.py"},
            ),
        ])
        result = _make_result(actual_calls=[
            ActualCall(
                name="Read", call_type="tool",
                input={"file_path": "src/other.py"},
            ),
        ])
        failures = validate_expected_calls(scenario, result)
        assert len(failures) == 1

    def test_skip_optional(self):
        scenario = _make_scenario(expected_calls=[
            ExpectedCall(name="Grep", call_type="tool", required=False),
        ])
        result = _make_result(actual_calls=[])
        failures = validate_expected_calls(scenario, result)
        assert len(failures) == 0


# ── forbidden_calls 검증 ──


class TestForbiddenCalls:
    def test_pass_when_forbidden_not_called(self):
        scenario = _make_scenario(forbidden_calls=[
            ForbiddenCall(name="Write", call_type="tool", reason="읽기 전용"),
        ])
        result = _make_result(actual_calls=[
            ActualCall(name="Read", call_type="tool"),
        ])
        failures = validate_forbidden_calls(scenario, result)
        assert len(failures) == 0

    def test_fail_when_forbidden_called(self):
        scenario = _make_scenario(forbidden_calls=[
            ForbiddenCall(name="Write", call_type="tool", reason="읽기 전용"),
        ])
        result = _make_result(actual_calls=[
            ActualCall(name="Write", call_type="tool"),
        ])
        failures = validate_forbidden_calls(scenario, result)
        assert len(failures) == 1
        assert "읽기 전용" in failures[0].message


# ── call_order 검증 ──


class TestCallOrder:
    def test_pass_correct_order(self):
        result = _make_result(actual_calls=[
            ActualCall(name="Read", call_type="tool", turn=0),
            ActualCall(name="Grep", call_type="tool", turn=1),
            ActualCall(name="Edit", call_type="tool", turn=2),
        ])
        failures = validate_call_order(["Read", "Grep", "Edit"], result)
        assert len(failures) == 0

    def test_fail_wrong_order(self):
        result = _make_result(actual_calls=[
            ActualCall(name="Edit", call_type="tool", turn=0),
            ActualCall(name="Read", call_type="tool", turn=1),
        ])
        failures = validate_call_order(["Read", "Edit"], result)
        # Read는 찾지만 Edit이 Read 다음에 와야 하는데 먼저 나옴
        # 실제로는 Read(인덱스1) → Edit을 찾아야 하는데 Edit(인덱스0)은 Read(1) 이전이라 실패
        assert len(failures) == 1


# ── context_budget 검증 ──


class TestContextBudget:
    def test_pass_within_budget(self):
        scenario = _make_scenario(
            context_budget=ContextBudget(max_total_tokens=10000, max_turns=5),
        )
        result = _make_result(
            token_usage=TokenUsage(input_tokens=3000, output_tokens=1000),
            turns=2,
        )
        failures = validate_context_budget(scenario, result)
        assert len(failures) == 0

    def test_fail_token_exceeded(self):
        scenario = _make_scenario(
            context_budget=ContextBudget(max_total_tokens=5000),
        )
        result = _make_result(
            token_usage=TokenUsage(input_tokens=4000, output_tokens=2000),
        )
        failures = validate_context_budget(scenario, result)
        assert len(failures) == 1
        assert "토큰 예산 초과" in failures[0].message

    def test_fail_turns_exceeded(self):
        scenario = _make_scenario(
            context_budget=ContextBudget(max_turns=3),
        )
        result = _make_result(turns=5)
        failures = validate_context_budget(scenario, result)
        assert len(failures) == 1


# ── redundant_calls 검증 ──


class TestRedundantCalls:
    def test_pass_no_duplicates(self):
        result = _make_result(actual_calls=[
            ActualCall(name="Read", call_type="tool", input={"file_path": "a.py"}),
            ActualCall(name="Read", call_type="tool", input={"file_path": "b.py"}),
        ])
        failures = validate_no_redundant_calls(result)
        assert len(failures) == 0

    def test_fail_duplicate_call(self):
        result = _make_result(actual_calls=[
            ActualCall(name="Read", call_type="tool", input={"file_path": "a.py"}),
            ActualCall(name="Read", call_type="tool", input={"file_path": "a.py"}),
        ])
        failures = validate_no_redundant_calls(result)
        assert len(failures) == 1
        assert "중복" in failures[0].message


# ── 통합 검증 ──


class TestValidateAll:
    def test_pass_scenario(self):
        scenario = _make_scenario(
            expected_calls=[ExpectedCall(name="Read", call_type="tool")],
            context_budget=ContextBudget(max_turns=5),
        )
        result = _make_result(
            actual_calls=[ActualCall(name="Read", call_type="tool")],
            turns=1,
        )
        result = validate(scenario, result)
        assert result.verdict == Verdict.PASS
        assert len(result.failures) == 0

    def test_fail_scenario(self):
        scenario = _make_scenario(
            expected_calls=[ExpectedCall(name="Read", call_type="tool")],
            forbidden_calls=[ForbiddenCall(name="Write", call_type="tool")],
        )
        result = _make_result(
            actual_calls=[ActualCall(name="Write", call_type="tool")],
        )
        result = validate(scenario, result)
        assert result.verdict == Verdict.FAIL
        assert len(result.failures) == 2  # missing Read + forbidden Write

    def test_error_preserved(self):
        result = _make_result(verdict=Verdict.ERROR, error="API error")
        scenario = _make_scenario()
        result = validate(scenario, result)
        assert result.verdict == Verdict.ERROR
