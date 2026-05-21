# Open WebUI Connection

This workspace now exposes OpenAI-compatible endpoints at:

- `http://localhost:8000/v1/models`
- `http://localhost:8000/v1/chat/completions`

Open WebUI can connect to this backend directly.

## Option 1: Docker image

If your backend is running on the host at port `8000`, launch Open WebUI with:

```bash
docker compose -f docker-compose.openwebui.yml up -d
```

Then open:

- `http://localhost:3000`

## Option 2: Open WebUI admin settings

In Open WebUI:

1. Go to `Admin Settings`
2. Open `Connections`
3. Add an `OpenAI` / `Standard Compatible` connection
4. Set the base URL to `http://host.docker.internal:8000/v1`
5. Set the API key to any placeholder value, such as `local-key`

## Notes

- The backend returns a model list from `/v1/models`.
- The backend routes chat requests through the configured model server URLs.
- Update the models in the local router UI or by editing `data/models.json`.
