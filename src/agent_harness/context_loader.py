"""프로젝트 컨텍스트 자동 로더 - 실제 프로젝트 폴더에서 컨텍스트를 추출한다."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from .models import Scenario

logger = logging.getLogger(__name__)

# 파일 트리 생성 시 무시할 디렉토리
_IGNORE_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv",
    ".mypy_cache", ".pytest_cache", ".tox", "dist", "build",
    ".egg-info", ".next", ".nuxt", "target", "out",
}

# 프로젝트 타입 감지용 파일명 매핑
_PROJECT_MARKERS: dict[str, str] = {
    "pyproject.toml": "python",
    "setup.py": "python",
    "package.json": "node",
    "Cargo.toml": "rust",
    "go.mod": "go",
    "pom.xml": "java",
    "build.gradle": "java",
    "Gemfile": "ruby",
}


@dataclass
class ProjectContext:
    """프로젝트에서 추출한 컨텍스트 정보."""

    root: Path
    claude_md: str | None = None
    claude_config: dict[str, Any] = field(default_factory=dict)
    file_tree: str = ""
    project_type: str = "unknown"
    project_metadata: dict[str, Any] = field(default_factory=dict)


def _read_text_safe(path: Path, max_bytes: int = 50_000) -> str | None:
    """파일을 안전하게 읽는다. 없거나 너무 크면 None."""
    if not path.is_file():
        return None
    if path.stat().st_size > max_bytes:
        logger.warning("파일이 너무 큼, 건너뜀: %s (%d bytes)", path, path.stat().st_size)
        return None
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def _build_file_tree(root: Path, max_depth: int = 3, max_entries: int = 200) -> str:
    """프로젝트 파일 트리를 문자열로 생성."""
    lines: list[str] = []
    count = 0

    def _walk(directory: Path, prefix: str, depth: int) -> None:
        nonlocal count
        if depth > max_depth or count >= max_entries:
            return

        try:
            entries = sorted(directory.iterdir(), key=lambda p: (p.is_file(), p.name))
        except PermissionError:
            return

        dirs = [e for e in entries if e.is_dir() and e.name not in _IGNORE_DIRS]
        files = [e for e in entries if e.is_file()]

        for f in files:
            if count >= max_entries:
                lines.append(f"{prefix}... (truncated)")
                return
            lines.append(f"{prefix}{f.name}")
            count += 1

        for d in dirs:
            if count >= max_entries:
                lines.append(f"{prefix}... (truncated)")
                return
            lines.append(f"{prefix}{d.name}/")
            count += 1
            _walk(d, prefix + "  ", depth + 1)

    _walk(root, "", 0)
    return "\n".join(lines)


def _detect_project_type(root: Path) -> str:
    """프로젝트 루트에서 프로젝트 타입을 감지."""
    for marker_file, project_type in _PROJECT_MARKERS.items():
        if (root / marker_file).is_file():
            return project_type
    return "unknown"


def _load_project_metadata(root: Path, project_type: str) -> dict[str, Any]:
    """프로젝트 메타데이터 파일에서 핵심 정보를 추출."""
    metadata: dict[str, Any] = {}

    if project_type == "python":
        pyproject = root / "pyproject.toml"
        if pyproject.is_file():
            try:
                # toml 파서가 없을 수 있으므로 기본적인 정보만 추출
                content = pyproject.read_text(encoding="utf-8")
                metadata["config_file"] = "pyproject.toml"
                metadata["raw_preview"] = content[:2000]
            except OSError:
                pass

    elif project_type == "node":
        pkg_json = root / "package.json"
        if pkg_json.is_file():
            try:
                data = json.loads(pkg_json.read_text(encoding="utf-8"))
                metadata["name"] = data.get("name", "")
                metadata["version"] = data.get("version", "")
                metadata["scripts"] = data.get("scripts", {})
                metadata["dependencies"] = list(data.get("dependencies", {}).keys())
                metadata["devDependencies"] = list(
                    data.get("devDependencies", {}).keys()
                )
            except (OSError, json.JSONDecodeError):
                pass

    return metadata


def _load_claude_config(root: Path) -> dict[str, Any]:
    """`.claude/` 디렉토리에서 설정 파일을 로드."""
    claude_dir = root / ".claude"
    config: dict[str, Any] = {}

    if not claude_dir.is_dir():
        return config

    for f in claude_dir.iterdir():
        if not f.is_file():
            continue
        content = _read_text_safe(f)
        if content is None:
            continue
        if f.suffix in (".json",):
            try:
                config[f.name] = json.loads(content)
            except json.JSONDecodeError:
                config[f.name] = content
        elif f.suffix in (".yaml", ".yml"):
            try:
                config[f.name] = yaml.safe_load(content)
            except yaml.YAMLError:
                config[f.name] = content
        else:
            config[f.name] = content

    return config


def load_project_context(
    project_path: str | Path,
    max_depth: int = 3,
    max_entries: int = 200,
) -> ProjectContext:
    """프로젝트 디렉토리에서 컨텍스트를 추출한다.

    추출 항목:
    - CLAUDE.md (루트 및 .claude/ 내)
    - .claude/ 설정 파일들
    - 파일 트리 구조
    - 프로젝트 타입 및 메타데이터
    """
    root = Path(project_path).resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"프로젝트 경로를 찾을 수 없습니다: {root}")

    # CLAUDE.md 로드 (루트 우선, .claude/ 내부도 확인)
    claude_md = _read_text_safe(root / "CLAUDE.md")
    if claude_md is None:
        claude_md = _read_text_safe(root / ".claude" / "CLAUDE.md")

    project_type = _detect_project_type(root)

    return ProjectContext(
        root=root,
        claude_md=claude_md,
        claude_config=_load_claude_config(root),
        file_tree=_build_file_tree(root, max_depth=max_depth, max_entries=max_entries),
        project_type=project_type,
        project_metadata=_load_project_metadata(root, project_type),
    )


def build_context_prompt(context: ProjectContext) -> str:
    """프로젝트 컨텍스트를 system_prompt에 주입할 텍스트로 변환."""
    sections: list[str] = []

    sections.append(f"## 프로젝트 정보\n- 경로: {context.root}\n- 타입: {context.project_type}")

    if context.claude_md:
        sections.append(f"## CLAUDE.md\n{context.claude_md}")

    if context.claude_config:
        config_summary = ", ".join(context.claude_config.keys())
        sections.append(f"## .claude/ 설정 파일\n포함 파일: {config_summary}")

    if context.file_tree:
        sections.append(f"## 파일 구조\n```\n{context.file_tree}\n```")

    if context.project_metadata:
        meta_lines = []
        for k, v in context.project_metadata.items():
            if k == "raw_preview":
                continue
            if isinstance(v, list):
                meta_lines.append(f"- {k}: {', '.join(str(i) for i in v)}")
            elif isinstance(v, dict):
                meta_lines.append(f"- {k}: {json.dumps(v, ensure_ascii=False)}")
            else:
                meta_lines.append(f"- {k}: {v}")
        if meta_lines:
            sections.append("## 프로젝트 메타데이터\n" + "\n".join(meta_lines))

    return "\n\n".join(sections)


def inject_context(scenario: Scenario, context: ProjectContext) -> Scenario:
    """프로젝트 컨텍스트를 시나리오의 system_prompt에 주입한다.

    기존 system_prompt 앞에 프로젝트 컨텍스트를 추가한다.
    """
    context_text = build_context_prompt(context)
    separator = "\n\n---\n\n"

    if scenario.system_prompt:
        scenario.system_prompt = context_text + separator + scenario.system_prompt
    else:
        scenario.system_prompt = context_text

    return scenario
