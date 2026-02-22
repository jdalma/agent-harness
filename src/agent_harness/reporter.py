"""테스트 결과를 터미널에 출력하는 리포터."""

from __future__ import annotations

from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from .context_analyzer import ContextReport
from .models import ScenarioResult, Verdict

console = Console()

_VERDICT_STYLE = {
    Verdict.PASS: "bold green",
    Verdict.FAIL: "bold red",
    Verdict.ERROR: "bold yellow",
}


def _verdict_label(v: Verdict) -> Text:
    labels = {Verdict.PASS: "PASS", Verdict.FAIL: "FAIL", Verdict.ERROR: "ERROR"}
    return Text(labels[v], style=_VERDICT_STYLE[v])


def print_result(result: ScenarioResult, ctx_report: ContextReport | None = None) -> None:
    """단일 시나리오 결과를 출력."""
    header = Text(result.scenario_name, style="bold")
    header.append("  ")
    header.append(_verdict_label(result.verdict))

    lines: list[str] = []

    # 도구 호출 요약
    if result.actual_calls:
        lines.append("[도구 호출]")
        for call in result.actual_calls:
            lines.append(f"  T{call.turn} {call.call_type}:{call.name}")

    # 토큰 사용량
    u = result.token_usage
    lines.append(f"\n[토큰] 입력={u.input_tokens:,}  출력={u.output_tokens:,}  "
                 f"합계={u.total_tokens:,}  턴={result.turns}")

    # 실패 상세
    if result.failures:
        lines.append("\n[실패 상세]")
        for f in result.failures:
            lines.append(f"  [{f.rule}] {f.message}")

    if result.error:
        lines.append(f"\n[오류] {result.error}")

    # 컨텍스트 분석
    if ctx_report:
        lines.append(f"\n[컨텍스트 효율] 점수={ctx_report.efficiency_score:.2f}  "
                     f"중복호출={ctx_report.redundant_calls}  "
                     f"캐시적중={ctx_report.cache_hit_rate:.1%}")
        for w in ctx_report.warnings:
            lines.append(f"  ! {w}")

    console.print(Panel("\n".join(lines), title=header, border_style="dim"))


def print_summary(results: list[tuple[ScenarioResult, ContextReport | None]]) -> None:
    """전체 테스트 요약을 출력."""
    table = Table(title="테스트 요약", show_lines=True)
    table.add_column("시나리오", style="bold")
    table.add_column("결과", justify="center")
    table.add_column("토큰(합계)", justify="right")
    table.add_column("턴", justify="center")
    table.add_column("도구호출", justify="center")
    table.add_column("효율점수", justify="center")
    table.add_column("실패", justify="center")

    pass_count = fail_count = error_count = 0

    for result, ctx_report in results:
        if result.verdict == Verdict.PASS:
            pass_count += 1
        elif result.verdict == Verdict.FAIL:
            fail_count += 1
        else:
            error_count += 1

        eff = f"{ctx_report.efficiency_score:.2f}" if ctx_report else "-"
        table.add_row(
            result.scenario_name,
            _verdict_label(result.verdict),
            f"{result.token_usage.total_tokens:,}",
            str(result.turns),
            str(len(result.actual_calls)),
            eff,
            str(len(result.failures)),
        )

    console.print(table)
    console.print(
        f"\n총 {pass_count + fail_count + error_count}건: "
        f"[green]{pass_count} PASS[/green]  "
        f"[red]{fail_count} FAIL[/red]  "
        f"[yellow]{error_count} ERROR[/yellow]"
    )
