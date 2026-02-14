function createUpdateManager(deps) {
  const { t, req, withButtonLoading, textValue } = deps;
  let updatePollTimer = null;
  let updateKnownRestarting = false;
  let updateCheckSnapshot = null;

  function updateButtonState(btn = document.getElementById("updateIconBtn")) {
    if (!btn) return;
    const isUpdating = btn.dataset.updating === "1";
    const label = t(isUpdating ? "update_checking" : "check_update");
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }

  function setUpdateButtonBusy(btn, busy) {
    if (!btn) return;
    btn.dataset.updating = busy ? "1" : "0";
    updateButtonState(btn);
  }

  function stopUpdatePolling() {
    if (!updatePollTimer) return;
    clearInterval(updatePollTimer);
    updatePollTimer = null;
  }

  function setUpdateModalStatus(text, tone = "") {
    const statusNode = document.getElementById("updateModalStatus");
    if (!statusNode) return;
    statusNode.textContent = text;
    statusNode.classList.toggle("is-error", tone === "error");
    statusNode.classList.toggle("is-success", tone === "success");
  }

  function setUpdateProgress(value, state = "running") {
    const bar = document.getElementById("updateProgressFill");
    if (!bar) return;
    const pct = Math.max(0, Math.min(100, Number(value) || 0));
    bar.style.width = `${pct}%`;
    bar.classList.remove("is-running", "is-success", "is-error");
    if (state === "success") {
      bar.classList.add("is-success");
    } else if (state === "error") {
      bar.classList.add("is-error");
    } else {
      bar.classList.add("is-running");
    }
  }

  function setUpdateModalLogs(lines) {
    const node = document.getElementById("updateLog");
    if (!node) return;
    const list = Array.isArray(lines) ? lines : [];
    node.textContent = list.join("\n");
    node.scrollTop = node.scrollHeight;
  }

  function setUpdateModalDetail(text) {
    const node = document.getElementById("updateModalDetail");
    if (!node) return;
    node.textContent = text || "";
  }

  function setUpdateModalActionState(mode) {
    const confirmBtn = document.getElementById("btnUpdateConfirm");
    const cancelBtn = document.getElementById("btnUpdateCancel");
    const closeBtn = document.getElementById("btnUpdateClose");
    if (!confirmBtn || !cancelBtn || !closeBtn) return;
    const isConfirm = mode === "confirm";
    const isRunning = mode === "running";
    const isDone = mode === "done";
    confirmBtn.style.display = isConfirm ? "inline-flex" : "none";
    confirmBtn.disabled = !isConfirm;
    cancelBtn.style.display = isConfirm ? "inline-flex" : "none";
    cancelBtn.disabled = isRunning;
    closeBtn.style.display = isDone ? "inline-flex" : "none";
    closeBtn.disabled = !isDone;
  }

  function openUpdateModal(mode = "confirm") {
    const modal = document.getElementById("updateModal");
    if (!modal) return;
    modal.dataset.running = mode === "running" ? "1" : "0";
    modal.classList.add("open");
    setUpdateModalActionState(
      mode === "running" ? "running" : mode === "confirm" ? "confirm" : "done"
    );
  }

  function closeModal(force = false) {
    const modal = document.getElementById("updateModal");
    if (!modal) return;
    if (!force && modal.dataset.running === "1") return;
    modal.classList.remove("open");
    modal.dataset.running = "0";
    stopUpdatePolling();
    updateKnownRestarting = false;
    setUpdateProgress(0, "running");
    setUpdateModalLogs([]);
    setUpdateModalDetail("");
  }

  function renderUpdateCheckDetail(check) {
    if (!check || typeof check !== "object") return "";
    if (!check.available) {
      return t("update_unavailable", { message: check.reason || "unknown reason" });
    }
    const branch = textValue(check.branch) || "HEAD";
    const current =
      textValue(check.current_short) || textValue(check.current).slice(0, 7) || "?";
    const remote =
      textValue(check.remote_short) || textValue(check.remote).slice(0, 7) || "?";
    const behind = Number(check.behind || 0);
    return t("update_confirm_detail", { branch, current, remote, behind });
  }

  function waitForRestartAndReload() {
    let attempts = 0;
    const maxAttempts = 90;
    const tryReconnect = async () => {
      attempts += 1;
      try {
        const resp = await fetch(`/api/system/update/status?_=${Date.now()}`, {
          cache: "no-store",
        });
        if (resp.ok) {
          window.location.reload();
          return;
        }
      } catch {}
      if (attempts >= maxAttempts) {
        window.location.reload();
        return;
      }
      setTimeout(tryReconnect, 1000);
    };
    setTimeout(tryReconnect, 1200);
  }

  function applyUpdateStatusSnapshot(snapshot) {
    const modal = document.getElementById("updateModal");
    const status = textValue(snapshot?.status).toLowerCase();
    const message = textValue(snapshot?.message);
    const progress = Number(snapshot?.progress || 0);
    const logs = Array.isArray(snapshot?.logs) ? snapshot.logs : [];
    setUpdateModalLogs(logs);
    if (status === "error") {
      if (modal) modal.dataset.running = "0";
      setUpdateModalStatus(
        t("update_modal_status_failed", { message: message || t("request_failed") }),
        "error"
      );
      setUpdateProgress(progress || 10, "error");
      setUpdateModalActionState("done");
      return;
    }
    if (status === "up_to_date") {
      if (modal) modal.dataset.running = "0";
      setUpdateModalStatus(t("update_no_update"), "success");
      setUpdateProgress(100, "success");
      setUpdateModalActionState("done");
      return;
    }
    if (status === "success") {
      if (modal) modal.dataset.running = "0";
      setUpdateModalStatus(t("update_modal_status_success"), "success");
      setUpdateProgress(100, "success");
      setUpdateModalActionState("done");
      return;
    }
    if (status === "restarting") {
      if (modal) modal.dataset.running = "1";
      setUpdateModalStatus(t("update_modal_status_reconnecting"));
      setUpdateProgress(100, "success");
      setUpdateModalActionState("running");
      updateKnownRestarting = true;
      stopUpdatePolling();
      waitForRestartAndReload();
      return;
    }
    setUpdateModalStatus(t("update_modal_status_running"));
    if (modal) modal.dataset.running = "1";
    setUpdateProgress(progress || 5, "running");
    setUpdateModalActionState("running");
  }

  async function pollUpdateStatus() {
    try {
      const snapshot = await req("/api/system/update/status");
      applyUpdateStatusSnapshot(snapshot);
    } catch (err) {
      if (updateKnownRestarting) {
        stopUpdatePolling();
        waitForRestartAndReload();
        return;
      }
      setUpdateModalStatus(
        t("update_modal_status_failed", { message: err?.message || String(err) }),
        "error"
      );
      setUpdateProgress(8, "error");
      setUpdateModalActionState("done");
      stopUpdatePolling();
    }
  }

  function startUpdatePolling() {
    stopUpdatePolling();
    updatePollTimer = setInterval(pollUpdateStatus, 1200);
    pollUpdateStatus();
  }

  async function onUpdateAppClick(btn) {
    const updateBtn = btn || document.getElementById("updateIconBtn");
    await withButtonLoading(updateBtn, async () => {
      setUpdateButtonBusy(updateBtn, true);
      try {
        const snapshot = await req("/api/system/update/check", { method: "POST" });
        const check = snapshot?.check || {};
        updateCheckSnapshot = check;
        if (snapshot?.status === "running" || snapshot?.status === "restarting") {
          openUpdateModal("running");
          setUpdateModalStatus(t("update_modal_status_running"));
          setUpdateModalDetail(renderUpdateCheckDetail(check));
          setUpdateProgress(snapshot?.progress || 5, "running");
          setUpdateModalLogs(Array.isArray(snapshot?.logs) ? snapshot.logs : []);
          startUpdatePolling();
          return;
        }
        if (!check.available) {
          openUpdateModal("done");
          setUpdateModalStatus(
            t("update_unavailable", { message: check.reason || t("request_failed") }),
            "error"
          );
          setUpdateModalDetail(renderUpdateCheckDetail(check));
          setUpdateProgress(10, "error");
          setUpdateModalLogs([]);
          return;
        }
        if (!check.has_update) {
          openUpdateModal("done");
          setUpdateModalStatus(t("update_no_update"), "success");
          setUpdateModalDetail(renderUpdateCheckDetail(check));
          setUpdateProgress(100, "success");
          setUpdateModalLogs([]);
          return;
        }
        openUpdateModal("confirm");
        setUpdateModalStatus(t("update_modal_status_confirm"));
        setUpdateModalDetail(renderUpdateCheckDetail(check));
        setUpdateProgress(0, "running");
        setUpdateModalLogs([]);
      } finally {
        setUpdateButtonBusy(updateBtn, false);
      }
    });
  }

  async function onUpdateConfirmClick(btn) {
    await withButtonLoading(btn, async () => {
      const modal = document.getElementById("updateModal");
      if (modal) {
        modal.dataset.running = "1";
      }
      updateKnownRestarting = false;
      setUpdateModalActionState("running");
      setUpdateModalStatus(t("update_modal_status_running"));
      setUpdateModalDetail(renderUpdateCheckDetail(updateCheckSnapshot));
      setUpdateProgress(3, "running");
      setUpdateModalLogs([]);
      try {
        await req("/api/system/update/start", { method: "POST" });
      } catch (err) {
        const msg = err?.message || String(err);
        if (msg.toLowerCase().includes("already in progress")) {
          openUpdateModal("running");
          setUpdateModalStatus(t("update_busy"));
          setUpdateModalDetail(renderUpdateCheckDetail(updateCheckSnapshot));
          startUpdatePolling();
          return;
        }
        throw err;
      }
      startUpdatePolling();
    });
  }

  return {
    updateButtonState,
    closeModal,
    onUpdateAppClick,
    onUpdateConfirmClick,
  };
}
