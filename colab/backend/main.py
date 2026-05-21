from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .provider import ProviderError, chat_completion
from .router import ModelConfig, RouterState, TaskType, normalize_model_list, select_model


BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
MODELS_FILE = DATA_DIR / "models.json"

app = FastAPI(title="Multi-Model Router", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class ChatMessage(BaseModel):
    role: str
    content: str


class ModelsUpdateRequest(BaseModel):
    models: list[dict[str, Any]] = Field(default_factory=list)


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)
    mode: str = "auto"
    model_id: str | None = None
    task_type: TaskType | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    system_prompt: str | None = None


router_state = RouterState(
    models=[
        ModelConfig(
            id="default-chat",
            name="Default Chat Model",
            base_url="https://your-openai-compatible-server/v1",
            model="your-model-id",
            tags=["chat", "general"],
            priority=10,
        )
    ]
)


def _load_models_from_disk() -> list[ModelConfig]:
    if not MODELS_FILE.exists():
        return router_state.models
    try:
        raw = json.loads(MODELS_FILE.read_text(encoding="utf-8"))
        if not isinstance(raw, list):
            return router_state.models
        return normalize_model_list(raw)
    except Exception:
        return router_state.models


def _save_models_to_disk(models: list[ModelConfig]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = [model.model_dump() for model in models]
    MODELS_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")


router_state.models = _load_models_from_disk()


@app.get("/")
async def home() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/models")
async def get_models() -> dict[str, Any]:
    return {"models": [model.model_dump() for model in router_state.models]}


@app.put("/api/models")
async def set_models(payload: ModelsUpdateRequest) -> dict[str, Any]:
    try:
        router_state.models = normalize_model_list(payload.models)
        _save_models_to_disk(router_state.models)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "models": [model.model_dump() for model in router_state.models]}


@app.post("/api/chat")
async def chat(payload: ChatRequest) -> dict[str, Any]:
    if not payload.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    try:
        selected_model, decision = select_model(
            router_state,
            text=payload.message,
            preferred_model_id=payload.model_id if payload.mode == "manual" else None,
            requested_task_type=payload.task_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    messages = []
    if payload.system_prompt:
        messages.append({"role": "system", "content": payload.system_prompt})
    messages.extend([item.model_dump() for item in payload.history])
    messages.append({"role": "user", "content": payload.message})

    try:
        completion = await chat_completion(
            selected_model,
            messages=messages,
            temperature=payload.temperature
            if payload.temperature is not None
            else selected_model.temperature,
            max_tokens=payload.max_tokens if payload.max_tokens is not None else selected_model.max_tokens,
        )
    except ProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        "route": decision.model_dump(),
        "model": selected_model.model_dump(),
        "output": completion["content"],
        "raw": completion["raw"],
    }


@app.post("/api/test-route")
async def test_route(payload: ChatRequest) -> dict[str, Any]:
    try:
        selected_model, decision = select_model(
            router_state,
            text=payload.message,
            preferred_model_id=payload.model_id if payload.mode == "manual" else None,
            requested_task_type=payload.task_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "route": decision.model_dump(),
        "model": selected_model.model_dump(),
    }
