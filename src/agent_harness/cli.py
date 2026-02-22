"""CLI 진입점 - 시나리오를 로드하고 실행하여 결과를 출력."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import context_analyzer, reporter
from .loader import load_scenario, load_scenarios
from .models import Verdict
from .runner import ScenarioRunner
from .validators import validate


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="agent-harness",
        description="에이전트/스킬 호출 검증 및 컨텍스트 윈도우 효율성 테스트",
    )
    parser.add_argument(
        "path",
        help="시나리오 YAML 파일 또는 디렉토리 경로",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="모든 시나리오에 적용할 모델 (시나리오 설정 오버라이드)",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="각 시나리오 상세 결과 출력",
    )
    args = parser.parse_args(argv)

    p = Path(args.path)
    if p.is_file():
        scenarios = [load_scenario(p)]
    elif p.is_dir():
        scenarios = load_scenarios(p)
    else:
        print(f"오류: '{args.path}'을(를) 찾을 수 없습니다", file=sys.stderr)
        return 1

    if not scenarios:
        print("로드된 시나리오가 없습니다", file=sys.stderr)
        return 1

    if args.model:
        for s in scenarios:
            s.model = args.model

    runner = ScenarioRunner()
    all_results: list[tuple] = []

    for scenario in scenarios:
        result = runner.run(scenario)
        result = validate(scenario, result)
        ctx_report = context_analyzer.analyze(result)
        all_results.append((result, ctx_report))

        if args.verbose:
            reporter.print_result(result, ctx_report)

    reporter.print_summary(all_results)

    # 하나라도 실패하면 exit code 1
    has_failure = any(r.verdict != Verdict.PASS for r, _ in all_results)
    return 1 if has_failure else 0


if __name__ == "__main__":
    sys.exit(main())
