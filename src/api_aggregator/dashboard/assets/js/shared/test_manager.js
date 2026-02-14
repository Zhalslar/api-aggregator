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
  } = deps;

  let testStreamAbort = null;
  let singleRepeatRunning = false;
  let singleRepeatTimer = null;
  let singleRepeatPayload = null;
  let singleRepeatCount = 0;
  let singleRepeatPaused = false;
  let singleRepeatSkipDuplicatePrompt = false;
  let duplicateChoiceResolver = null;
  let singleRepeatTaskId = "";

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
    const raw = Number.parseInt(textValue(input?.value || "5"), 10);
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
    btn.textContent = singleRepeatRunning ? t("test_repeat_stop") : t("test_repeat_start");
    refreshSingleRepeatPauseButton();
  }

  function closeDuplicateChoiceModal(defaultChoice = "skip_once") {
    const modal = document.getElementById("duplicateChoiceModal");
    if (modal) {
      modal.classList.remove("open");
    }
    if (duplicateChoiceResolver) {
      const resolve = duplicateChoiceResolver;
      duplicateChoiceResolver = null;
      if (defaultChoice === "skip_all") {
        resolve("skip_all");
        return;
      }
      if (defaultChoice === "cancel_test") {
        resolve("cancel_test");
        return;
      }
      resolve("skip_once");
    }
  }

  function onDuplicateChoiceClick(choice) {
    if (choice === "skip_all") {
      closeDuplicateChoiceModal("skip_all");
      return;
    }
    if (choice === "cancel_test") {
      closeDuplicateChoiceModal("cancel_test");
      return;
    }
    closeDuplicateChoiceModal("skip_once");
  }

  async function askDuplicateHandling(name) {
    const modal = document.getElementById("duplicateChoiceModal");
    const messageNode = document.getElementById("duplicateChoiceMessage");
    if (!modal || !messageNode) {
      return "skip_once";
    }
    messageNode.textContent = t("test_repeat_duplicate_prompt", {
      name: textValue(name) || "-",
    });
    modal.classList.add("open");
    return await new Promise((resolve) => {
      duplicateChoiceResolver = resolve;
    });
  }

  function stopSingleRepeat() {
    singleRepeatRunning = false;
    singleRepeatPaused = false;
    singleRepeatSkipDuplicatePrompt = false;
    closeDuplicateChoiceModal("skip_once");
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
    if (!controls) return;
    controls.classList.toggle("is-visible", Boolean(visible));
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
    if (modal) modal.classList.add("open");
  }

  function closeTestModal() {
    closeDuplicateChoiceModal("skip_once");
    const modal = document.getElementById("testModal");
    if (modal) {
      modal.classList.remove("open");
    }
  }

  function onStopTaskClick(taskId) {
    const task = getRunningTask(taskId);
    if (!task || !task.running) return;
    if (task.kind === "batch") {
      if (testStreamAbort) {
        testStreamAbort.abort();
      }
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
          <div class="test-saved-wrap">
            <img class="test-saved-media test-saved-image" src="${fileUrl}" alt="saved image">
          </div>
        `;
    }
    if (type === "video") {
      return `
          <div class="test-saved-wrap">
            <video class="test-saved-media" src="${fileUrl}" controls preload="metadata"></video>
          </div>
        `;
    }
    if (type === "audio") {
      return `
          <div class="test-saved-wrap">
            <audio class="test-saved-audio" src="${fileUrl}" controls preload="metadata"></audio>
          </div>
        `;
    }
    return "";
  }

  function appendTestLog(item) {
    const log = document.getElementById("testLog");
    if (!log) return;
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
      item.preview ? `${t("response_preview_label")}: ${item.preview}` : "",
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
        ${renderSavedDataBlock(item)}
      `;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
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
    const detail = await req("/api/test/preview", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    appendTestLog({
      repeat_round: Number(options.repeatRound || 0),
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
    return detail;
  }

  async function testEditorPayloadAndRender(payload) {
    stopSingleRepeat();
    const singleTask = createRunningTask("single_once", t("test_single_title"), {
      completed: 0,
      total: 1,
      success: 0,
      fail: 0,
    });
    openTestModal("test_single_title", {
      singleMode: true,
      payload,
      taskId: singleTask.id,
    });
    updateTestSummary(t("test_running"));
    updateTestProgress(0, 1);
    try {
      const detail = await runSinglePreviewOnce(payload);
      patchRunningTask(singleTask.id, {
        completed: 1,
        success: Boolean(detail.valid) ? 1 : 0,
        fail: Boolean(detail.valid) ? 0 : 1,
      });
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
    singleRepeatSkipDuplicatePrompt = false;
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

        if (Boolean(detail.is_duplicate) && !singleRepeatSkipDuplicatePrompt) {
          const choice = await askDuplicateHandling(detail.name || singleRepeatPayload?.name || "");
          if (choice === "skip_all") {
            singleRepeatSkipDuplicatePrompt = true;
          } else if (choice === "cancel_test") {
            stopSingleRepeat();
            updateTestSummary(t("test_aborted"));
            break;
          }
        }
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

  async function testApisStream(names = [], task = null) {
    const isSingle = Array.isArray(names) && names.length === 1;
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
    });
    updateTestSummary(t("test_running"));
    testStreamAbort = new AbortController();
    patchRunningTask(streamTask.id, { summary: t("test_running") });
    try {
      const params = new URLSearchParams();
      if (Array.isArray(names)) {
        names.forEach((name) => {
          if (name) params.append("name", String(name));
        });
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
            appendTestLog(item);
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
          }
        });
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        updateTestSummary(t("test_aborted"));
        finishRunningTask(streamTask.id, { summary: t("test_aborted") });
        return;
      }
      updateTestSummary(`${t("test_failed")}: ${err.message || String(err)}`);
      finishRunningTask(streamTask.id, {
        summary: `${t("test_failed")}: ${err.message || String(err)}`,
      });
      throw err;
    } finally {
      testStreamAbort = null;
    }

    await loadPool();
  }

  async function onTestAllClick(btn) {
    await withButtonLoading(btn, async () => {
      await testApisStream([], createRunningTask("batch", t("test_all_title")));
    });
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
    closeDuplicateChoiceModal,
    onDuplicateChoiceClick,
    askDuplicateHandling,
    runSinglePreviewOnce,
    testEditorPayloadAndRender,
    openTestModal,
    closeTestModal,
    onStopTaskClick,
    onToggleSingleRepeatClick,
    updateTestProgress,
    appendTestLog,
    renderSavedDataBlock,
    updateTestSummary,
    applyApiValidity,
    applyApiValidityBatch,
    testApisStream,
    onTestAllClick,
  };
}
