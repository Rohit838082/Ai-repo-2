const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const rootDir = __dirname;
const staticDir = path.join(rootDir, "static");
const dataDir = path.join(rootDir, "data");
const modelsFile = path.join(dataDir, "models.json");
const port = Number(process.env.PORT || 8000);

const defaultModels = [
  {
    id: "default-chat",
    name: "Default Chat Model",
    base_url: "https://your-openai-compatible-server/v1",
    model: "your-model-id",
    tags: ["chat", "general"],
    priority: 10,
    enabled: true,
  },
];

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return fallback;
  }
}

function loadModels() {
  const data = readJsonFile(modelsFile, null);
  if (!Array.isArray(data) || data.length === 0) {
    return defaultModels.slice();
  }
  return data.map((item, index) => ({
    id: String(item.id || `model-${index + 1}`),
    name: String(item.name || `Model ${index + 1}`),
    base_url: String(item.base_url || ""),
    model: String(item.model || ""),
    api_key: item.api_key ? String(item.api_key) : "",
    provider: String(item.provider || "openai_compatible"),
    tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag)) : ["chat"],
    priority: Number.isFinite(Number(item.priority)) ? Number(item.priority) : 0,
    enabled: item.enabled !== false,
    temperature:
      item.temperature === null || item.temperature === undefined
        ? null
        : Number(item.temperature),
    max_tokens:
      item.max_tokens === null || item.max_tokens === undefined
        ? null
        : Number(item.max_tokens),
  }));
}

function saveModels(models) {
  ensureDataDir();
  fs.writeFileSync(modelsFile, JSON.stringify(models, null, 2), "utf8");
}

function inferTaskType(text) {
  const value = String(text || "").toLowerCase();
  if (/\b(code|coding|program|programming|python|javascript|typescript|java|cpp|c\+\+|rust|go|sql|regex|api|endpoint|function|class|bug|error|stack trace|traceback|refactor|debug|fix|deploy|docker|fastapi|react)\b/i.test(value)) {
    return "code";
  }
  if (/\b(math|equation|integral|derivative|proof|theorem|algebra|geometry|probability|statistics|calculate|compute|solve)\b/i.test(value)) {
    return "math";
  }
  if (/\b(analyze|analysis|compare|tradeoff|strategy|plan|design|evaluate|reason|why|should|decision|optimize)\b/i.test(value)) {
    return "reasoning";
  }
  return "chat";
}

function matchesTask(model, taskType) {
  const tags = new Set((model.tags || []).map((tag) => String(tag).toLowerCase()));
  return tags.has(taskType) || (taskType === "chat" && tags.has("general"));
}

function selectModel(models, text, preferredModelId, requestedTaskType) {
  const enabledModels = models.filter((model) => model.enabled !== false);
  if (!enabledModels.length) {
    throw new Error("No enabled models are configured.");
  }

  const taskType = requestedTaskType || inferTaskType(text);

  if (preferredModelId) {
    const selected = enabledModels.find((model) => model.id === preferredModelId);
    if (!selected) {
      throw new Error(`Unknown or disabled model: ${preferredModelId}`);
    }
    return {
      model: selected,
      route: {
        task_type: taskType,
        selected_model_id: selected.id,
        selected_model_name: selected.name,
        reason: "Manual model selection",
        fallbacks: enabledModels.filter((model) => model.id !== selected.id).map((model) => model.id),
      },
    };
  }

  const scored = enabledModels.map((model) => {
    let score = Number(model.priority || 0);
    const tagSet = new Set((model.tags || []).map((tag) => String(tag).toLowerCase()));
    if (matchesTask(model, taskType)) {
      score += 100;
    } else if (taskType === "chat" && tagSet.has("chat")) {
      score += 40;
    } else if (tagSet.has("general")) {
      score += 25;
    } else if (taskType === "reasoning" && tagSet.has("reasoning")) {
      score += 20;
    }
    return { score, tagCount: tagSet.size, model };
  });

  scored.sort((a, b) => b.score - a.score || b.tagCount - a.tagCount || a.model.name.localeCompare(b.model.name));
  const selected = scored[0].model;
  return {
    model: selected,
    route: {
      task_type: taskType,
      selected_model_id: selected.id,
      selected_model_name: selected.name,
      reason: `Auto-routed as ${taskType}${matchesTask(selected, taskType) ? ` to ${selected.name}` : ""}`,
      fallbacks: scored.slice(1).map((item) => item.model.id),
    },
  };
}

function completionUrl(baseUrl) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  if (!base) return "";
  if (base.endsWith("/chat/completions")) return base;
  if (base.endsWith("/v1")) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
  });
  res.end(text);
}

function openAIModelsResponse(models) {
  return {
    object: "list",
    data: models
      .filter((model) => model.enabled !== false)
      .map((model) => ({
        id: model.model || model.id,
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: model.name || "open-webui-backend",
      })),
  };
}

