function createTestManager(deps) {
  const {
    t,
    textValue,
    escapeHtml,
    normalizeList,
    setActiveTestTaskId,
    getRunningTask,
    updateTestStats,
    createRunningTask,
    patchRunningTask,
    finishRunningTask,
    getApis,
    setApis,
    renderApis,
    loadPool,
    withButtonLoading,
    req,
    showNoticeModal,
    getBatchTestNames,
    getBatchTestRange,
  } = deps;

  let testStreamAbort = null;
  let singleRepeatRunning = false;
  let singleRepeatTimer = null;
  let singleRepeatPayload = null;
  let singleRepeatCount = 0;
  let singleRepeatPaused = false;
  let singleRepeatTaskId = "";
  let singleTestParamSnapshot = {};
  let singleTestParamExpanded = false;
  let batchRunning = false;
  let batchPaused = false;
  let batchControlsVisible = false;
  let batchDoneHintTimer = null;

  function showBatchDoneHint(message) {
    const id = "batchDoneHint";
    let node = document.getElementById(id);
    if (!node) {
      node = document.createElement("div");
      node.id = id;
      node.style.position = "fixed";
      node.style.right = "16px";
      node.style.bottom = "16px";
      node.style.zIndex = "1200";
      node.style.padding = "10px 12px";
      node.style.borderRadius = "10px";
      node.style.background = "rgba(24, 24, 28, 0.92)";
      node.style.color = "#fff";
      node.style.fontSize = "13px";
      node.style.lineHeight = "1.4";
      node.style.boxShadow = "0 8px 24px rgba(0,0,0,0.25)";
      node.style.pointerEvents = "none";
      node.style.opacity = "0";
      node.style.transform = "translateY(8px)";
      node.style.transition = "opacity .18s ease, transform .18s ease";
      document.body.appendChild(node);
    }
    node.textContent = textValue(message);
    node.style.opacity = "1";
    node.style.transform = "translateY(0)";
    if (batchDoneHintTimer) {
      clearTimeout(batchDoneHintTimer);
      batchDoneHintTimer = null;
    }
    batchDoneHintTimer = setTimeout(() => {
      node.style.opacity = "0";
      node.style.transform = "translateY(8px)";
    }, 2200);
  }

  function isBlankRuntimeValue(value) {
    return value === null || value === undefined || (typeof value === "string" && !value.trim());
  }

  function setSingleTestParamSheetExpanded(expanded) {
    const controls = document.getElementById("singleTestParamControls");
    const toggle = document.getElementById("singleTestParamToggle");
    if (!controls || !toggle) return;
    const next = Boolean(expanded);
    singleTestParamExpanded = next;
    controls.classList.toggle("is-expanded", next);
    toggle.setAttribute("aria-expanded", next ? "true" : "false");
  }

  function onToggleSingleTestParamSheetClick() {
    const controls = document.getElementById("singleTestParamControls");
    if (!controls || !controls.classList.contains("is-visible")) return;
    setSingleTestParamSheetExpanded(!controls.classList.contains("is-expanded"));
  }

  function refreshSingleTestParamToggleText() {
    const textNode = document.getElementById("singleTestParamToggleText");
    const rows = document.getElementById("singleTestParamsRows");
    if (!textNode || !rows) return;
    const inputs = Array.from(rows.querySelectorAll("input[data-test-param-key]"));
    const total = inputs.length;
    const filled = inputs.filter((input) => textValue(input?.value).trim()).length;
    textNode.textContent = `${t("test_params")} (${filled}/${total})`;
  }

  function buildDefaultTestParamValue(key) {
    const name = textValue(key).trim().toLowerCase();
    if (!name) return "test";
    if (name.includes("page") || name.includes("size") || name.endsWith("id")) return "1";
    if (name.includes("time") || name.includes("ts") || name.includes("timestamp")) {
      return String(Date.now());
    }
    return "test";
  }

  function buildSingleTestParamEntries(payload) {
    const params =
      payload && typeof payload === "object" && payload.params && typeof payload.params === "object"
        ? payload.params
        : {};
    return Object.entries(params).map(([key, value]) => {
      const fallback = buildDefaultTestParamValue(key);
      const currentValue = isBlankRuntimeValue(value) ? fallback : textValue(value);
      return { key: textValue(key), value: textValue(currentValue) };
    });
  }

  function readSingleTestParamInputs() {
    const rows = document.getElementById("singleTestParamsRows");
    const output = {};
    if (!rows) return output;
    rows.querySelectorAll("input[data-test-param-key]").forEach((input) => {
      const key = textValue(input?.getAttribute("data-test-param-key"));
      if (!key) return;
      output[key] = textValue(input.value);
    });
    return output;
  }

  function renderSingleTestParamInputs(payload = null, entries = null) {
    const rows = document.getElementById("singleTestParamsRows");
    if (!rows) return;
    rows.innerHTML = "";
    const finalEntries = Array.isArray(entries) ? entries : buildSingleTestParamEntries(payload);
    finalEntries.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "single-test-param-row";

      const keyNode = document.createElement("span");
      keyNode.className = "single-test-param-key";
      keyNode.textContent = entry.key;

      const input = document.createElement("input");
      input.type = "text";
      input.className = "text-input single-test-param-input";
      input.setAttribute("data-test-param-key", entry.key);
      input.value = Object.prototype.hasOwnProperty.call(singleTestParamSnapshot, entry.key)
        ? textValue(singleTestParamSnapshot[entry.key])
        : entry.value;
      input.addEventListener("input", () => {
        refreshSingleTestParamToggleText();
      });

      row.appendChild(keyNode);
      row.appendChild(input);
      rows.appendChild(row);
    });
  }

  function setSingleTestParamControlsVisible(visible, payload = null) {
    const controls = document.getElementById("singleTestParamControls");
    if (!controls) return;
    const rows = document.getElementById("singleTestParamsRows");
    if (!visible) {
      setSingleTestParamSheetExpanded(false);
      controls.classList.remove("is-visible");
      singleTestParamSnapshot = {};
      if (rows) rows.innerHTML = "";
      return;
    }
    const entries = buildSingleTestParamEntries(payload);
    if (!entries.length) {
      setSingleTestParamSheetExpanded(false);
      controls.classList.remove("is-visible");
      if (rows) rows.innerHTML = "";
      return;
    }
    controls.classList.add("is-visible");
    renderSingleTestParamInputs(payload, entries);
    setSingleTestParamSheetExpanded(false);
    refreshSingleTestParamToggleText();
  }

  function buildSingleTestPayload(payload) {
    const base = payload && typeof payload === "object" ? payload : {};
    const params =
      base.params && typeof base.params === "object" && !Array.isArray(base.params)
        ? { ...base.params }
        : {};
    const inputs = readSingleTestParamInputs();
    Object.keys(params).forEach((key) => {
      const fromInput = textValue(inputs[key]);
      if (!isBlankRuntimeValue(fromInput)) {
        params[key] = fromInput;
        return;
      }
      if (isBlankRuntimeValue(params[key])) {
        params[key] = buildDefaultTestParamValue(key);
      }
    });
    singleTestParamSnapshot = { ...inputs };
    return { ...base, params };
  }

  function getSingleRepeatIntervalSeconds() {
    const input = document.getElementById("singleTestInterval");
    const raw = Number.parseFloat(textValue(input?.value || "3"));
    if (!Number.isFinite(raw) || raw < 0) {
      throw new Error(t("test_repeat_invalid_interval"));
    }
    return raw;
  }

  function getSingleRepeatTimes() {
    const input = document.getElementById("singleTestTimes");
    const raw = Number.parseInt(textValue(input?.value || "1"), 10);
    if (!Number.isFinite(raw) || raw < 1) {
      throw new Error(t("test_repeat_invalid_times"));
    }
    return raw;
  }

  function refreshSingleRepeatPauseButton() {
    const btn = document.getElementById("btnSingleTestPause");
    if (!btn) return;
    btn.classList.toggle("is-visible", Boolean(singleRepeatRunning));
    btn.disabled = !singleRepeatRunning;
    btn.textContent = singleRepeatPaused ? t("test_repeat_resume") : t("test_repeat_pause");
  }

  function refreshSingleRepeatButtonLabel() {
    const btn = document.getElementById("btnSingleTestRepeat");
    if (!btn) return;
    btn.textContent = singleRepeatRunning ? t("test_repeat_stop") : t("test");
    refreshSingleRepeatPauseButton();
  }

  function refreshBatchPauseButton() {
    const btn = document.getElementById("btnBatchTestPause");
    if (!btn) return;
    btn.textContent = batchPaused ? t("test_repeat_resume") : t("test_repeat_pause");
    btn.disabled = !batchRunning;
  }

  function refreshBatchControls() {
    const controls = document.getElementById("batchTestControls");
    if (controls) controls.classList.toggle("is-visible", Boolean(batchControlsVisible));
    const stopBtn = document.getElementById("btnBatchTestStop");
    if (stopBtn) stopBtn.disabled = !batchRunning;
    refreshBatchPauseButton();
  }

  function setBatchControlsVisible(visible) {
    batchControlsVisible = Boolean(visible);
    if (!visible) {
      batchRunning = false;
      batchPaused = false;
    }
    refreshBatchControls();
  }

  async function waitIfBatchPaused() {
    while (batchRunning && batchPaused) {
      await new Promise((resolve) => {
        setTimeout(resolve, 200);
      });
    }
  }

  function onToggleBatchPauseClick() {
    if (!batchRunning) return;
    batchPaused = !batchPaused;
    updateTestSummary(batchPaused ? t("test_repeat_paused") : t("test_running"));
    refreshBatchPauseButton();
  }

  function onStopBatchTestClick() {
    if (!batchRunning || !testStreamAbort) return;
    testStreamAbort.abort();
  }

  function stopSingleRepeat() {
    singleRepeatRunning = false;
    singleRepeatPaused = false;
    if (singleRepeatTimer) {
      clearTimeout(singleRepeatTimer);
      singleRepeatTimer = null;
    }
    if (singleRepeatTaskId) {
      finishRunningTask(singleRepeatTaskId);
      singleRepeatTaskId = "";
    }
    refreshSingleRepeatButtonLabel();
  }

  function setSingleRepeatControlsVisible(visible, payload = null) {
    const controls = document.getElementById("singleTestRepeatControls");
    if (controls) {
      controls.classList.toggle("is-visible", Boolean(visible));
    }
    setSingleTestParamControlsVisible(Boolean(visible), payload || null);
    if (visible) {
      singleRepeatPayload = payload ? JSON.parse(JSON.stringify(payload)) : null;
    } else {
      singleRepeatPayload = null;
      singleRepeatCount = 0;
      stopSingleRepeat();
    }
    refreshSingleRepeatButtonLabel();
  }

  function waitSingleRepeatInterval(ms) {
    return new Promise((resolve) => {
      let remaining = Math.max(0, Number(ms || 0));
      const step = 200;
      const tick = () => {
        if (!singleRepeatRunning) {
          singleRepeatTimer = null;
          resolve();
          return;
        }
        if (singleRepeatPaused) {
          singleRepeatTimer = setTimeout(tick, step);
          return;
        }
        if (remaining <= 0) {
          singleRepeatTimer = null;
          resolve();
          return;
        }
        const slice = Math.min(step, remaining);
        remaining -= slice;
        singleRepeatTimer = setTimeout(tick, slice);
      };
      tick();
    });
  }

  async function waitIfSingleRepeatPaused() {
    while (singleRepeatRunning && singleRepeatPaused) {
      await new Promise((resolve) => {
        singleRepeatTimer = setTimeout(resolve, 200);
      });
    }
    singleRepeatTimer = null;
  }

  function onToggleSingleRepeatPauseClick() {
    if (!singleRepeatRunning) return;
    singleRepeatPaused = !singleRepeatPaused;
    if (singleRepeatPaused) {
      updateTestSummary(t("test_repeat_paused"));
    } else {
      updateTestSummary(t("test_running"));
    }
    refreshSingleRepeatPauseButton();
  }

  function openTestModal(titleKey = "test_all_title", options = {}) {
    const modal = document.getElementById("testModal");
    const log = document.getElementById("testLog");
    const summary = document.getElementById("testSummary");
    const progress = document.getElementById("testProgressFill");
    const title = document.getElementById("testModalTitle");
    const taskId = textValue(options.taskId).trim();
    setActiveTestTaskId(taskId);
    if (log) log.innerHTML = "";
    if (summary) summary.textContent = t("test_waiting");
    if (progress) progress.style.width = "0%";
    if (title) title.textContent = t(titleKey);
    updateTestStats(taskId ? getRunningTask(taskId) : null);
    setSingleRepeatControlsVisible(Boolean(options.singleMode), options.payload || null);
    setBatchControlsVisible(Boolean(options.batchMode));
    if (modal) {
      modal.classList.remove("is-visual");
      modal.classList.add("open");
    }
  }

  function closeTestModal() {
    const modal = document.getElementById("testModal");
    if (modal) {
      modal.classList.remove("is-visual");
      modal.classList.remove("open");
    }
  }

  function refreshTestModalVisualMode() {
    const modal = document.getElementById("testModal");
    const log = document.getElementById("testLog");
    if (!modal || !log) return;
    const hasVisualMedia =
      Boolean(log.querySelector("img.test-saved-media")) ||
      Boolean(log.querySelector("video.test-saved-media"));
    modal.classList.toggle("is-visual", hasVisualMedia);
  }

  function onViewTaskClick(taskId) {
    const task = getRunningTask(taskId);
    if (!task) return;
    const modal = document.getElementById("testModal");
    const title = document.getElementById("testModalTitle");
    setActiveTestTaskId(task.id);
    if (title) {
      title.textContent = t(
        task.kind === "batch"
          ? "test_all_title"
          : "test_single_title"
      );
    }
    updateTestStats(task);
    setSingleRepeatControlsVisible(task.kind === "single_repeat");
    setBatchControlsVisible(task.kind === "batch");
    if (modal) modal.classList.add("open");
    refreshTestModalVisualMode();
  }

  function onStopTaskClick(taskId) {
    const task = getRunningTask(taskId);
    if (!task || !task.running) return;
    if (task.kind === "batch") {
      onStopBatchTestClick();
      return;
    }
    if (task.kind === "single_repeat") {
      stopSingleRepeat();
    }
  }

  function updateTestProgress(completed, total) {
    const safeTotal = Math.max(0, Number(total || 0));
    const safeCompleted = Math.max(0, Number(completed || 0));
    const percent = safeTotal > 0 ? Math.min(100, Math.round((safeCompleted / safeTotal) * 100)) : 0;
    const progress = document.getElementById("testProgressFill");
    if (progress) progress.style.width = `${percent}%`;
  }

  function renderSavedDataBlock(item) {
    const type = textValue(item.saved_type).trim().toLowerCase();
    if (type === "text" && item.saved_text) {
      return `
          <div class="test-saved-wrap">
            <pre class="test-saved-text">${escapeHtml(textValue(item.saved_text))}</pre>
          </div>
        `;
    }
    if (!item.saved_file_url) {
      return "";
    }
    const fileUrl = escapeHtml(textValue(item.saved_file_url));
    if (type === "image") {
      return `
          <div class="test-saved-wrap is-media">
            <a href="${fileUrl}" target="_blank" rel="noopener noreferrer">
              <img class="test-saved-media test-saved-image" src="${fileUrl}" alt="saved image">
            </a>
          </div>
        `;
    }
    if (type === "video") {
      return `
          <div class="test-saved-wrap is-media">
            <video class="test-saved-media" src="${fileUrl}" controls preload="metadata"></video>
          </div>
        `;
    }
    if (type === "audio") {
      return `
          <div class="test-saved-wrap is-media">
            <audio class="test-saved-audio" src="${fileUrl}" controls preload="metadata"></audio>
          </div>
        `;
    }
    return "";
  }

  function renderPreviewTextBlock(item) {
    if (!Boolean(item?.valid)) {
      return "";
    }
    const savedType = textValue(item?.saved_type).trim().toLowerCase();
    const savedText = textValue(item?.saved_text).trim();
    if (savedType === "text" && savedText) {
      return "";
    }
    const contentType = textValue(item?.content_type).trim().toLowerCase();
    const isTextLike =
      savedType === "text" ||
      contentType.startsWith("text/") ||
      contentType.includes("application/json");
    if (!isTextLike) {
      return "";
    }
    const preview = textValue(item?.preview).trim();
    if (!preview) {
      return "";
    }
    return `
          <div class="test-saved-wrap">
            <pre class="test-saved-text">${escapeHtml(preview)}</pre>
          </div>
        `;
  }

  function appendTestLog(item, options = {}) {
    const log = document.getElementById("testLog");
    if (!log) return;
    const includePreview = options.includePreview !== false;
    const valid = Boolean(item.valid);
    const repeatRound = Number(item.repeat_round || 0);
    const roundText = repeatRound > 0 ? t("test_repeat_round", { count: repeatRound }) : "";
    const status = item.status ? `HTTP ${item.status}` : "-";
    const line = document.createElement("div");
    line.className = `test-log-item ${valid ? "is-valid" : "is-invalid"}`;
    const detailParts = [
      item.reason ? `${t("reason_label")}: ${item.reason}` : "",
      item.final_url ? `${t("final_url_label")}: ${item.final_url}` : "",
      item.content_type ? `${t("content_type_label")}: ${item.content_type}` : "",
      Boolean(item.is_duplicate) ? "Duplicate data: save skipped" : "",
      item.saved_path ? `${t("saved_path_label")}: ${item.saved_path}` : ""
    ].filter(Boolean);
    line.innerHTML = `
        <div class="test-log-main">
          ${roundText ? `<span class="hint">${escapeHtml(roundText)}</span>` : ""}
          <span class="status-dot ${valid ? "is-valid" : ""}">${valid ? t("valid") : t("invalid")}</span>
          <strong>${escapeHtml(textValue(item.name))}</strong>
          <span class="hint">${escapeHtml(status)}</span>
        </div>
        <div class="test-log-sub">${escapeHtml(detailParts.join(" | "))}</div>
        ${includePreview ? renderPreviewTextBlock(item) : ""}
        ${includePreview ? renderSavedDataBlock(item) : ""}
      `;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
    refreshTestModalVisualMode();
  }

  function updateTestSummary(text) {
    const summary = document.getElementById("testSummary");
    if (summary) {
      summary.textContent = text;
    }
  }

  function applyApiValidity(name, valid) {
    const targetName = textValue(name).trim();
    const apis = Array.isArray(getApis()) ? getApis() : [];
    if (!targetName || !apis.length) return false;
    let changed = false;
    const next = apis.map((api) => {
      if (textValue(api?.name) !== targetName) {
        return api;
      }
      const nextValid = Boolean(valid);
      if (Boolean(api?.valid) === nextValid) {
        return api;
      }
      changed = true;
      return { ...api, valid: nextValid };
    });
    if (changed) setApis(next);
    return changed;
  }

  function applyApiValidityBatch(names, valid) {
    const nameSet = new Set(normalizeList(names));
    const apis = Array.isArray(getApis()) ? getApis() : [];
    if (!nameSet.size || !apis.length) return false;
    let changed = false;
    const nextValid = Boolean(valid);
    const next = apis.map((api) => {
      if (!nameSet.has(textValue(api?.name))) return api;
      if (Boolean(api?.valid) === nextValid) return api;
      changed = true;
      return { ...api, valid: nextValid };
    });
    if (changed) setApis(next);
    return changed;
  }

  async function runSinglePreviewOnce(payload, options = {}) {
    const previewPayload = buildSingleTestPayload(payload);
    const batch = await req("/api/test/preview/batch", {
      method: "POST",
      body: JSON.stringify({ items: [previewPayload] }),
    });
    const detail =
      Array.isArray(batch?.items) && batch.items.length ? batch.items[0] : {};
    if (!options.skipLog) {
      appendTestLog({
        repeat_round: Number(options.repeatRound || 0),
        name: detail.name || previewPayload.name,
        url: detail.url || previewPayload.url,
        valid: Boolean(detail.valid),
        is_duplicate: Boolean(detail.is_duplicate),
        status: detail.status || null,
        content_type: detail.content_type || "",
        final_url: detail.final_url || "",
        reason: detail.reason || "",
        preview: detail.preview || "",
        saved_type: detail.saved_type || "",
        saved_text: detail.saved_text || "",
        saved_path: detail.saved_path || "",
        saved_file_url: detail.saved_file_url || "",
      }, { includePreview: options.includePreview !== false });
    }
    return detail;
  }

  async function testEditorPayloadAndRender(payload, options = {}) {
    const deferModalUntilDone = Boolean(options.deferModalUntilDone);
    stopSingleRepeat();
    const singleTask = createRunningTask("single_once", t("test_single_title"), {
      completed: 0,
      total: 1,
      success: 0,
      fail: 0,
      summary: t("test_running"),
    });
    if (!deferModalUntilDone) {
      openTestModal("test_single_title", {
        singleMode: true,
        payload,
        taskId: singleTask.id,
      });
      updateTestSummary(t("test_running"));
      updateTestProgress(0, 1);
    }
    try {
      const detail = await runSinglePreviewOnce(payload, {
        skipLog: deferModalUntilDone,
      });
      patchRunningTask(singleTask.id, {
        completed: 1,
        success: Boolean(detail.valid) ? 1 : 0,
        fail: Boolean(detail.valid) ? 0 : 1,
      });
      if (deferModalUntilDone) {
        openTestModal("test_single_title", {
          singleMode: true,
          payload,
          taskId: singleTask.id,
        });
        appendTestLog({
          repeat_round: 0,
          name: detail.name || payload.name,
          url: detail.url || payload.url,
          valid: Boolean(detail.valid),
          is_duplicate: Boolean(detail.is_duplicate),
          status: detail.status || null,
          content_type: detail.content_type || "",
          final_url: detail.final_url || "",
          reason: detail.reason || "",
          preview: detail.preview || "",
          saved_type: detail.saved_type || "",
          saved_text: detail.saved_text || "",
          saved_path: detail.saved_path || "",
          saved_file_url: detail.saved_file_url || "",
        });
      }
      updateTestProgress(1, 1);
      updateTestSummary(
        t("test_done_summary", {
          success: Boolean(detail.valid) ? 1 : 0,
          fail: Boolean(detail.valid) ? 0 : 1,
        })
      );
      finishRunningTask(singleTask.id);
    } catch (err) {
      finishRunningTask(singleTask.id, {
        summary: String(err?.message || err),
      });
      if (deferModalUntilDone) {
        openTestModal("test_single_title", {
          singleMode: true,
          payload,
          taskId: singleTask.id,
        });
      }
      updateTestSummary(`${t("test_failed")}: ${err.message || String(err)}`);
      throw err;
    }
  }

  async function onToggleSingleRepeatClick() {
    if (singleRepeatRunning) {
      stopSingleRepeat();
      updateTestSummary(t("test_aborted"));
      return;
    }
    if (!singleRepeatPayload) {
      return;
    }
    let intervalSeconds = 0;
    let repeatTimes = 0;
    try {
      intervalSeconds = getSingleRepeatIntervalSeconds();
      repeatTimes = getSingleRepeatTimes();
    } catch (err) {
      showNoticeModal(err.message || String(err));
      return;
    }

    const repeatTask = createRunningTask("single_repeat", t("test_single_title"), {
      completed: 0,
      total: repeatTimes,
      success: 0,
      fail: 0,
      summary: t("test_running"),
    });
    singleRepeatTaskId = repeatTask.id;
    setActiveTestTaskId(repeatTask.id);
    updateTestStats(repeatTask);
    singleRepeatRunning = true;
    singleRepeatCount = 0;
    singleRepeatPaused = false;
    updateTestProgress(0, repeatTimes);
    refreshSingleRepeatButtonLabel();

    while (singleRepeatRunning && singleRepeatCount < repeatTimes) {
      try {
        await waitIfSingleRepeatPaused();
        if (!singleRepeatRunning) break;

        singleRepeatCount += 1;
        updateTestSummary(t("test_running"));
        const detail = await runSinglePreviewOnce(singleRepeatPayload, {
          repeatRound: singleRepeatCount,
        });
        const nextSuccess = Number(repeatTask.success || 0) + (Boolean(detail.valid) ? 1 : 0);
        const nextFail = Number(repeatTask.fail || 0) + (Boolean(detail.valid) ? 0 : 1);
        patchRunningTask(repeatTask.id, {
          completed: singleRepeatCount,
          success: nextSuccess,
          fail: nextFail,
          summary: t("test_running"),
        });
        updateTestProgress(singleRepeatCount, repeatTimes);
        updateTestSummary(
          t("test_done_summary", {
            success: Boolean(detail.valid) ? 1 : 0,
            fail: Boolean(detail.valid) ? 0 : 1,
          })
        );

        await loadPool();
      } catch (err) {
        updateTestSummary(`${t("test_failed")}: ${err.message || String(err)}`);
        stopSingleRepeat();
        break;
      }

      if (!singleRepeatRunning || singleRepeatCount >= repeatTimes) break;
      updateTestSummary(
        t("test_repeat_waiting", {
          count: singleRepeatCount,
          seconds: intervalSeconds,
        })
      );
      await waitSingleRepeatInterval(intervalSeconds * 1000);
    }

    finishRunningTask(repeatTask.id, {
      completed: singleRepeatCount,
      summary:
        singleRepeatCount >= repeatTimes
          ? t("test_done_summary", {
              success: repeatTask.success || 0,
              fail: repeatTask.fail || 0,
            })
          : t("test_aborted"),
    });
    updateTestProgress(singleRepeatCount, repeatTimes);
    singleRepeatRunning = false;
    singleRepeatPaused = false;
    singleRepeatTaskId = "";
    refreshSingleRepeatButtonLabel();
  }

  async function testApisStream(names = [], task = null, range = null) {
    const isSingle = Array.isArray(names) && names.length === 1;
    const normalizedRange =
      range && typeof range === "object" ? range : {};
    const rangeSiteNames = new Set(
      normalizeList(normalizedRange.site_names || normalizedRange.sites || [])
    );
    const rangeQuery = textValue(normalizedRange.query).trim().toLowerCase();
    const streamTask =
      task ||
      createRunningTask("batch", isSingle ? t("test_single_title") : t("test_all_title"), {
        completed: 0,
        total: 0,
        success: 0,
        fail: 0,
      });
    openTestModal(isSingle ? "test_single_title" : "test_all_title", {
      taskId: streamTask.id,
      batchMode: true,
    });
    updateTestSummary(t("test_running"));
    testStreamAbort = new AbortController();
    batchRunning = true;
    batchPaused = false;
    refreshBatchControls();
    patchRunningTask(streamTask.id, { summary: t("test_running") });

    const fallbackToPreviewBatch = async () => {
      const selectedNames = new Set(normalizeList(names));
      const targets = (Array.isArray(getApis()) ? getApis() : []).filter((api) => {
        const apiName = textValue(api?.name);
        if (!apiName) return false;
        if (selectedNames.size && !selectedNames.has(apiName)) return false;
        if (rangeSiteNames.size) {
          const apiSite = textValue(api?.site).trim();
          if (!apiSite || !rangeSiteNames.has(apiSite)) return false;
        }
        if (rangeQuery) {
          const hitName = textValue(api?.name).toLowerCase().includes(rangeQuery);
          const hitUrl = textValue(api?.url).toLowerCase().includes(rangeQuery);
          const hitKeywords = Array.isArray(api?.keywords)
            ? api.keywords.some((keyword) =>
                textValue(keyword).toLowerCase().includes(rangeQuery)
              )
            : false;
          if (!hitName && !hitUrl && !hitKeywords) return false;
        }
        return true;
      });
      const total = targets.length;
      let completed = 0;
      let success = 0;
      let fail = 0;

      updateTestProgress(0, total);
      updateTestSummary(t("test_started", { total }));
      patchRunningTask(streamTask.id, {
        completed: 0,
        total,
        success: 0,
        fail: 0,
        summary: t("test_started", { total }),
      });

      for (const payload of targets) {
        await waitIfBatchPaused();
        if (!testStreamAbort || testStreamAbort.signal.aborted) {
          throw new DOMException("aborted", "AbortError");
        }
        const detail = await runSinglePreviewOnce(payload, { includePreview: false });
        completed += 1;
        if (Boolean(detail.valid)) {
          success += 1;
        } else {
          fail += 1;
        }
        applyApiValidity(detail.name || payload.name, Boolean(detail.valid));
        renderApis();
        updateTestProgress(completed, total);
        const summary = t("test_progress_summary", { completed, total });
        updateTestSummary(summary);
        patchRunningTask(streamTask.id, {
          completed,
          total,
          success,
          fail,
          summary,
        });
      }

      const doneSummary = t("test_done_summary", { success, fail });
      updateTestSummary(doneSummary);
      showBatchDoneHint(doneSummary);
      finishRunningTask(streamTask.id, {
        completed,
        total,
        success,
        fail,
        summary: doneSummary,
      });
    };

    try {
      const params = new URLSearchParams();
      if (Array.isArray(names)) {
        names.forEach((name) => {
          if (name) params.append("name", String(name));
        });
      }
      if (rangeSiteNames.size) {
        Array.from(rangeSiteNames).forEach((name) => {
          params.append("site", name);
        });
      }
      if (rangeQuery) {
        params.set("query", rangeQuery);
      }
      const streamUrl = params.size
        ? `/api/test/stream?${params.toString()}`
        : "/api/test/stream";
      const resp = await fetch(streamUrl, {
        method: "GET",
        cache: "no-store",
        signal: testStreamAbort.signal,
      });
      if (!resp.ok || !resp.body) {
        throw new Error(t("request_failed"));
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        await waitIfBatchPaused();
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        lines.forEach((line) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          let item = null;
          try {
            item = JSON.parse(trimmed);
          } catch {
            return;
          }
          if (item.event === "start") {
            updateTestProgress(item.completed || 0, item.total || 0);
            updateTestSummary(t("test_started", { total: item.total || 0 }));
            patchRunningTask(streamTask.id, {
              completed: item.completed || 0,
              total: item.total || 0,
              summary: t("test_started", { total: item.total || 0 }),
            });
            return;
          }
          if (item.event === "progress") {
            updateTestProgress(item.completed || 0, item.total || 0);
            appendTestLog(item, { includePreview: false });
            if (applyApiValidity(item.name, item.valid)) {
              renderApis();
            }
            updateTestSummary(
              t("test_progress_summary", {
                completed: item.completed || 0,
                total: item.total || 0,
              })
            );
            patchRunningTask(streamTask.id, {
              completed: item.completed || 0,
              total: item.total || 0,
              success: Math.max(0, Number(item.completed || 0) - Number(item.fail_count || 0)),
              fail: Number(item.fail_count || 0),
              summary: t("test_progress_summary", {
                completed: item.completed || 0,
                total: item.total || 0,
              }),
            });
            return;
          }
          if (item.event === "done") {
            const changedValid = applyApiValidityBatch(item.valid, true);
            const changedInvalid = applyApiValidityBatch(item.invalid, false);
            if (changedValid || changedInvalid) {
              renderApis();
            }
            updateTestProgress(item.completed || item.total || 0, item.total || 0);
            updateTestSummary(
              t("test_done_summary", {
                success: item.success_count || 0,
                fail: item.fail_count || 0,
              })
            );
            showBatchDoneHint(
              t("test_done_summary", {
                success: item.success_count || 0,
                fail: item.fail_count || 0,
              })
            );
            finishRunningTask(streamTask.id, {
              completed: item.completed || item.total || 0,
              total: item.total || 0,
              success: item.success_count || 0,
              fail: item.fail_count || 0,
              summary: t("test_done_summary", {
                success: item.success_count || 0,
                fail: item.fail_count || 0,
              }),
            });
            return;
          }
          if (item.event === "error") {
            throw new Error(item.message || t("request_failed"));
          }
        });
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        updateTestSummary(t("test_aborted"));
        finishRunningTask(streamTask.id, { summary: t("test_aborted") });
        return;
      }
      try {
        await fallbackToPreviewBatch();
      } catch (fallbackErr) {
        if (fallbackErr?.name === "AbortError") {
          updateTestSummary(t("test_aborted"));
          finishRunningTask(streamTask.id, { summary: t("test_aborted") });
          return;
        }
        updateTestSummary(`${t("test_failed")}: ${fallbackErr.message || String(fallbackErr)}`);
        finishRunningTask(streamTask.id, {
          summary: `${t("test_failed")}: ${fallbackErr.message || String(fallbackErr)}`,
        });
        throw fallbackErr;
      }
    } finally {
      setBatchControlsVisible(false);
      testStreamAbort = null;
    }

    await loadPool();
  }

  return {
    getSingleRepeatIntervalSeconds,
    getSingleRepeatTimes,
    refreshSingleRepeatButtonLabel,
    refreshSingleRepeatPauseButton,
    stopSingleRepeat,
    setSingleRepeatControlsVisible,
    waitSingleRepeatInterval,
    waitIfSingleRepeatPaused,
    onToggleSingleRepeatPauseClick,
    runSinglePreviewOnce,
    testEditorPayloadAndRender,
    openTestModal,
    closeTestModal,
    onViewTaskClick,
    onStopTaskClick,
    onToggleSingleRepeatClick,
    onToggleBatchPauseClick,
    onStopBatchTestClick,
    updateTestProgress,
    appendTestLog,
    renderSavedDataBlock,
    updateTestSummary,
    applyApiValidity,
    applyApiValidityBatch,
    onToggleSingleTestParamSheetClick,
    testApisStream,
  };
}
