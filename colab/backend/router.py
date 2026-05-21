from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class TaskType(str, Enum):
    chat = "chat"
    code = "code"
    math = "math"
    reasoning = "reasoning"


class ModelConfig(BaseModel):
    id: str
    name: str
    base_url: str
    model: str
    api_key: str | None = None
    provider: str = "openai_compatible"
    tags: list[str] = Field(default_factory=lambda: ["chat"])
    priority: int = 0
    enabled: bool = True
    temperature: float | None = None
    max_tokens: int | None = None


class RouteDecision(BaseModel):
    task_type: TaskType
    selected_model_id: str
    selected_model_name: str
    reason: str
    fallbacks: list[str] = Field(default_factory=list)


@dataclass
class RouterState:
    models: list[ModelConfig] = field(default_factory=list)


_CODE_HINTS = re.compile(
    r"\b("
    r"code|coding|program|programming|python|javascript|typescript|typescript|"
    r"java|cpp|c\+\+|rust|go|sql|regex|api|endpoint|function|class|bug|error|"
    r"stack trace|traceback|refactor|debug|fix|deploy|docker|fastapi|react"
    r")\b",
    re.IGNORECASE,
)
_MATH_HINTS = re.compile(
    r"\b("
    r"math|equation|integral|derivative|proof|theorem|algebra|geometry|"
    r"probability|statistics|calculate|compute|solve"
    r")\b",
    re.IGNORECASE,
)
_REASONING_HINTS = re.compile(
    r"\b("
    r"analyze|analysis|compare|tradeoff|strategy|plan|design|evaluate|"
    r"reason|why|should|decision|optimize"
    r")\b",
    re.IGNORECASE,
)


def infer_task_type(text: str) -> TaskType:
    sample = text.strip()
    if _CODE_HINTS.search(sample):
        return TaskType.code
    if _MATH_HINTS.search(sample):
        return TaskType.math
    if _REASONING_HINTS.search(sample):
        return TaskType.reasoning
    return TaskType.chat


def _matches_task(model: ModelConfig, task_type: TaskType) -> bool:
    tags = {tag.lower() for tag in model.tags}
    if task_type.value in tags:
        return True
    if task_type == TaskType.chat and "general" in tags:
        return True
    return False


def select_model(
    state: RouterState,
    text: str,
    preferred_model_id: str | None = None,
    requested_task_type: TaskType | None = None,
) -> tuple[ModelConfig, RouteDecision]:
    enabled_models = [model for model in state.models if model.enabled]
    if not enabled_models:
        raise ValueError("No enabled models are configured.")

    task_type = requested_task_type or infer_task_type(text)

    if preferred_model_id:
        selected = next((m for m in enabled_models if m.id == preferred_model_id), None)
        if selected is None:
            raise ValueError(f"Unknown or disabled model: {preferred_model_id}")
        decision = RouteDecision(
            task_type=task_type,
            selected_model_id=selected.id,
            selected_model_name=selected.name,
            reason="Manual model selection",
            fallbacks=[m.id for m in enabled_models if m.id != selected.id],
        )
        return selected, decision

    scored: list[tuple[int, int, ModelConfig]] = []
    for model in enabled_models:
        score = model.priority
        if _matches_task(model, task_type):
            score += 100
        elif task_type == TaskType.chat and ("chat" in {t.lower() for t in model.tags}):
            score += 40
        elif "general" in {t.lower() for t in model.tags}:
            score += 25
        elif "reasoning" in {t.lower() for t in model.tags} and task_type == TaskType.reasoning:
            score += 20
        scored.append((score, -len(model.tags), model))

    scored.sort(key=lambda item: (item[0], item[1], item[2].name), reverse=True)
    selected = scored[0][2]

    fallback_ids = [model.id for _, _, model in scored[1:]]
    reason = f"Auto-routed as {task_type.value}"
    if _matches_task(selected, task_type):
        reason += f" to {selected.name}"
    else:
        reason += f"; highest-priority available model was {selected.name}"

    decision = RouteDecision(
        task_type=task_type,
        selected_model_id=selected.id,
        selected_model_name=selected.name,
        reason=reason,
        fallbacks=fallback_ids,
    )
    return selected, decision


def normalize_model_list(items: list[dict[str, Any]]) -> list[ModelConfig]:
    models: list[ModelConfig] = []
    for item in items:
        models.append(ModelConfig.model_validate(item))
    return models
