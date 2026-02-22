"""컨텍스트 윈도우 분석기 단위 테스트."""

from __future__ import annotations

from agent_harness.context_analyzer import analyze
from agent_harness.models import ActualCall, ScenarioResult, TokenUsage


def _make_result(**kwargs) -> ScenarioResult:
    defaults = {"scenario_name": "test"}
    defaults.update(kwargs)
    return ScenarioResult(**defaults)


class TestContextAnalyzer:
    def test_basic_analysis(self):
        result = _make_result(
            token_usage=TokenUsage(input_tokens=1000, output_tokens=500),
            turns=2,
            actual_calls=[
                ActualCall(name="Read", call_type="tool", input={"file_path": "a.py"}),
                ActualCall(name="Grep", call_type="tool", input={"pattern": "def"}),
            ],
        )
        report = analyze(result)
        assert report.total_tokens == 1500
        assert report.turns == 2
        assert report.tokens_per_turn == 750.0
        assert report.unique_tools_used == 2
        assert report.total_tool_calls == 2
        assert report.redundant_calls == 0

    def test_redundant_detection(self):
        result = _make_result(
            token_usage=TokenUsage(input_tokens=2000, output_tokens=1000),
            turns=3,
            actual_calls=[
                ActualCall(name="Read", call_type="tool", input={"file_path": "a.py"}),
                ActualCall(name="Read", call_type="tool", input={"file_path": "a.py"}),
                ActualCall(name="Read", call_type="tool", input={"file_path": "b.py"}),
            ],
        )
        report = analyze(result)
        assert report.redundant_calls == 1
        assert any("중복" in w for w in report.warnings)

    def test_high_token_warning(self):
        result = _make_result(
            token_usage=TokenUsage(input_tokens=50000, output_tokens=10000),
            turns=3,
            actual_calls=[],
        )
        report = analyze(result)
        assert report.tokens_per_turn == 20000.0
        assert any("토큰" in w for w in report.warnings)

    def test_efficiency_score_range(self):
        result = _make_result(
            token_usage=TokenUsage(input_tokens=1000, output_tokens=500),
            turns=1,
            actual_calls=[
                ActualCall(name="Read", call_type="tool", input={"file_path": "a.py"}),
            ],
        )
        report = analyze(result)
        assert 0.0 <= report.efficiency_score <= 1.0

    def test_cache_hit_rate(self):
        result = _make_result(
            token_usage=TokenUsage(
                input_tokens=1000,
                output_tokens=500,
                cache_read_input_tokens=800,
            ),
            turns=1,
            actual_calls=[],
        )
        report = analyze(result)
        # cache_hit_rate = 800 / (1000 + 800) = 0.444...
        assert report.cache_hit_rate > 0.4
