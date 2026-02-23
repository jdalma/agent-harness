"""프로젝트 컨텍스트 로더 단위 테스트."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agent_harness.context_loader import (
    ProjectContext,
    build_context_prompt,
    inject_context,
    load_project_context,
)
from agent_harness.models import Scenario


@pytest.fixture
def sample_project(tmp_path: Path) -> Path:
    """테스트용 프로젝트 디렉토리 생성."""
    # CLAUDE.md
    (tmp_path / "CLAUDE.md").write_text(
        "# 프로젝트 지침\n이 프로젝트는 Python 기반입니다.\n", encoding="utf-8"
    )

    # .claude/ 디렉토리
    claude_dir = tmp_path / ".claude"
    claude_dir.mkdir()
    (claude_dir / "settings.json").write_text(
        json.dumps({"model": "claude-sonnet-4-20250514"}), encoding="utf-8"
    )

    # pyproject.toml
    (tmp_path / "pyproject.toml").write_text(
        '[project]\nname = "test-project"\nversion = "1.0.0"\n',
        encoding="utf-8",
    )

    # 소스 파일
    src_dir = tmp_path / "src"
    src_dir.mkdir()
    (src_dir / "main.py").write_text("def hello():\n    print('hello')\n")
    (src_dir / "utils.py").write_text("def add(a, b):\n    return a + b\n")

    # tests 디렉토리
    tests_dir = tmp_path / "tests"
    tests_dir.mkdir()
    (tests_dir / "test_main.py").write_text("def test_hello():\n    pass\n")

    return tmp_path


@pytest.fixture
def node_project(tmp_path: Path) -> Path:
    """Node.js 프로젝트 디렉토리 생성."""
    (tmp_path / "package.json").write_text(
        json.dumps({
            "name": "test-app",
            "version": "2.0.0",
            "scripts": {"test": "jest", "build": "tsc"},
            "dependencies": {"express": "^4.18.0"},
            "devDependencies": {"jest": "^29.0.0", "typescript": "^5.0.0"},
        }),
        encoding="utf-8",
    )
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "index.ts").write_text("console.log('hello')\n")
    return tmp_path


class TestLoadProjectContext:
    def test_loads_claude_md(self, sample_project: Path):
        ctx = load_project_context(sample_project)
        assert ctx.claude_md is not None
        assert "프로젝트 지침" in ctx.claude_md

    def test_loads_claude_config(self, sample_project: Path):
        ctx = load_project_context(sample_project)
        assert "settings.json" in ctx.claude_config
        assert ctx.claude_config["settings.json"]["model"] == "claude-sonnet-4-20250514"

    def test_detects_python_project(self, sample_project: Path):
        ctx = load_project_context(sample_project)
        assert ctx.project_type == "python"

    def test_detects_node_project(self, node_project: Path):
        ctx = load_project_context(node_project)
        assert ctx.project_type == "node"

    def test_file_tree_includes_sources(self, sample_project: Path):
        ctx = load_project_context(sample_project)
        assert "main.py" in ctx.file_tree
        assert "utils.py" in ctx.file_tree

    def test_file_tree_excludes_git(self, sample_project: Path):
        (sample_project / ".git").mkdir()
        (sample_project / ".git" / "config").write_text("gitconfig")
        ctx = load_project_context(sample_project)
        assert ".git" not in ctx.file_tree.split("\n")[0] if ctx.file_tree else True

    def test_node_project_metadata(self, node_project: Path):
        ctx = load_project_context(node_project)
        assert ctx.project_metadata.get("name") == "test-app"
        assert "express" in ctx.project_metadata.get("dependencies", [])
        assert "jest" in ctx.project_metadata.get("devDependencies", [])

    def test_missing_project_raises(self):
        with pytest.raises(FileNotFoundError):
            load_project_context("/nonexistent/path/to/project")

    def test_no_claude_md(self, tmp_path: Path):
        """CLAUDE.md가 없어도 정상 동작."""
        (tmp_path / "main.py").write_text("pass\n")
        ctx = load_project_context(tmp_path)
        assert ctx.claude_md is None
        assert ctx.project_type == "unknown"

    def test_claude_md_in_dot_claude_dir(self, tmp_path: Path):
        """루트에 없으면 .claude/ 내부 CLAUDE.md를 읽음."""
        claude_dir = tmp_path / ".claude"
        claude_dir.mkdir()
        (claude_dir / "CLAUDE.md").write_text("# 내부 지침\n")
        ctx = load_project_context(tmp_path)
        assert ctx.claude_md is not None
        assert "내부 지침" in ctx.claude_md


class TestBuildContextPrompt:
    def test_includes_project_info(self, sample_project: Path):
        ctx = load_project_context(sample_project)
        prompt = build_context_prompt(ctx)
        assert "프로젝트 정보" in prompt
        assert "python" in prompt

    def test_includes_claude_md(self, sample_project: Path):
        ctx = load_project_context(sample_project)
        prompt = build_context_prompt(ctx)
        assert "CLAUDE.md" in prompt
        assert "프로젝트 지침" in prompt

    def test_includes_file_tree(self, sample_project: Path):
        ctx = load_project_context(sample_project)
        prompt = build_context_prompt(ctx)
        assert "파일 구조" in prompt
        assert "main.py" in prompt

    def test_no_claude_md_section(self, tmp_path: Path):
        (tmp_path / "main.py").write_text("pass\n")
        ctx = load_project_context(tmp_path)
        prompt = build_context_prompt(ctx)
        assert "CLAUDE.md" not in prompt


class TestInjectContext:
    def test_prepends_to_system_prompt(self, sample_project: Path):
        ctx = load_project_context(sample_project)
        scenario = Scenario(
            name="test",
            system_prompt="기존 프롬프트입니다.",
            messages=[{"role": "user", "content": "hello"}],
        )
        inject_context(scenario, ctx)
        assert "프로젝트 정보" in scenario.system_prompt
        assert "기존 프롬프트입니다." in scenario.system_prompt
        # 컨텍스트가 기존 프롬프트보다 앞에 위치
        ctx_pos = scenario.system_prompt.index("프로젝트 정보")
        orig_pos = scenario.system_prompt.index("기존 프롬프트입니다.")
        assert ctx_pos < orig_pos

    def test_sets_system_prompt_when_empty(self, sample_project: Path):
        ctx = load_project_context(sample_project)
        scenario = Scenario(
            name="test",
            messages=[{"role": "user", "content": "hello"}],
        )
        inject_context(scenario, ctx)
        assert "프로젝트 정보" in scenario.system_prompt
