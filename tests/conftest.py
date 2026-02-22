"""pytest fixtures."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from agent_harness.models import Scenario, ScenarioResult, TokenUsage
from agent_harness.runner import ScenarioRunner


SCENARIOS_DIR = Path(__file__).parent.parent / "scenarios"


@pytest.fixture
def scenarios_dir() -> Path:
    return SCENARIOS_DIR


@pytest.fixture
def mock_runner() -> ScenarioRunner:
    """API 호출 없이 도구 호출 검증만 테스트하기 위한 mock runner."""
    runner = ScenarioRunner.__new__(ScenarioRunner)
    runner._client = MagicMock()
    runner._tool_results = {}
    return runner
