"""YAML 파일에서 시나리오를 로드."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from .models import Scenario


def load_scenario(path: str | Path) -> Scenario:
    """YAML 파일 하나에서 시나리오 로드."""
    with open(path) as f:
        data: dict[str, Any] = yaml.safe_load(f)
    return Scenario(**data)


def load_scenarios(directory: str | Path) -> list[Scenario]:
    """디렉토리 내 모든 YAML 시나리오를 로드."""
    d = Path(directory)
    scenarios: list[Scenario] = []
    for path in sorted(d.glob("*.yaml")):
        scenarios.append(load_scenario(path))
    for path in sorted(d.glob("*.yml")):
        scenarios.append(load_scenario(path))
    return scenarios
