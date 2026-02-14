function createLocalDataManager(deps) {
  const {
    t,
    req,
    withButtonLoading,
    textValue,
    escapeHtml,
    formatBytes,
    formatTimestamp,
    formatLocalType,
    renderPager,
    formatItems,
    showNoticeModal,
    getLocalCollections,
    getLocalSearchText,
    getLocalPage,
    setLocalPage,
    getLocalPageSize,
    getSortState,
    localSortRules,
    getLocalViewerState,
    setLocalViewerState,
  } = deps;

  function getPendingDeleteSet() {
    const state = getLocalViewerState();
    if (!(state.pendingDeletes instanceof Set)) {
      state.pendingDeletes = new Set();
      setLocalViewerState(state);
    }
    return state.pendingDeletes;
  }

  function makePendingDeleteKey(type, index, path) {
    const normalizedType = textValue(type).trim().toLowerCase();
    if (normalizedType === "text" && Number(index) >= 0) {
      return `idx:${Number(index)}`;
    }
    return `path:${textValue(path)}`;
  }

  function updateLocalDeleteConfirmButton() {
    const btn = document.getElementById("btnConfirmLocalDataDelete");
    if (!btn) return;
    const pendingCount = getPendingDeleteSet().size;
    btn.disabled = pendingCount <= 0;
    btn.textContent =
      pendingCount > 0
        ? t("confirm_delete_count", { count: pendingCount })
        : t("confirm_delete");
  }

  function tuneLocalDataModalLayout(type, count) {
    const dialog = document.getElementById("localDataDialog");
    const list = document.getElementById("localDataItems");
    if (!dialog || !list) return;

    const n = Math.max(0, Number(count || 0));
    const isMedia = type === "image" || type === "video";
    const isAudio = type === "audio";

    let width = "min(860px, 96vw)";
    if (isMedia) {
      width =
        n <= 2 ? "min(760px, 96vw)" : n <= 6 ? "min(980px, 96vw)" : "min(1120px, 98vw)";
    } else if (isAudio) {
      width = n <= 4 ? "min(900px, 96vw)" : "min(1020px, 98vw)";
    } else {
      width =
        n <= 6 ? "min(760px, 94vw)" : n <= 20 ? "min(900px, 96vw)" : "min(1020px, 98vw)";
    }

    const maxHeight = n <= 4 ? "50vh" : n <= 12 ? "62vh" : "72vh";
    const minHeight = n === 0 ? "120px" : n <= 3 ? "180px" : "260px";

    dialog.style.width = width;
    list.style.maxHeight = maxHeight;
    list.style.minHeight = minHeight;
  }

  function renderLocalDataItems(detail) {
    const list = document.getElementById("localDataItems");
    const hint = document.getElementById("localDataModalHint");
    if (!list || !hint) return;

    const type = textValue(detail?.type).toLowerCase();
    const items = Array.isArray(detail?.items) ? detail.items : [];
    const pendingDeletes = getPendingDeleteSet();
    hint.textContent = `${t("items_count", { count: items.length })} | ${formatBytes(
      detail?.size_bytes || 0
    )}`;
    tuneLocalDataModalLayout(type, items.length);
    updateLocalDeleteConfirmButton();

    if (items.length === 0) {
      list.innerHTML = `<div class="empty-cell">${t("no_data")}</div>`;
      return;
    }

    if (type === "text") {
      list.innerHTML = `
          <div class="local-list-compact">
            ${items
              .map((item) => {
                const text = textValue(item?.text);
                const itemIndex = Number(item?.index ?? -1);
                const pendingKey = makePendingDeleteKey(type, itemIndex, "");
                const isPending = pendingDeletes.has(pendingKey);
                return `
                <div class="local-row-compact ${isPending ? "is-pending-delete" : ""}">
                  <button
                    class="local-close-btn ${isPending ? "is-pending-delete" : ""}"
                    title="${escapeHtml(t("delete"))}"
                    aria-label="${escapeHtml(t("delete"))}"
                    onclick='removeLocalItem(this, "${encodeURIComponent(type)}", "${encodeURIComponent(
                  textValue(detail.name)
                )}", ${itemIndex}, "")'
                  >x</button>
                  <div class="local-row-main">
                    <span class="local-row-index">${itemIndex + 1}</span>
                    <span class="local-row-text" title="${escapeHtml(text)}">${escapeHtml(text)}</span>
                  </div>
                </div>
              `;
              })
              .join("")}
          </div>
        `;
      return;
    }

    if (type === "audio") {
      list.innerHTML = `
          <div class="local-list-compact">
            ${items
              .map((item) => {
                const path = textValue(item?.path);
                const pendingKey = makePendingDeleteKey(type, -1, path);
                const isPending = pendingDeletes.has(pendingKey);
                const fileUrl = `/api/local-file?path=${encodeURIComponent(path)}`;
                return `
                <div class="local-row-compact local-row-audio ${isPending ? "is-pending-delete" : ""}">
                  <button
                    class="local-close-btn ${isPending ? "is-pending-delete" : ""}"
                    title="${escapeHtml(t("delete"))}"
                    aria-label="${escapeHtml(t("delete"))}"
                    onclick='removeLocalItem(this, "${encodeURIComponent(type)}", "${encodeURIComponent(
                  textValue(detail.name)
                )}", -1, "${encodeURIComponent(path)}")'
                  >x</button>
                  <div class="local-row-main">
                    <span class="local-row-label">${escapeHtml(textValue(item?.name))}</span>
                    <audio class="local-audio-inline" src="${escapeHtml(fileUrl)}" controls preload="metadata"></audio>
                  </div>
                </div>
              `;
              })
              .join("")}
          </div>
        `;
      return;
    }

    list.innerHTML = `
        <div class="local-media-grid">
          ${items
            .map((item) => {
              const path = textValue(item?.path);
              const pendingKey = makePendingDeleteKey(type, -1, path);
              const isPending = pendingDeletes.has(pendingKey);
              const fileUrl = `/api/local-file?path=${encodeURIComponent(path)}`;
              const media =
                type === "image"
                  ? `<img class="test-saved-media test-saved-image" src="${escapeHtml(fileUrl)}" alt="saved image">`
                  : `<video class="test-saved-media" src="${escapeHtml(fileUrl)}" controls preload="metadata"></video>`;
              return `
              <div class="local-media-card ${isPending ? "is-pending-delete" : ""}">
                <button
                  class="local-close-btn ${isPending ? "is-pending-delete" : ""}"
                  title="${escapeHtml(t("delete"))}"
                  aria-label="${escapeHtml(t("delete"))}"
                  onclick='removeLocalItem(this, "${encodeURIComponent(type)}", "${encodeURIComponent(
                textValue(detail.name)
              )}", -1, "${encodeURIComponent(path)}")'
                >x</button>
                <div class="local-item-meta">${escapeHtml(textValue(item?.name))}</div>
                ${media}
              </div>
            `;
            })
            .join("")}
        </div>
      `;
  }

  function renderLocalData() {
    const table = document.getElementById("localDataTable");
    if (!table) return;

    const sorted = PageHelpers.getSortedLocalCollections(
      getLocalCollections(),
      getSortState().local
    );
    const filtered = PageHelpers.filterLocalCollections(sorted, getLocalSearchText());
    const total = filtered.length;
    const pagination = PageHelpers.paginateItems(filtered, getLocalPage(), getLocalPageSize());
    setLocalPage(pagination.page);

    const countNode = document.getElementById("localDataCount");
    if (countNode) {
      countNode.textContent = formatItems(total);
    }

    renderPager({
      pagerId: "localPagerTop",
      page: getLocalPage(),
      totalPages: pagination.totalPages,
      total,
      start: pagination.startIndex + 1,
      end: pagination.startIndex + pagination.pageItems.length,
      onPageChange: "onLocalPageChange",
    });

    const rows = pagination.pageItems
      .map(
        (item, index) => `
        <tr>
          <td>${pagination.startIndex + index + 1}</td>
          <td><code class="name-code">${escapeHtml(textValue(item.name))}</code></td>
          <td>${formatLocalType(item.type)}</td>
          <td>${Number(item.count || 0)}</td>
          <td>${escapeHtml(formatBytes(item.size_bytes))}</td>
          <td>${escapeHtml(formatTimestamp(item.updated_at))}</td>
          <td class="actions-cell">
            <button onclick='openLocalDataViewer(this, "${encodeURIComponent(
              textValue(item.type)
            )}", "${encodeURIComponent(textValue(item.name))}")'>${t("view")}</button>
            <button class="danger" onclick='removeLocalCollection(this, "${encodeURIComponent(
              textValue(item.type)
            )}", "${encodeURIComponent(textValue(item.name))}")'>${t("delete")}</button>
          </td>
        </tr>
      `
      )
      .join("");

    const sortState = getSortState();
    table.innerHTML = `
        <tr>
          <th>${t("serial_no")}</th>
          <th class="sortable-head" onclick="onLocalHeaderSort('name')">${t("name")}<span class="sort-indicator">${PageHelpers.getSortIndicator(sortState.local, localSortRules.name)}</span></th>
          <th class="sortable-head" onclick="onLocalHeaderSort('type')">${t("type")}<span class="sort-indicator">${PageHelpers.getSortIndicator(sortState.local, localSortRules.type)}</span></th>
          <th class="sortable-head" onclick="onLocalHeaderSort('count')">${t("items_count_short")}<span class="sort-indicator">${PageHelpers.getSortIndicator(sortState.local, localSortRules.count)}</span></th>
          <th class="sortable-head" onclick="onLocalHeaderSort('size')">${t("size")}<span class="sort-indicator">${PageHelpers.getSortIndicator(sortState.local, localSortRules.size)}</span></th>
          <th class="sortable-head" onclick="onLocalHeaderSort('updated')">${t("updated_at")}<span class="sort-indicator">${PageHelpers.getSortIndicator(sortState.local, localSortRules.updated)}</span></th>
          <th>${t("actions")}</th>
        </tr>
        ${rows || `<tr><td colspan="7" class="empty-cell">${t("no_data")}</td></tr>`}
      `;
  }

  function closeLocalDataModal() {
    const modal = document.getElementById("localDataModal");
    if (modal) {
      modal.classList.remove("open");
    }
    const state = getLocalViewerState();
    state.pendingDeletes = new Set();
    setLocalViewerState(state);
    updateLocalDeleteConfirmButton();
  }

  async function loadLocalData() {
    try {
      const data = await req("/api/local-data");
      const collections = Array.isArray(data?.collections) ? data.collections : [];
      deps.setLocalCollections(collections);
      renderLocalData();
    } catch (err) {
      showNoticeModal(err.message || String(err));
    }
  }

  async function onRefreshLocalDataClick(btn) {
    await withButtonLoading(btn, async () => {
      await loadLocalData();
    });
  }

  async function openLocalDataViewer(btn, type, name) {
    await withButtonLoading(btn, async () => {
      try {
        const decodedType = decodeURIComponent(type || "");
        const decodedName = decodeURIComponent(name || "");
        const detail = await req(
          `/api/local-data/${encodeURIComponent(decodedType)}/${encodeURIComponent(decodedName)}`
        );
        setLocalViewerState({
          type: decodedType,
          name: decodedName,
          detail,
          pendingDeletes: new Set(),
        });
        document.getElementById("localDataModalTitle").textContent = `${decodedName} (${decodedType})`;
        renderLocalDataItems(detail);
        const modal = document.getElementById("localDataModal");
        if (modal) modal.classList.add("open");
      } catch (err) {
        showNoticeModal(err.message || String(err));
      }
    });
  }

  async function removeLocalCollection(btn, type, name) {
    await withButtonLoading(btn, async () => {
      try {
        const decodedType = decodeURIComponent(type || "");
        const decodedName = decodeURIComponent(name || "");
        await req(
          `/api/local-data/${encodeURIComponent(decodedType)}/${encodeURIComponent(decodedName)}`,
          { method: "DELETE" }
        );
        const state = getLocalViewerState();
        if (textValue(state.type) === decodedType && textValue(state.name) === decodedName) {
          closeLocalDataModal();
        }
        await loadLocalData();
      } catch (err) {
        showNoticeModal(err.message || String(err));
      }
    });
  }

  function removeLocalItem(_, type, __, index, path) {
    const state = getLocalViewerState();
    const decodedType = decodeURIComponent(type || "");
    const decodedPath = path ? decodeURIComponent(path || "") : "";
    const pendingKey = makePendingDeleteKey(decodedType, Number(index), decodedPath);
    const pendingDeletes = getPendingDeleteSet();
    if (pendingDeletes.has(pendingKey)) {
      pendingDeletes.delete(pendingKey);
    } else {
      pendingDeletes.add(pendingKey);
    }
    renderLocalDataItems(state.detail || {});
  }

  async function onConfirmLocalDataDeleteClick(btn) {
    await withButtonLoading(btn, async () => {
      try {
        const state = getLocalViewerState();
        const decodedType = textValue(state.type);
        const decodedName = textValue(state.name);
        const pendingDeletes = getPendingDeleteSet();
        if (!decodedType || !decodedName || pendingDeletes.size <= 0) {
          updateLocalDeleteConfirmButton();
          return;
        }

        const items = Array.from(pendingDeletes).map((key) => {
          if (key.startsWith("idx:")) {
            return { index: Number(key.slice(4)) };
          }
          return { path: key.startsWith("path:") ? key.slice(5) : key };
        });

        await req("/api/local-data-item", {
          method: "DELETE",
          body: JSON.stringify({
            type: decodedType,
            name: decodedName,
            items,
          }),
        });

        const detail = await req(
          `/api/local-data/${encodeURIComponent(decodedType)}/${encodeURIComponent(decodedName)}`
        );
        setLocalViewerState({
          ...state,
          detail,
          pendingDeletes: new Set(),
        });
        renderLocalDataItems(detail);
        await loadLocalData();
      } catch (err) {
        const msg = textValue(err?.message);
        if (msg.includes("not found")) {
          closeLocalDataModal();
          await loadLocalData();
          return;
        }
        showNoticeModal(msg || String(err));
      }
    });
  }

  return {
    renderLocalData,
    closeLocalDataModal,
    getPendingDeleteSet,
    makePendingDeleteKey,
    updateLocalDeleteConfirmButton,
    tuneLocalDataModalLayout,
    renderLocalDataItems,
    loadLocalData,
    onRefreshLocalDataClick,
    openLocalDataViewer,
    removeLocalCollection,
    removeLocalItem,
    onConfirmLocalDataDeleteClick,
  };
}

