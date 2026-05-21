const state = {
  models: [],
};

const els = {
  modelsList: document.getElementById("models-list"),
  manualModel: document.getElementById("manual-model"),
  mode: document.getElementById("mode"),
  saveBtn: document.getElementById("save-btn"),
  addModelBtn: document.getElementById("add-model-btn"),
  sendBtn: document.getElementById("send-btn"),
  routeOnlyBtn: document.getElementById("route-only-btn"),
  routeOutput: document.getElementById("route-output"),
  answerOutput: document.getElementById("answer-output"),
  routeBadge: document.getElementById("route-badge"),
  backendBadge: document.getElementById("backend-badge"),
  systemPrompt: document.getElementById("system-prompt"),
  message: document.getElementById("message"),
  temperature: document.getElementById("temperature"),
  maxTokens: document.getElementById("max-tokens"),
  template: document.getElementById("model-template"),
};

function uid() {
  return `model-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultModel() {
  return {
    id: uid(),
    name: "OpenAI-Compatible Model",
    base_url: "https://your-openai-compatible-server/v1",
    model: "your-model-id",
    api_key: "",
    provider: "openai_compatible",
    tags: ["chat", "general"],
    priority: 0,
    enabled: true,
  };
}

function readLocalModels() {
  try {
    const raw = localStorage.getItem("multi-model-router.models");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function persistLocalModels(models) {
  localStorage.setItem("multi-model-router.models", JSON.stringify(models));
}

function setStatus(text, kind = "ready") {
  els.routeBadge.textContent = text;
  els.routeBadge.style.background =
    kind === "error"
      ? "linear-gradient(135deg, #ff8ca1, #ffd3a5)"
      : kind === "busy"
        ? "linear-gradient(135deg, #f7d774, #7ff0d6)"
        : "linear-gradient(135deg, #7ff0d6, #6ea8fe)";
}

function setBackendStatus(text, kind = "ready") {
  els.backendBadge.textContent = text;
  els.backendBadge.style.background =
    kind === "error"
      ? "linear-gradient(135deg, #ff8ca1, #ffd3a5)"
      : kind === "busy"
        ? "linear-gradient(135deg, #f7d774, #7ff0d6)"
        : "linear-gradient(135deg, #c5d8ff, #ffffff)";
}

async function probeBackend() {
  const response = await fetch("/api/health");
  if (!response.ok) {
    throw new Error("Backend health check failed");
  }
  return response.json();
}

function createModelElement(model) {
  const node = els.template.content.firstElementChild.cloneNode(true);
  const nameInput = node.querySelector(".model-name");
  const enabledInput = node.querySelector(".model-enabled");
  const baseUrlInput = node.querySelector(".model-base-url");
  const modelInput = node.querySelector(".model-model");
  const apiKeyInput = node.querySelector(".model-api-key");
  const tagsInput = node.querySelector(".model-tags");
  const priorityInput = node.querySelector(".model-priority");
  const removeBtn = node.querySelector(".remove-model");

  nameInput.value = model.name || "";
  enabledInput.checked = model.enabled !== false;
  baseUrlInput.value = model.base_url || "";
  modelInput.value = model.model || "";
  apiKeyInput.value = model.api_key || "";
  tagsInput.value = Array.isArray(model.tags) ? model.tags.join(",") : "chat";
  priorityInput.value = model.priority ?? 0;

  nameInput.dataset.id = model.id;
  enabledInput.dataset.id = model.id;
  baseUrlInput.dataset.id = model.id;
  modelInput.dataset.id = model.id;
  apiKeyInput.dataset.id = model.id;
  tagsInput.dataset.id = model.id;
  priorityInput.dataset.id = model.id;
  removeBtn.dataset.id = model.id;

  removeBtn.addEventListener("click", () => {
    state.models = state.models.filter((item) => item.id !== model.id);
    renderModels();
  });

  node.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => {
      const current = state.models.find((item) => item.id === model.id);
      if (!current) return;
      current.name = nameInput.value;
      current.enabled = enabledInput.checked;
      current.base_url = baseUrlInput.value;
      current.model = modelInput.value;
      current.api_key = apiKeyInput.value;
      current.tags = tagsInput.value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      current.priority = Number(priorityInput.value || 0);
      refreshManualOptions();
    });
  });

  return node;
}

function renderModels() {
  els.modelsList.innerHTML = "";
  state.models.forEach((model) => els.modelsList.appendChild(createModelElement(model)));
  if (state.models.length === 0) {
    els.modelsList.innerHTML = '<p class="muted">No models configured yet. Add one to begin routing.</p>';
  }
  refreshManualOptions();
}

function refreshManualOptions() {
  const currentValue = els.manualModel.value;
  els.manualModel.innerHTML = "";
  const autoOption = document.createElement("option");
  autoOption.value = "";
  autoOption.textContent = "Auto pick";
  els.manualModel.appendChild(autoOption);
  state.models.forEach((model) => {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = `${model.name || model.id} (${(model.tags || []).join(",") || "untagged"})`;
    els.manualModel.appendChild(option);
  });
  els.manualModel.value = currentValue;
}

async function loadModels() {
  setBackendStatus("Connecting...", "busy");
  const local = readLocalModels();
  if (local && local.length) {
    state.models = local;
    renderModels();
  }

  try {
    await probeBackend();
    const response = await fetch("/api/models");
    const data = await response.json();
    if (Array.isArray(data.models) && data.models.length) {
      state.models = data.models;
      persistLocalModels(state.models);
      renderModels();
      setBackendStatus("Backend synced", "ready");
    } else if (!state.models.length) {
      state.models = [defaultModel()];
      renderModels();
      setBackendStatus("Backend empty", "ready");
    }
  } catch {
    if (!state.models.length) {
      state.models = [defaultModel()];
      renderModels();
    }
    setBackendStatus("Backend offline", "error");
  }
}

function buildPayload() {
  return {
    message: els.message.value,
    history: [],
    system_prompt: els.systemPrompt.value,
    mode: els.mode.value,
    model_id: els.manualModel.value || null,
    temperature: Number(els.temperature.value || 0.4),
    max_tokens: Number(els.maxTokens.value || 512),
  };
}

async function saveModels() {
  persistLocalModels(state.models);
  setBackendStatus("Saving to backend...", "busy");
  const response = await fetch("/api/models", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ models: state.models }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to save models");
  }
  setBackendStatus("Backend synced", "ready");
}

async function previewRoute() {
  setStatus("Routing...", "busy");
  const payload = buildPayload();
  const response = await fetch("/api/test-route", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || "Routing preview failed");
  els.routeOutput.textContent = JSON.stringify(data, null, 2);
  setStatus(`Preview: ${data.route.selected_model_name}`, "ready");
}

async function sendPrompt() {
  setStatus("Sending...", "busy");
  els.answerOutput.textContent = "Waiting for model response...";
  const payload = buildPayload();
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || "Chat request failed");
  els.routeOutput.textContent = JSON.stringify(data.route, null, 2);
  els.answerOutput.textContent = data.output || "";
  setStatus(`Answered by ${data.model.name}`, "ready");
}

els.addModelBtn.addEventListener("click", () => {
  state.models.push(defaultModel());
  renderModels();
});

els.saveBtn.addEventListener("click", async () => {
  try {
    setStatus("Saving models...", "busy");
    await saveModels();
    setStatus("Models saved", "ready");
  } catch (error) {
    setStatus("Save failed", "error");
    els.routeOutput.textContent = String(error.message || error);
  }
});

els.routeOnlyBtn.addEventListener("click", async () => {
  try {
    await previewRoute();
  } catch (error) {
    setStatus("Preview failed", "error");
    els.routeOutput.textContent = String(error.message || error);
  }
});

els.sendBtn.addEventListener("click", async () => {
  try {
    await saveModels();
    await sendPrompt();
  } catch (error) {
    setStatus("Request failed", "error");
    els.answerOutput.textContent = String(error.message || error);
  }
});

window.addEventListener("beforeunload", () => {
  persistLocalModels(state.models);
});

loadModels().then(() => {
  if (!state.models.length) {
    state.models = [defaultModel()];
    renderModels();
  }
  if (els.backendBadge.textContent === "Connecting...") {
    setBackendStatus("Backend ready", "ready");
  }
  setStatus("Ready", "ready");
});
