"""러너 단위 테스트 - API 호출을 mock하여 호출 분류 로직 검증."""

from __future__ import annotations

from agent_harness.runner import _classify_call


class TestClassifyCall:
    def test_regular_tool(self):
        call_type, name = _classify_call("Read", {"file_path": "a.py"})
        assert call_type == "tool"
        assert name == "Read"

    def test_task_as_agent(self):
        call_type, name = _classify_call("Task", {
            "subagent_type": "Explore",
            "prompt": "find files",
        })
        assert call_type == "agent"
        assert name == "Explore"

    def test_skill_call(self):
        call_type, name = _classify_call("Skill", {"skill": "commit"})
        assert call_type == "skill"
        assert name == "commit"

    def test_task_without_subagent_type(self):
        call_type, name = _classify_call("Task", {"prompt": "do something"})
        assert call_type == "agent"
        assert name == "unknown"
