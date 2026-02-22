"""컨텍스트 윈도우 효율성 분석기."""

from __future__ import annotations

from dataclasses import dataclass, field

from .models import ActualCall, ScenarioResult, TokenUsage


@dataclass
class ContextReport:
    """컨텍스트 윈도우 사용 분석 보고서."""

    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_tokens: int = 0
    turns: int = 0
    tokens_per_turn: float = 0.0
    cache_hit_rate: float = 0.0
    redundant_calls: int = 0
    unique_tools_used: int = 0
    total_tool_calls: int = 0
    tool_call_ratio: float = 0.0  # tool_calls / turns
    efficiency_score: float = 0.0  # 0.0 ~ 1.0
    warnings: list[str] = field(default_factory=list)


def _count_redundant_calls(calls: list[ActualCall]) -> int:
    """동일 인자 중복 호출 횟수."""
    seen: set[str] = set()
    duplicates = 0
    for call in calls:
        key = f"{call.call_type}:{call.name}:{sorted(call.input.items())}"
        if key in seen:
            duplicates += 1
        else:
            seen.add(key)
    return duplicates


def _compute_efficiency(report: ContextReport) -> float:
    """효율성 점수 계산 (0.0 ~ 1.0).

    높을수록 좋음. 다음 요소를 고려:
    - 중복 호출이 적을수록 좋음
    - 캐시 적중률이 높을수록 좋음
    - 턴당 토큰이 적을수록 좋음
    """
    scores: list[float] = []

    # 1) 중복 호출 페널티 (0 = 완벽, 중복 많을수록 낮음)
    if report.total_tool_calls > 0:
        dup_ratio = report.redundant_calls / report.total_tool_calls
        scores.append(1.0 - dup_ratio)
    else:
        scores.append(1.0)

    # 2) 캐시 적중률 보너스
    scores.append(min(report.cache_hit_rate + 0.5, 1.0))

    # 3) 턴당 토큰 효율 (낮을수록 좋음, 5000 토큰/턴 이하면 만점)
    if report.turns > 0:
        tpt = report.tokens_per_turn
        if tpt <= 5000:
            scores.append(1.0)
        elif tpt <= 20000:
            scores.append(1.0 - (tpt - 5000) / 15000)
        else:
            scores.append(0.0)
    else:
        scores.append(1.0)

    return sum(scores) / len(scores) if scores else 0.0


def analyze(result: ScenarioResult) -> ContextReport:
    """시나리오 결과에서 컨텍스트 윈도우 효율성을 분석."""
    usage = result.token_usage
    report = ContextReport(
        total_input_tokens=usage.input_tokens,
        total_output_tokens=usage.output_tokens,
        total_tokens=usage.total_tokens,
        turns=result.turns,
        tokens_per_turn=(
            usage.total_tokens / result.turns if result.turns > 0 else 0
        ),
        cache_hit_rate=usage.cache_hit_rate,
        redundant_calls=_count_redundant_calls(result.actual_calls),
        unique_tools_used=len({c.name for c in result.actual_calls}),
        total_tool_calls=len(result.actual_calls),
        tool_call_ratio=(
            len(result.actual_calls) / result.turns if result.turns > 0 else 0
        ),
    )

    # 경고 생성
    if report.redundant_calls > 0:
        report.warnings.append(
            f"중복 도구 호출 {report.redundant_calls}건 감지 - "
            f"컨텍스트 윈도우 낭비 가능"
        )

    if report.tokens_per_turn > 10000:
        report.warnings.append(
            f"턴당 평균 {report.tokens_per_turn:.0f} 토큰 사용 - "
            f"컨텍스트 윈도우 사용량이 높음"
        )

    if report.turns > 5 and report.total_tool_calls < 2:
        report.warnings.append(
            "여러 턴을 사용했지만 도구 호출이 거의 없음 - "
            "불필요한 대화 턴 가능"
        )

    if report.cache_hit_rate < 0.1 and usage.input_tokens > 10000:
        report.warnings.append(
            "캐시 적중률이 낮음 - 프롬프트 캐싱 활용 검토 필요"
        )

    report.efficiency_score = _compute_efficiency(report)
    return report