function openAIChatResponse(model, content) {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: model.model || model.id,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: String(content),
        },
        finish_reason: "stop",
      },
    ],
  };
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function safeStaticPath(urlPath) {
  const normalized = String(urlPath || "").replace(/^\/static\//, "");
  if (normalized.includes("..")) {
    return null;
  }
  return path.join(staticDir, normalized);
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

async function handleChat(payload) {
  const models = loadModels();
  if (!String(payload.message || "").trim()) {
    throw new Error("Message cannot be empty.");
  }

  const { model, route } = selectModel(
    models,
    payload.message,
    payload.mode === "manual" ? payload.model_id : null,
    payload.task_type || null
  );

  const url = completionUrl(model.base_url);
  if (!url) {
    throw new Error(`Model ${model.name} does not have a valid base_url.`);
  }

  const messages = [];
  if (payload.system_prompt) {
    messages.push({ role: "system", content: String(payload.system_prompt) });
  }
  if (Array.isArray(payload.history)) {
    for (const item of payload.history) {
      if (item && item.role && item.content !== undefined) {
        messages.push({ role: String(item.role), content: String(item.content) });
      }
    }
  }
  messages.push({ role: "user", content: String(payload.message) });

  const requestBody = {
    model: model.model,
    messages,
    stream: false,
  };
  if (payload.temperature !== undefined && payload.temperature !== null) {
    requestBody.temperature = Number(payload.temperature);
  } else if (model.temperature !== null && model.temperature !== undefined) {
    requestBody.temperature = Number(model.temperature);
  }
  if (payload.max_tokens !== undefined && payload.max_tokens !== null) {
    requestBody.max_tokens = Number(payload.max_tokens);
  } else if (model.max_tokens !== null && model.max_tokens !== undefined) {
    requestBody.max_tokens = Number(model.max_tokens);
  }

  const headers = {
    "Content-Type": "application/json",
  };
  if (model.api_key) {
    headers.Authorization = `Bearer ${model.api_key}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${model.name} returned HTTP ${response.status}: ${errorText.slice(0, 2000)}`);
  }

  const data = await response.json();
  const choice = data.choices && data.choices[0];
  const content = choice && choice.message && choice.message.content;
  if (content === undefined || content === null) {
    throw new Error(`${model.name} did not return message content.`);
  }

  return {
    route,
    model,
    output: content,
    raw: data,
  };
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = requestUrl.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  try {
    if (req.method === "GET" && pathname === "/api/health") {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    if (req.method === "GET" && pathname === "/api/models") {
      sendJson(res, 200, { models: loadModels() });
      return;
    }

    if (req.method === "GET" && (pathname === "/v1/models" || pathname === "/models")) {
      sendJson(res, 200, openAIModelsResponse(loadModels()));
      return;
    }

    if (req.method === "PUT" && pathname === "/api/models") {
      const payload = await readRequestBody(req);
      if (!payload || !Array.isArray(payload.models)) {
        sendJson(res, 400, { detail: "models must be an array" });
        return;
      }
      const models = payload.models.map((item, index) => ({
        id: String(item.id || `model-${index + 1}`),
        name: String(item.name || `Model ${index + 1}`),
        base_url: String(item.base_url || ""),
        model: String(item.model || ""),
        api_key: item.api_key ? String(item.api_key) : "",
        provider: String(item.provider || "openai_compatible"),
        tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag)) : ["chat"],
        priority: Number.isFinite(Number(item.priority)) ? Number(item.priority) : 0,
        enabled: item.enabled !== false,
        temperature:
          item.temperature === null || item.temperature === undefined
            ? null
            : Number(item.temperature),
        max_tokens:
          item.max_tokens === null || item.max_tokens === undefined
            ? null
            : Number(item.max_tokens),
      }));
      saveModels(models);
      sendJson(res, 200, { ok: true, models });
      return;
    }

    if (req.method === "POST" && pathname === "/api/test-route") {
      const payload = await readRequestBody(req);
      const models = loadModels();
      const { model, route } = selectModel(
        models,
        payload.message,
        payload.mode === "manual" ? payload.model_id : null,
        payload.task_type || null
      );
      sendJson(res, 200, { route, model });
      return;
    }

    if (req.method === "POST" && pathname === "/api/chat") {
      const payload = await readRequestBody(req);
      const result = await handleChat(payload);
      sendJson(res, 200, result);
      return;
    }

    if (
      req.method === "POST" &&
      (pathname === "/v1/chat/completions" || pathname === "/chat/completions")
    ) {
      const payload = await readRequestBody(req);
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const systemMessage = messages.find((item) => item && item.role === "system");
      const lastMessage = messages[messages.length - 1] || {};
      const result = await handleChat({
        message: lastMessage.content || "",
        history: messages
          .slice(0, -1)
          .filter((item) => item && item.role !== "system")
          .map((item) => ({
              role: item.role,
              content: item.content,
            }))
        ,
        mode: payload.model ? "manual" : "auto",
        model_id: payload.model || null,
        task_type: payload.task_type || null,
        temperature: payload.temperature,
        max_tokens: payload.max_tokens,
        system_prompt: systemMessage ? systemMessage.content : null,
      });
      sendJson(res, 200, openAIChatResponse(result.model, result.output));
      return;
    }

    if (req.method === "GET") {
      const filePath = pathname === "/" ? path.join(staticDir, "index.html") : safeStaticPath(pathname);
      if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        res.writeHead(200, {
          "Content-Type": contentTypeFor(filePath),
          "Access-Control-Allow-Origin": "*",
        });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    }

    sendJson(res, 404, { detail: "Not found" });
  } catch (error) {
    sendJson(res, 500, { detail: error.message || String(error) });
  }
});

server.listen(port, "0.0.0.0", () => {
  ensureDataDir();
  if (!fs.existsSync(modelsFile)) {
    saveModels(defaultModels.slice());
  }
  console.log(`Multi-Model Router UI running at http://localhost:${port}`);
});
