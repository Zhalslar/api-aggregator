function createRestartManager(deps) {
  const { t, req, withButtonLoading, loadPool, minAnimationMs } = deps;

  let restartAutoCloseTimer = null;
  let restartProgressTimer = null;
  let restartProgressValue = 0;

  function updateButtonState(btn = document.getElementById("restartIconBtn")) {
    if (!btn) return;
    const isRestarting = btn.dataset.restarting === "1";
    const label = t(
      isRestarting ? "restart_service_restarting" : "restart_service"
    );
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }

  function setRestartButtonBusy(btn, busy) {
    if (!btn) return;
    btn.dataset.restarting = busy ? "1" : "0";
    updateButtonState(btn);
  }

  function setRestartModalStatus(text, tone = "") {
    const statusNode = document.getElementById("restartModalStatus");
    if (!statusNode) return;
    statusNode.textContent = text;
    statusNode.classList.toggle("is-error", tone === "error");
    statusNode.classList.toggle("is-success", tone === "success");
  }

  function setRestartProgressValue(value) {
    const bar = document.getElementById("restartProgressFill");
    if (!bar) return;
    restartProgressValue = Math.max(0, Math.min(100, Number(value) || 0));
    bar.style.width = `${restartProgressValue}%`;
  }

  function stopRestartProgressSimulation() {
    if (!restartProgressTimer) return;
    clearInterval(restartProgressTimer);
    restartProgressTimer = null;
  }

  function startRestartProgressSimulation() {
    stopRestartProgressSimulation();
    setRestartProgressValue(0);
    restartProgressTimer = setInterval(() => {
      const target = 92;
      const remaining = target - restartProgressValue;
      if (remaining <= 0.2) {
        stopRestartProgressSimulation();
        return;
      }
      const step = Math.max(0.35, remaining * 0.12);
      setRestartProgressValue(restartProgressValue + step);
    }, 120);
  }

  function setRestartProgressState(state) {
    const bar = document.getElementById("restartProgressFill");
    if (!bar) return;
    bar.classList.remove("is-running", "is-success", "is-error");
    if (state === "running") {
      startRestartProgressSimulation();
      bar.classList.add("is-running");
    } else if (state === "success") {
      stopRestartProgressSimulation();
      setRestartProgressValue(100);
      bar.classList.add("is-success");
    } else if (state === "error") {
      stopRestartProgressSimulation();
      if (restartProgressValue < 8) {
        setRestartProgressValue(8);
      }
      bar.classList.add("is-error");
    }
  }

  function openModal() {
    const modal = document.getElementById("restartModal");
    const closeBtn = document.getElementById("btnRestartClose");
    if (restartAutoCloseTimer) {
      clearTimeout(restartAutoCloseTimer);
      restartAutoCloseTimer = null;
    }
    if (closeBtn) {
      closeBtn.style.display = "none";
      closeBtn.disabled = true;
    }
    setRestartModalStatus(t("restart_modal_status_running"));
    setRestartProgressState("running");
    if (modal) {
      modal.dataset.running = "1";
      modal.classList.add("open");
    }
  }

  function closeModal(force = false) {
    const modal = document.getElementById("restartModal");
    if (!force && modal?.dataset.running === "1") {
      return;
    }
    stopRestartProgressSimulation();
    if (restartAutoCloseTimer) {
      clearTimeout(restartAutoCloseTimer);
      restartAutoCloseTimer = null;
    }
    if (modal) {
      modal.dataset.running = "0";
      modal.classList.remove("open");
    }
    setRestartProgressValue(0);
  }

  async function waitForRestartAndReload() {
    // Speed-first behavior: do not wait for boot-id transition, reload quickly.
    await new Promise((resolve) => setTimeout(resolve, 450));
    window.location.reload();
  }

  async function onRestartAppClick(btn) {
    const restartIconBtn = btn || document.getElementById("restartIconBtn");
    openModal();
    const startedAt = Date.now();
    await withButtonLoading(restartIconBtn, async () => {
      const modal = document.getElementById("restartModal");
      const closeBtn = document.getElementById("btnRestartClose");
      setRestartButtonBusy(restartIconBtn, true);
      setRestartModalStatus(t("restart_modal_status_running"));
      setRestartProgressState("running");
      if (modal) {
        modal.dataset.running = "1";
      }
      try {
        await req("/api/system/restart/full", { method: "POST" });
        setRestartModalStatus(t("restart_modal_status_reconnecting"));
        await waitForRestartAndReload();
      } catch (err) {
        const elapsed = Date.now() - startedAt;
        if (elapsed < minAnimationMs) {
          await new Promise((resolve) =>
            setTimeout(resolve, minAnimationMs - elapsed)
          );
        }
        setRestartModalStatus(
          t("restart_modal_status_failed", { message: err?.message || String(err) }),
          "error"
        );
        setRestartProgressState("error");
        if (modal) {
          modal.dataset.running = "0";
        }
        if (closeBtn) {
          closeBtn.style.display = "inline-flex";
          closeBtn.disabled = false;
        }
      } finally {
        setRestartButtonBusy(restartIconBtn, false);
      }
    });
  }

  return {
    updateButtonState,
    closeModal,
    onRestartAppClick,
  };
}
