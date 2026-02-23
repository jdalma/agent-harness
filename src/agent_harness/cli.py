"""CLI 진입점 - 시나리오를 로드하고 실행하여 결과를 출력."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import context_analyzer, reporter
from .context_loader import inject_context, load_project_context
from .loader import load_scenario, load_scenarios
from .models import Verdict
from .runner import ScenarioRunner
from .tool_executor import ToolExecutor
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
        "--project",
        default=None,
        help="프로젝트 디렉토리 경로 (자동 컨텍스트 로드 및 실제 도구 실행)",
    )
    parser.add_argument(
        "--execute-tools",
        action="store_true",
        help="실제 도구 실행 모드 활성화 (--project 필요)",
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

    # 프로젝트 컨텍스트 로드
    if args.project:
        project_path = Path(args.project)
        if not project_path.is_dir():
            print(
                f"오류: 프로젝트 경로를 찾을 수 없습니다: '{args.project}'",
                file=sys.stderr,
            )
            return 1
        project_context = load_project_context(project_path)
        for s in scenarios:
            inject_context(s, project_context)
            if not s.project_path:
                s.project_path = str(project_path)

    # ToolExecutor 생성 (CLI 레벨)
    tool_executor = None
    if args.execute_tools:
        project_for_exec = args.project
        if not project_for_exec:
            for s in scenarios:
                if s.project_path:
                    project_for_exec = s.project_path
                    break
        if project_for_exec:
            tool_executor = ToolExecutor(project_for_exec)
        else:
            print(
                "경고: --execute-tools를 사용하려면 --project 또는 "
                "시나리오에 project_path를 지정해야 합니다",
                file=sys.stderr,
            )

    runner = ScenarioRunner(tool_executor=tool_executor)
    all_results: list[tuple] = []

    for scenario in scenarios:
        # 시나리오별 execute_tools/project_path가 지정된 경우 런타임 오버라이드
        per_scenario_executor = tool_executor
        if not per_scenario_executor and scenario.execute_tools and scenario.project_path:
            per_scenario_executor = ToolExecutor(scenario.project_path)
            runner._tool_executor = per_scenario_executor

        result = runner.run(scenario)
        result = validate(scenario, result)
        ctx_report = context_analyzer.analyze(result)
        all_results.append((result, ctx_report))

        if args.verbose:
            reporter.print_result(result, ctx_report)

        # 시나리오별 executor 리셋
        if per_scenario_executor and per_scenario_executor is not tool_executor:
            runner._tool_executor = tool_executor

    reporter.print_summary(all_results)

    # 하나라도 실패하면 exit code 1
    has_failure = any(r.verdict != Verdict.PASS for r, _ in all_results)
    return 1 if has_failure else 0


if __name__ == "__main__":
    sys.exit(main())
