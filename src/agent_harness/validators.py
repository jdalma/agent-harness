"""검증기 - 시나리오 결과를 기대값과 비교하여 PASS/FAIL 판정."""

from __future__ import annotations

from .models import (
    ActualCall,
    ExpectedCall,
    ForbiddenCall,
    Scenario,
    ScenarioResult,
    ValidationFailure,
    Verdict,
)


def _match_call(expected: ExpectedCall, actual_calls: list[ActualCall]) -> ActualCall | None:
    """기대하는 호출과 일치하는 실제 호출을 찾는다."""
    for call in actual_calls:
        if call.call_type != expected.call_type:
            continue
        if call.name != expected.name:
            continue
        # args_contain 검사
        if expected.args_contain:
            if not all(
                call.input.get(k) == v
                for k, v in expected.args_contain.items()
            ):
                continue
        return call
    return None


def validate_expected_calls(
    scenario: Scenario, result: ScenarioResult
) -> list[ValidationFailure]:
    """기대하는 도구/에이전트/스킬이 실제로 호출되었는지 검증."""
    failures: list[ValidationFailure] = []

    for expected in scenario.expected_calls:
        matched = _match_call(expected, result.actual_calls)
        if matched is None and expected.required:
            failures.append(ValidationFailure(
                rule="expected_call",
                message=(
                    f"기대한 {expected.call_type} '{expected.name}'이(가) "
                    f"호출되지 않았습니다"
                ),
                expected=expected.model_dump(),
                actual=[c.model_dump() for c in result.actual_calls],
            ))

    return failures


def validate_forbidden_calls(
    scenario: Scenario, result: ScenarioResult
) -> list[ValidationFailure]:
    """금지된 도구/에이전트/스킬이 호출되지 않았는지 검증."""
    failures: list[ValidationFailure] = []

    for forbidden in scenario.forbidden_calls:
        for call in result.actual_calls:
            if call.call_type == forbidden.call_type and call.name == forbidden.name:
                failures.append(ValidationFailure(
                    rule="forbidden_call",
                    message=(
                        f"금지된 {forbidden.call_type} '{forbidden.name}'이(가) "
                        f"호출되었습니다. 사유: {forbidden.reason}"
                    ),
                    expected=forbidden.model_dump(),
                    actual=call.model_dump(),
                ))

    return failures


def validate_call_order(
    expected_order: list[str], result: ScenarioResult
) -> list[ValidationFailure]:
    """도구 호출 순서가 기대한 순서와 일치하는지 검증."""
    failures: list[ValidationFailure] = []
    actual_names = [c.name for c in result.actual_calls]

    # expected_order의 각 항목이 순서대로 actual_names에 나타나는지 확인
    last_idx = -1
    for name in expected_order:
        found = False
        for i, actual_name in enumerate(actual_names):
            if actual_name == name and i > last_idx:
                last_idx = i
                found = True
                break
        if not found:
            failures.append(ValidationFailure(
                rule="call_order",
                message=(
                    f"호출 순서 위반: '{name}'이(가) 기대한 순서에서 "
                    f"발견되지 않았습니다"
                ),
                expected=expected_order,
                actual=actual_names,
            ))
            break

    return failures


def validate_context_budget(
    scenario: Scenario, result: ScenarioResult
) -> list[ValidationFailure]:
    """컨텍스트 윈도우 예산 초과 여부 검증."""
    failures: list[ValidationFailure] = []
    budget = scenario.context_budget
    usage = result.token_usage

    if budget.max_input_tokens and usage.input_tokens > budget.max_input_tokens:
        failures.append(ValidationFailure(
            rule="context_budget_input",
            message=(
                f"입력 토큰 예산 초과: {usage.input_tokens} > "
                f"{budget.max_input_tokens}"
            ),
            expected=budget.max_input_tokens,
            actual=usage.input_tokens,
        ))

    if budget.max_output_tokens and usage.output_tokens > budget.max_output_tokens:
        failures.append(ValidationFailure(
            rule="context_budget_output",
            message=(
                f"출력 토큰 예산 초과: {usage.output_tokens} > "
                f"{budget.max_output_tokens}"
            ),
            expected=budget.max_output_tokens,
            actual=usage.output_tokens,
        ))

    if budget.max_total_tokens and usage.total_tokens > budget.max_total_tokens:
        failures.append(ValidationFailure(
            rule="context_budget_total",
            message=(
                f"총 토큰 예산 초과: {usage.total_tokens} > "
                f"{budget.max_total_tokens}"
            ),
            expected=budget.max_total_tokens,
            actual=usage.total_tokens,
        ))

    if budget.max_turns and result.turns > budget.max_turns:
        failures.append(ValidationFailure(
            rule="context_budget_turns",
            message=(
                f"턴 수 예산 초과: {result.turns} > {budget.max_turns}"
            ),
            expected=budget.max_turns,
            actual=result.turns,
        ))

    return failures


def validate_no_redundant_calls(
    result: ScenarioResult,
    dedup_keys: list[str] | None = None,
) -> list[ValidationFailure]:
    """동일한 도구가 동일 인자로 중복 호출되지 않았는지 검증.

    컨텍스트 윈도우를 비효율적으로 사용하는 패턴을 탐지한다.
    """
    failures: list[ValidationFailure] = []
    seen: dict[str, list[int]] = {}

    for i, call in enumerate(result.actual_calls):
        # dedup_keys가 지정된 경우 해당 도구만 검사
        if dedup_keys and call.name not in dedup_keys:
            continue

        key = f"{call.call_type}:{call.name}:{sorted(call.input.items())}"
        if key in seen:
            seen[key].append(i)
        else:
            seen[key] = [i]

    for key, indices in seen.items():
        if len(indices) > 1:
            failures.append(ValidationFailure(
                rule="redundant_call",
                message=(
                    f"중복 호출 감지: {key.split(':')[1]}이(가) "
                    f"{len(indices)}회 동일 인자로 호출됨 (인덱스: {indices})"
                ),
                expected="1회 호출",
                actual=f"{len(indices)}회 호출",
            ))

    return failures


def validate(scenario: Scenario, result: ScenarioResult) -> ScenarioResult:
    """모든 검증을 실행하고 최종 verdict를 설정."""
    if result.verdict == Verdict.ERROR:
        return result

    all_failures: list[ValidationFailure] = []
    all_failures.extend(validate_expected_calls(scenario, result))
    all_failures.extend(validate_forbidden_calls(scenario, result))
    all_failures.extend(validate_context_budget(scenario, result))
    all_failures.extend(validate_no_redundant_calls(result))

    result.failures = all_failures
    result.verdict = Verdict.FAIL if all_failures else Verdict.PASS
    return result
