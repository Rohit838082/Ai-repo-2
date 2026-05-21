from __future__ import annotations

from typing import Any

import httpx

from .router import ModelConfig


class ProviderError(RuntimeError):
    pass


def _completion_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    if base.endswith("/v1"):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


async def chat_completion(
    model: ModelConfig,
    messages: list[dict[str, str]],
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> dict[str, Any]:
    url = _completion_url(model.base_url)
    payload: dict[str, Any] = {
        "model": model.model,
        "messages": messages,
        "stream": False,
    }
    if temperature is not None:
        payload["temperature"] = temperature
    if max_tokens is not None:
        payload["max_tokens"] = max_tokens

    headers = {
        "Content-Type": "application/json",
    }
    if model.api_key:
        headers["Authorization"] = f"Bearer {model.api_key}"

    timeout = httpx.Timeout(120.0, connect=20.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            body = exc.response.text[:2000]
            raise ProviderError(
                f"{model.name} returned HTTP {exc.response.status_code}: {body}"
            ) from exc
        except httpx.HTTPError as exc:
            raise ProviderError(f"Failed to reach {model.name} at {url}: {exc}") from exc

    data = response.json()
    choices = data.get("choices") or []
    if not choices:
        raise ProviderError(f"{model.name} returned an empty completion response.")

    first = choices[0]
    message = first.get("message") or {}
    content = message.get("content")
    if content is None:
        raise ProviderError(f"{model.name} did not return message content.")

    return {
        "content": content,
        "raw": data,
    }
