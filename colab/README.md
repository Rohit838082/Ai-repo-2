# Multi-Model Router

A small FastAPI web app for routing prompts to multiple AI model servers or OpenAI-compatible APIs.

## What it does

- Lets you register multiple model endpoints
- Routes prompts automatically by task type
- Supports manual model selection
- Serves a web UI for testing routing and responses
- Starts with placeholder model values so you can replace them with your own servers or APIs
- Saves the model list on the backend so it survives refreshes and restarts

## Supported provider shape

This starter currently targets **OpenAI-compatible Chat Completions endpoints**:

- `http://host/v1/chat/completions`
- `https://api.openai.com/v1/chat/completions`
- local servers that mirror that API shape

## Run locally

### Node fallback server

If Python is not installed, run the UI with the built-in Node server:

```bash
node dev-server.js
```

Then open:

- `http://localhost:8000`

### Python backend

```bash
pip install -r requirements.txt
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

## How routing works

- `code` prompts go to models tagged with `code`
- `math` prompts go to models tagged with `math`
- `reasoning` prompts go to models tagged with `reasoning`
- everything else goes to `chat` or `general`

## Open WebUI

The backend now exposes OpenAI-compatible routes for Open WebUI:

- `GET /v1/models`
- `POST /v1/chat/completions`

See [`OPENWEBUI.md`](./OPENWEBUI.md) for the exact connection steps.

## Next upgrades

- Add Anthropic and Gemini adapters
- Add streaming responses in the UI
- Add health checks and latency-based ranking
- Add per-model retries and automatic fallback
- Persist config to SQLite or a JSON file
