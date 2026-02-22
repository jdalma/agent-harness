"""도메인 지식 계층적 라우팅 검증 테스트.

단순 도메인 질문 → Skill 호출
복합 도메인 질문 → Agent 호출 (스킬/도메인 파일 조합)

이 테스트는 API 호출 없이 validators 로직만으로
라우팅이 올바르게 판정되는지 검증한다.
"""

from __future__ import annotations

from pathlib import Path

from agent_harness.loader import load_scenario
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
    validate_expected_calls,
    validate_forbidden_calls,
)

SCENARIOS_DIR = Path(__file__).parent.parent / "scenarios"


def _make_scenario(**kwargs) -> Scenario:
    defaults = {"name": "test", "messages": [{"role": "user", "content": "hello"}]}
    defaults.update(kwargs)
    return Scenario(**defaults)


def _make_result(**kwargs) -> ScenarioResult:
    defaults = {"scenario_name": "test"}
    defaults.update(kwargs)
    return ScenarioResult(**defaults)


# ── 시나리오 YAML 로딩 검증 ──


class TestDomainScenarioLoading:
    """도메인 라우팅 시나리오 YAML이 올바르게 로딩되는지 검증."""

    def test_load_simple_skill_scenario(self):
        scenario = load_scenario(SCENARIOS_DIR / "domain_simple_skill.yaml")
        assert scenario.name == "domain_simple_skill_routing"
        assert len(scenario.expected_calls) == 1
        assert scenario.expected_calls[0].call_type == "skill"
        assert scenario.expected_calls[0].name == "k8s-basics"
        assert len(scenario.forbidden_calls) == 2  # Explore, general-purpose

    def test_load_complex_agent_scenario(self):
        scenario = load_scenario(SCENARIOS_DIR / "domain_complex_agent.yaml")
        assert scenario.name == "domain_complex_agent_routing"
        assert len(scenario.expected_calls) == 1
        assert scenario.expected_calls[0].call_type == "agent"
        assert scenario.expected_calls[0].name == "general-purpose"

    def test_both_scenarios_share_same_tools(self):
        simple = load_scenario(SCENARIOS_DIR / "domain_simple_skill.yaml")
        complex_ = load_scenario(SCENARIOS_DIR / "domain_complex_agent.yaml")
        simple_tools = {t.name for t in simple.tools}
        complex_tools = {t.name for t in complex_.tools}
        # 두 시나리오 모두 Skill, Task 도구를 포함해야 함
        assert "Skill" in simple_tools
        assert "Task" in simple_tools
        assert "Skill" in complex_tools
        assert "Task" in complex_tools


# ── 단순 질문 → Skill 라우팅 검증 ──


class TestSimpleQuestionSkillRouting:
    """단순 도메인 질문이 Skill로 라우팅되는 시나리오 검증."""

    def test_pass_when_skill_called(self):
        """단순 질문에 올바른 스킬이 호출되면 PASS."""
        scenario = _make_scenario(
            expected_calls=[
                ExpectedCall(name="k8s-basics", call_type="skill", required=True),
            ],
            forbidden_calls=[
                ForbiddenCall(
                    name="Explore", call_type="agent",
                    reason="단순 질문에 에이전트 불필요",
                ),
            ],
        )
        result = _make_result(
            actual_calls=[
                ActualCall(
                    name="k8s-basics", call_type="skill",
                    input={"skill": "k8s-basics"},
                ),
            ],
        )
        result = validate(scenario, result)
        assert result.verdict == Verdict.PASS

    def test_fail_when_agent_called_instead(self):
        """단순 질문에 에이전트가 호출되면 FAIL (forbidden 위반)."""
        scenario = _make_scenario(
            expected_calls=[
                ExpectedCall(name="k8s-basics", call_type="skill", required=True),
            ],
            forbidden_calls=[
                ForbiddenCall(
                    name="Explore", call_type="agent",
                    reason="단순 질문에 에이전트 불필요",
                ),
            ],
        )
        result = _make_result(
            actual_calls=[
                ActualCall(
                    name="Explore", call_type="agent",
                    input={"prompt": "Pod 설명해줘"},
                ),
            ],
        )
        result = validate(scenario, result)
        assert result.verdict == Verdict.FAIL
        rules = [f.rule for f in result.failures]
        assert "expected_call" in rules   # 스킬 미호출
        assert "forbidden_call" in rules  # 에이전트 호출 금지 위반

    def test_fail_when_nothing_called(self):
        """아무것도 호출하지 않으면 FAIL."""
        scenario = _make_scenario(
            expected_calls=[
                ExpectedCall(name="k8s-basics", call_type="skill", required=True),
            ],
        )
        result = _make_result(actual_calls=[])
        result = validate(scenario, result)
        assert result.verdict == Verdict.FAIL

    def test_fail_when_wrong_skill_called(self):
        """다른 스킬이 호출되면 FAIL."""
        scenario = _make_scenario(
            expected_calls=[
                ExpectedCall(name="k8s-basics", call_type="skill", required=True),
            ],
        )
        result = _make_result(
            actual_calls=[
                ActualCall(name="k8s-networking", call_type="skill"),
            ],
        )
        failures = validate_expected_calls(scenario, result)
        assert len(failures) == 1
        assert "k8s-basics" in failures[0].message


# ── 복합 질문 → Agent 라우팅 검증 ──


