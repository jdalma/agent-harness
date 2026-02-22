"""YAML 로더 테스트."""

from __future__ import annotations

from pathlib import Path

from agent_harness.loader import load_scenario, load_scenarios


SCENARIOS_DIR = Path(__file__).parent.parent / "scenarios"


class TestLoader:
    def test_load_single_scenario(self):
        path = SCENARIOS_DIR / "example_code_review.yaml"
        scenario = load_scenario(path)
        assert scenario.name == "code_review_routing"
        assert len(scenario.tools) > 0
        assert len(scenario.expected_calls) > 0
        assert len(scenario.messages) == 1

    def test_load_all_scenarios(self):
        scenarios = load_scenarios(SCENARIOS_DIR)
        assert len(scenarios) >= 3
        names = {s.name for s in scenarios}
        assert "code_review_routing" in names
        assert "agent_delegation_explore" in names
        assert "skill_invocation_commit" in names

    def test_scenario_has_context_budget(self):
        path = SCENARIOS_DIR / "example_code_review.yaml"
        scenario = load_scenario(path)
        assert scenario.context_budget.max_input_tokens == 50000
        assert scenario.context_budget.max_turns == 5

    def test_scenario_forbidden_calls(self):
        path = SCENARIOS_DIR / "example_code_review.yaml"
        scenario = load_scenario(path)
        assert len(scenario.forbidden_calls) == 1
        assert scenario.forbidden_calls[0].name == "Write"
