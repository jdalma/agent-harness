"""실제 도구 실행기 - 시뮬레이션 대신 실제로 도구를 실행한다."""

from __future__ import annotations

import fnmatch
import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Bash 실행 시 차단할 위험 패턴
_DANGEROUS_PATTERNS = [
    r"\brm\s+-rf\b",
    r"\brm\s+-r\b",
    r"\bmkfs\b",
    r"\bdd\s+if=",
    r"\b:[(][)]\s*[{]",          # fork bomb
    r"\bshutdown\b",
    r"\breboot\b",
    r"\bsudo\b",
    r"\bchmod\s+777\b",
    r"\bcurl\b.*\|\s*bash",       # pipe to bash
    r"\bwget\b.*\|\s*bash",
]


class ToolExecutionError(Exception):
    """도구 실행 중 발생한 오류."""


class ToolExecutor:
    """프로젝트 루트 기준으로 도구를 실제 실행한다.

    지원 도구: Read, Grep, Glob, Bash (제한적)
    안전하지 않은 도구(Write, Edit)는 기본 비활성.
    """

    def __init__(
        self,
        project_root: str | Path,
        allowed_tools: set[str] | None = None,
        bash_timeout: int = 30,
    ):
        self._root = Path(project_root).resolve()
        if not self._root.is_dir():
            raise FileNotFoundError(f"프로젝트 경로가 존재하지 않습니다: {self._root}")

        # 기본: 읽기 전용 도구만 허용
        self._allowed = allowed_tools or {"Read", "Grep", "Glob"}
        self._bash_timeout = bash_timeout

    @property
    def project_root(self) -> Path:
        return self._root

    def _resolve_path(self, file_path: str) -> Path:
        """파일 경로를 프로젝트 루트 기준으로 해석.

        절대 경로면 그대로, 상대 경로면 프로젝트 루트 기준으로 해석.
        프로젝트 루트 바깥 경로는 차단.
        """
        p = Path(file_path)
        if not p.is_absolute():
            p = self._root / p
        p = p.resolve()

        # 프로젝트 루트 바깥 접근 차단
        try:
            p.relative_to(self._root)
        except ValueError:
            raise ToolExecutionError(
                f"프로젝트 루트 바깥 경로 접근 차단: {file_path} → {p}"
            )

        return p

    def execute(self, tool_name: str, tool_input: dict[str, Any]) -> str:
        """도구를 실제로 실행하고 결과를 반환한다.

        허용되지 않은 도구는 시뮬레이션 결과를 반환.
        """
        if tool_name not in self._allowed:
            return f"[harness] {tool_name} 도구는 실제 실행이 허용되지 않음 (simulated)"

        dispatch = {
            "Read": self._execute_read,
            "Grep": self._execute_grep,
            "Glob": self._execute_glob,
            "Bash": self._execute_bash,
        }

        handler = dispatch.get(tool_name)
        if handler is None:
            return f"[harness] {tool_name} 도구는 실행기에 구현되지 않음 (simulated)"

        try:
            return handler(tool_input)
        except ToolExecutionError as e:
            return f"[error] {e}"
        except Exception as e:
            logger.exception("도구 실행 중 예외: %s", tool_name)
            return f"[error] {tool_name} 실행 실패: {e}"

    def _execute_read(self, tool_input: dict[str, Any]) -> str:
        """Read 도구 실행 - 파일 내용을 읽어 반환."""
        file_path = tool_input.get("file_path", "")
        if not file_path:
            return "[error] file_path가 지정되지 않음"

        resolved = self._resolve_path(file_path)
        if not resolved.is_file():
            return f"[error] 파일을 찾을 수 없음: {file_path}"

        offset = tool_input.get("offset", 0)
        limit = tool_input.get("limit", 2000)

        try:
            lines = resolved.read_text(encoding="utf-8").splitlines()
        except UnicodeDecodeError:
            return f"[error] 바이너리 파일은 읽을 수 없음: {file_path}"

        # offset/limit 적용
        selected = lines[offset:offset + limit]
        numbered = [
            f"{i + offset + 1:>6}\t{line}"
            for i, line in enumerate(selected)
        ]
        return "\n".join(numbered)

    def _execute_grep(self, tool_input: dict[str, Any]) -> str:
        """Grep 도구 실행 - 파일 내용을 정규식으로 검색."""
        pattern_str = tool_input.get("pattern", "")
        if not pattern_str:
            return "[error] pattern이 지정되지 않음"

        search_path = tool_input.get("path", str(self._root))
        resolved = self._resolve_path(search_path)

        try:
            regex = re.compile(pattern_str)
        except re.error as e:
            return f"[error] 잘못된 정규식: {e}"

        glob_filter = tool_input.get("glob")
        output_mode = tool_input.get("output_mode", "files_with_matches")
        case_insensitive = tool_input.get("-i", False)
        if case_insensitive:
            regex = re.compile(pattern_str, re.IGNORECASE)

        matches: list[str] = []
        max_results = 100

        files = self._collect_files(resolved, glob_filter)

        for file_path in files:
            if len(matches) >= max_results:
                break
            try:
                content = file_path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue

            file_matches = []
            for i, line in enumerate(content.splitlines(), 1):
                if regex.search(line):
                    file_matches.append((i, line))

            if file_matches:
                rel = file_path.relative_to(self._root)
                if output_mode == "files_with_matches":
                    matches.append(str(rel))
                elif output_mode == "content":
                    for line_no, line in file_matches:
                        matches.append(f"{rel}:{line_no}:{line}")
                elif output_mode == "count":
                    matches.append(f"{rel}:{len(file_matches)}")

        if not matches:
            return f"[no matches for pattern: {pattern_str}]"
        return "\n".join(matches)

    def _execute_glob(self, tool_input: dict[str, Any]) -> str:
        """Glob 도구 실행 - 파일 패턴 매칭."""
        pattern = tool_input.get("pattern", "")
        if not pattern:
            return "[error] pattern이 지정되지 않음"

        search_path = tool_input.get("path", str(self._root))
        resolved = self._resolve_path(search_path)

        matched: list[str] = []
        max_results = 200

        for path in sorted(resolved.rglob("*")):
            if len(matched) >= max_results:
                break
            if not path.is_file():
                continue
            rel = str(path.relative_to(self._root))
            if fnmatch.fnmatch(rel, pattern) or fnmatch.fnmatch(path.name, pattern):
                matched.append(rel)

        if not matched:
            return f"[no files matching: {pattern}]"
        return "\n".join(matched)

    def _execute_bash(self, tool_input: dict[str, Any]) -> str:
        """Bash 도구 실행 - 제한된 쉘 명령 실행."""
        command = tool_input.get("command", "")
        if not command:
            return "[error] command가 지정되지 않음"

        # 위험 명령 차단
        for dangerous in _DANGEROUS_PATTERNS:
            if re.search(dangerous, command):
                return f"[blocked] 위험한 명령이 감지됨: {command}"

        try:
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=self._bash_timeout,
                cwd=str(self._root),
            )
            output = result.stdout
            if result.stderr:
                output += f"\n[stderr]\n{result.stderr}"
            if result.returncode != 0:
                output += f"\n[exit code: {result.returncode}]"
            return output.strip() or "[no output]"
        except subprocess.TimeoutExpired:
            return f"[timeout] 명령이 {self._bash_timeout}초 내에 완료되지 않음"

    def _collect_files(
        self, path: Path, glob_filter: str | None = None
    ) -> list[Path]:
        """경로에서 파일 목록을 수집한다."""
        if path.is_file():
            return [path]

        files: list[Path] = []
        max_files = 1000
        for p in sorted(path.rglob("*")):
            if len(files) >= max_files:
                break
            if not p.is_file():
                continue
            # .git 등 무시
            parts = p.relative_to(self._root).parts
            if any(part.startswith(".") and part != "." for part in parts):
                continue
            if glob_filter and not fnmatch.fnmatch(p.name, glob_filter):
                continue
            files.append(p)
        return files