class TestComplexQuestionAgentRouting:
    """복합 도메인 질문이 Agent로 라우팅되는 시나리오 검증."""

    def test_pass_when_agent_called(self):
        """복합 질문에 에이전트가 호출되면 PASS."""
        scenario = _make_scenario(
            expected_calls=[
                ExpectedCall(
                    name="general-purpose", call_type="agent", required=True,
                ),
            ],
        )
        result = _make_result(
            actual_calls=[
                ActualCall(
                    name="general-purpose", call_type="agent",
                    input={"prompt": "PV/PVC와 네트워크 설계 분석"},
                ),
            ],
        )
        result = validate(scenario, result)
        assert result.verdict == Verdict.PASS

    def test_fail_when_only_skill_called(self):
        """복합 질문에 단일 스킬만 호출되면 FAIL (에이전트 미호출)."""
        scenario = _make_scenario(
            expected_calls=[
                ExpectedCall(
                    name="general-purpose", call_type="agent", required=True,
                ),
            ],
        )
        result = _make_result(
            actual_calls=[
                ActualCall(name="k8s-basics", call_type="skill"),
            ],
        )
        result = validate(scenario, result)
        assert result.verdict == Verdict.FAIL
        assert any("general-purpose" in f.message for f in result.failures)

    def test_pass_agent_with_additional_skill(self):
        """에이전트 호출과 함께 스킬도 호출해도 PASS (에이전트만 필수)."""
        scenario = _make_scenario(
            expected_calls=[
                ExpectedCall(
                    name="general-purpose", call_type="agent", required=True,
                ),
            ],
        )
        result = _make_result(
            actual_calls=[
                ActualCall(name="k8s-storage", call_type="skill"),
                ActualCall(
                    name="general-purpose", call_type="agent",
                    input={"prompt": "종합 분석"},
                ),
            ],
        )
        result = validate(scenario, result)
        assert result.verdict == Verdict.PASS


# ── 교차 검증: 동일 도구셋에서 질문 유형에 따른 분기 ──


class TestCrossRouting:
    """동일한 도구 구성에서 질문 유형에 따라 다른 경로로 라우팅되는지 검증.

    핵심: system_prompt가 동일해도 질문의 복잡도에 따라
    skill vs agent로 분기해야 한다.
    """

    def _make_domain_scenario(
        self,
        expected_calls: list[ExpectedCall],
        forbidden_calls: list[ForbiddenCall] | None = None,
    ) -> Scenario:
        return _make_scenario(
            name="domain_routing",
            system_prompt=(
                "단순 질문은 Skill, 복합 질문은 Task 에이전트를 사용하세요."
            ),
            expected_calls=expected_calls,
            forbidden_calls=forbidden_calls or [],
            context_budget=ContextBudget(max_total_tokens=50000, max_turns=5),
        )

    def test_simple_routes_to_skill_not_agent(self):
        """단순 질문: Skill PASS + Agent 호출 시 FAIL."""
        scenario = self._make_domain_scenario(
            expected_calls=[
                ExpectedCall(name="k8s-basics", call_type="skill", required=True),
            ],
            forbidden_calls=[
                ForbiddenCall(
                    name="general-purpose", call_type="agent",
                    reason="단순 질문에 에이전트 불필요",
                ),
            ],
        )

        # Skill 호출 → PASS
        good_result = _make_result(
            actual_calls=[
                ActualCall(name="k8s-basics", call_type="skill"),
            ],
            turns=1,
        )
        good_result = validate(scenario, good_result)
        assert good_result.verdict == Verdict.PASS

        # Agent 호출 → FAIL
        bad_result = _make_result(
            actual_calls=[
                ActualCall(name="general-purpose", call_type="agent"),
            ],
            turns=1,
        )
        bad_result = validate(scenario, bad_result)
        assert bad_result.verdict == Verdict.FAIL

    def test_complex_routes_to_agent_not_skill_only(self):
        """복합 질문: Agent PASS + Skill만 호출 시 FAIL."""
        scenario = self._make_domain_scenario(
            expected_calls=[
                ExpectedCall(
                    name="general-purpose", call_type="agent", required=True,
                ),
            ],
        )

        # Agent 호출 → PASS
        good_result = _make_result(
            actual_calls=[
                ActualCall(name="general-purpose", call_type="agent"),
            ],
            turns=2,
        )
        good_result = validate(scenario, good_result)
        assert good_result.verdict == Verdict.PASS

        # Skill만 호출 → FAIL
        bad_result = _make_result(
            actual_calls=[
                ActualCall(name="k8s-basics", call_type="skill"),
                ActualCall(name="k8s-networking", call_type="skill"),
            ],
            turns=2,
        )
        bad_result = validate(scenario, bad_result)
        assert bad_result.verdict == Verdict.FAIL

    def test_context_budget_enforced(self):
        """라우팅이 올바르더라도 컨텍스트 예산 초과 시 FAIL."""
        scenario = self._make_domain_scenario(
            expected_calls=[
                ExpectedCall(name="k8s-basics", call_type="skill", required=True),
            ],
        )
        result = _make_result(
            actual_calls=[
                ActualCall(name="k8s-basics", call_type="skill"),
            ],
            token_usage=TokenUsage(input_tokens=40000, output_tokens=20000),
            turns=1,
        )
        result = validate(scenario, result)
        assert result.verdict == Verdict.FAIL
        assert any(f.rule == "context_budget_total" for f in result.failures)
