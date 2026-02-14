function createPoolActionsManager(deps) {
  const {
    t,
    req,
    withButtonLoading,
    textValue,
    showNoticeModal,
    loadPool,
    getSites,
    getApis,
    setSites,
    setApis,
    renderSites,
    renderApis,
    testEditorPayloadAndRender,
  } = deps;

  let undoState = { kind: "", payload: null, timer: null };

  function clearUndoNotice() {
    if (undoState.timer) {
      clearTimeout(undoState.timer);
    }
    undoState = { kind: "", payload: null, timer: null };
    const bar = document.getElementById("undoBar");
    if (bar) {
      bar.classList.remove("open");
    }
  }

  function refreshUndoText() {
    const text = document.getElementById("undoText");
    if (!text || !undoState.payload) return;
    const name = textValue(undoState.payload.name);
    const target = undoState.kind === "site" ? t("site_upper") : t("api_upper");
    text.textContent = t("undo_deleted", { target, name });
  }

  function showUndoNotice(kind, payload) {
    clearUndoNotice();
    undoState.kind = kind;
    undoState.payload = JSON.parse(JSON.stringify(payload));
    const bar = document.getElementById("undoBar");
    if (bar) {
      bar.classList.add("open");
    }
    refreshUndoText();
    undoState.timer = setTimeout(() => {
      clearUndoNotice();
    }, 8000);
  }

  async function onUndoDeleteClick(btn) {
    if (!undoState.payload || !undoState.kind) return;
    const kind = undoState.kind;
    const payload = JSON.parse(JSON.stringify(undoState.payload));
    clearUndoNotice();
    try {
      await withButtonLoading(btn, async () => {
        if (kind === "site") {
          await req("/api/site", { method: "POST", body: JSON.stringify(payload) });
        } else {
          await req("/api/api", { method: "POST", body: JSON.stringify(payload) });
        }
        await loadPool({ includeLocalData: false });
      });
    } catch (err) {
      showNoticeModal(err.message || String(err));
    }
  }

  async function removeSite(btn, name) {
    await withButtonLoading(btn, async () => {
      try {
        const decoded = decodeURIComponent(name);
        const backup = getSites().find((item) => textValue(item?.name) === decoded) || null;
        await req(`/api/site/${encodeURIComponent(decoded)}`, { method: "DELETE" });
        await loadPool({ includeLocalData: false });
        if (backup) {
          showUndoNotice("site", backup);
        }
      } catch (err) {
        showNoticeModal(err.message || String(err));
      }
    });
  }

  async function removeApi(btn, name) {
    await withButtonLoading(btn, async () => {
      try {
        const decoded = decodeURIComponent(name);
        const backup = getApis().find((item) => textValue(item?.name) === decoded) || null;
        await req(`/api/api/${encodeURIComponent(decoded)}`, { method: "DELETE" });
        const nextApis = getApis().filter((item) => textValue(item?.name) !== decoded);
        setApis(nextApis);
        renderApis();
        void loadPool({ includeLocalData: false, silent: true });
        if (backup) {
          showUndoNotice("api", backup);
        }
      } catch (err) {
        showNoticeModal(err.message || String(err));
      }
    });
  }

  async function toggleSiteEnabled(btn, name, nextEnabled) {
    await withButtonLoading(btn, async () => {
      try {
        const decoded = decodeURIComponent(name);
        await req(`/api/site/${encodeURIComponent(decoded)}`, {
          method: "PUT",
          body: JSON.stringify({ enabled: Boolean(nextEnabled) }),
        });
        const nextSites = getSites().map((item) =>
          textValue(item?.name) === decoded
            ? { ...item, enabled: Boolean(nextEnabled) }
            : item
        );
        setSites(nextSites);
        renderSites();
        void loadPool({ includeLocalData: false, silent: true });
      } catch (err) {
        showNoticeModal(err.message || String(err));
      }
    });
  }

  async function toggleApiEnabled(btn, name, nextEnabled) {
    await withButtonLoading(btn, async () => {
      try {
        const decoded = decodeURIComponent(name);
        await req(`/api/api/${encodeURIComponent(decoded)}`, {
          method: "PUT",
          body: JSON.stringify({ enabled: Boolean(nextEnabled) }),
        });
        const nextApis = getApis().map((item) =>
          textValue(item?.name) === decoded
            ? { ...item, enabled: Boolean(nextEnabled) }
            : item
        );
        setApis(nextApis);
        renderApis();
        void loadPool({ includeLocalData: false, silent: true });
      } catch (err) {
        showNoticeModal(err.message || String(err));
      }
    });
  }

  async function testSingleApi(btn, name) {
    if (btn && btn.dataset.loading === "1") return;
    const originalText = btn ? textValue(btn.textContent) : "";
    const originalTitle = btn ? textValue(btn.title) : "";
    try {
      if (btn) {
        btn.dataset.loading = "1";
        btn.disabled = true;
        btn.classList.add("is-loading");
        btn.textContent = originalText || t("test");
        btn.title = t("test_running");
      }
      const decoded = decodeURIComponent(name);
      const payload = getApis().find((api) => textValue(api?.name) === decoded);
      if (!payload) {
        throw new Error(t("api_not_found"));
      }
      await testEditorPayloadAndRender(payload, { deferModalUntilDone: true });
      await loadPool({ includeLocalData: false });
    } catch (err) {
      showNoticeModal(err.message || String(err));
    } finally {
      if (btn) {
        btn.dataset.loading = "0";
        btn.disabled = false;
        btn.classList.remove("is-loading");
        btn.textContent = originalText || t("test");
        btn.title = originalTitle;
      }
    }
  }

  return {
    clearUndoNotice,
    refreshUndoText,
    showUndoNotice,
    onUndoDeleteClick,
    removeSite,
    removeApi,
    toggleSiteEnabled,
    toggleApiEnabled,
    testSingleApi,
  };
}
