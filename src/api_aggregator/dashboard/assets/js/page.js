    if (typeof I18N === "undefined") {
      throw new Error("i18n resource not loaded");
    }

    function getDefaultLang() {
      const saved = localStorage.getItem("api_aggregator_lang");
      if (saved && I18N[saved]) {
        return saved;
      }
      const navLang = (navigator.language || "en").toLowerCase();
      return navLang.startsWith("zh") ? "zh" : "en";
    }

    function getDefaultTheme() {
      const saved = localStorage.getItem("api_aggregator_theme");
      if (saved === "light" || saved === "dark" || saved === "auto") {
        return saved;
      }
      return "auto";
    }

    function getDefaultSortState() {
      const raw = localStorage.getItem("api_aggregator_sort");
      if (!raw) {
        return { site: "name_asc", api: "name_asc", local: "name_asc" };
      }
      try {
        const parsed = JSON.parse(raw);
        return {
          site: typeof parsed?.site === "string" ? parsed.site : "name_asc",
          api: typeof parsed?.api === "string" ? parsed.api : "name_asc",
          local: typeof parsed?.local === "string" ? parsed.local : "name_asc"
        };
      } catch {
        return { site: "name_asc", api: "name_asc", local: "name_asc" };
      }
    }

    function getDefaultPageSize() {
      const raw = String(localStorage.getItem("api_aggregator_page_size") || "all").toLowerCase();
      if (raw === "all") {
        return "all";
      }
      const numeric = Number.parseInt(raw, 10);
      if ([10, 20, 50, 100].includes(numeric)) {
        return numeric;
      }
      return "all";
    }

    function getDefaultMainTab() {
      const saved = localStorage.getItem("api_aggregator_main_tab");
      if (saved === "site" || saved === "api" || saved === "local") {
        return saved;
      }
      return "api";
    }

    let currentLang = getDefaultLang();
    let currentTheme = getDefaultTheme();
    let sortState = getDefaultSortState();
    let apiSearchText = "";
    let apiPage = 1;
    let apiPageSize = getDefaultPageSize();
    let mainTab = getDefaultMainTab();
    let state = { sites: [], apis: [] };
    let localCollections = [];
    let editorState = { kind: "", originalName: "" };
    let localViewerState = { type: "", name: "", detail: null, pendingDeletes: new Set() };
    let testStreamAbort = null;
    let testRunning = false;
    let singleRepeatRunning = false;
    let singleRepeatTimer = null;
    let singleRepeatPayload = null;
    let singleRepeatCount = 0;
    let singleRepeatPaused = false;
    let singleRepeatSkipDuplicatePrompt = false;
    let duplicateChoiceResolver = null;
    let singleRepeatTaskId = "";
    let restartAutoCloseTimer = null;
    let restartProgressTimer = null;
    let restartProgressValue = 0;
    const RESTART_MIN_ANIMATION_MS = 900;
    let taskSeq = 0;
    const runningTasks = [];
    let activeTestTaskId = "";
    let undoState = { kind: "", payload: null, timer: null };
    const editorTemplates = { site: "", api: "" };
    const SITE_SORT_RULES = {
      name: ["name_asc", "name_desc"],
      url: ["url_asc", "url_desc"],
      timeout: ["timeout_asc", "timeout_desc"]
    };
    const API_SORT_RULES = {
      name: ["name_asc", "name_desc"],
      url: ["url_asc", "url_desc"],
      type: ["type_asc", "type_desc"],
      valid: ["valid_first", "invalid_first"],
      keywords: ["keywords_desc", "name_asc"]
    };
    const LOCAL_SORT_RULES = {
      name: ["name_asc", "name_desc"],
      type: ["type_asc", "type_desc"],
      count: ["count_asc", "count_desc"],
      size: ["size_asc", "size_desc"],
      updated: ["updated_desc", "updated_asc"]
    };

    function t(key, vars = {}) {
      const dict = I18N[currentLang] || I18N.en;
      const fallback = I18N.en[key] || key;
      const template = dict[key] || fallback;
      return String(template).replace(/\{(\w+)\}/g, (_, name) => {
        const value = vars[name];
        return value === undefined || value === null ? "" : String(value);
      });
    }

    function setLanguage(lang) {
      currentLang = I18N[lang] ? lang : "en";
      localStorage.setItem("api_aggregator_lang", currentLang);
      document.documentElement.lang = currentLang === "zh" ? "zh-CN" : "en";
      applyI18n();
      render();
    }

    function updateLanguageIcon() {
      const btn = document.getElementById("langIconBtn");
      const icon = document.getElementById("langIcon");
      if (!btn || !icon) return;
      const nextLabel = currentLang === "zh" ? "English" : "简体中文";
      const title = `${t("language_label")}: ${currentLang === "zh" ? "简体中文" : "English"} (→ ${nextLabel})`;
      btn.title = title;
      btn.setAttribute("aria-label", title);
      icon.style.opacity = currentLang === "zh" ? "0.82" : "1";
    }

    function toggleLanguageMode() {
      setLanguage(currentLang === "zh" ? "en" : "zh");
      updateLanguageIcon();
    }

    function setTheme(theme) {
      currentTheme = theme === "light" || theme === "dark" ? theme : "auto";
      localStorage.setItem("api_aggregator_theme", currentTheme);
      if (currentTheme === "auto") {
        document.documentElement.removeAttribute("data-theme");
      } else {
        document.documentElement.setAttribute("data-theme", currentTheme);
      }
    }

    function getThemeIconPath(theme) {
      if (theme === "light") {
        return "M12 4.5A1 1 0 0 1 13 5.5V7A1 1 0 1 1 11 7V5.5A1 1 0 0 1 12 4.5M12 16A4 4 0 1 0 12 8A4 4 0 0 0 12 16M18.36 6.64A1 1 0 0 1 18.36 8.05L17.3 9.11A1 1 0 1 1 15.89 7.7L16.95 6.64A1 1 0 0 1 18.36 6.64M7.05 16.95A1 1 0 1 1 8.46 18.36L7.4 19.42A1 1 0 1 1 5.99 18L7.05 16.95M19.5 11A1 1 0 1 1 19.5 13H18A1 1 0 1 1 18 11H19.5M6 11A1 1 0 1 1 6 13H4.5A1 1 0 1 1 4.5 11H6M17.3 14.89A1 1 0 0 1 18.71 14.89L19.77 15.95A1 1 0 1 1 18.36 17.36L17.3 16.3A1 1 0 0 1 17.3 14.89M7.05 7.05A1 1 0 0 1 7.05 8.46L5.99 9.52A1 1 0 0 1 4.58 8.11L5.64 7.05A1 1 0 0 1 7.05 7.05M12 17A1 1 0 0 1 13 18V19.5A1 1 0 1 1 11 19.5V18A1 1 0 0 1 12 17Z";
      }
      if (theme === "dark") {
        return "M12.74 2.01A10 10 0 1 0 21.99 11.26A8 8 0 0 1 12.74 2.01Z";
      }
      return "M12 3A9 9 0 1 0 21 12A1 1 0 0 1 20 13A8 8 0 1 1 12 4A1 1 0 0 1 12 3Z";
    }

    function updateThemeIcon() {
      const icon = document.getElementById("themeIcon");
      const btn = document.getElementById("themeIconBtn");
      if (!icon || !btn) return;
      icon.innerHTML = `<path d="${getThemeIconPath(currentTheme)}"></path>`;
      const themeText = t(
        currentTheme === "auto"
          ? "theme_auto"
          : currentTheme === "light"
            ? "theme_light"
            : "theme_dark"
      );
      const label = `${t("theme_label")}: ${themeText}`;
      btn.title = label;
      btn.setAttribute("aria-label", label);
    }

    function toggleThemeMode() {
      const order = ["auto", "light", "dark"];
      const idx = order.indexOf(currentTheme);
      const next = order[(idx + 1) % order.length];
      setTheme(next);
      updateThemeIcon();
    }

    function updateRestartButtonState(btn = document.getElementById("restartIconBtn")) {
      if (!btn) return;
      const isRestarting = btn.dataset.restarting === "1";
      const label = t(isRestarting ? "restart_service_restarting" : "restart_service");
      btn.title = label;
      btn.setAttribute("aria-label", label);
    }

    function setRestartButtonBusy(btn, busy) {
      if (!btn) return;
      btn.dataset.restarting = busy ? "1" : "0";
      updateRestartButtonState(btn);
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

    function openRestartModal() {
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
      }
      if (modal) {
        modal.classList.add("open");
      }
    }

    function closeRestartModal(force = false) {
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
      }
      if (modal) {
        modal.classList.remove("open");
      }
      setRestartProgressValue(0);
    }

    function persistSortState() {
      localStorage.setItem("api_aggregator_sort", JSON.stringify(sortState));
    }

    function onSiteSortChange(rule) {
      sortState.site = rule || "name_asc";
      persistSortState();
      loadPool();
    }

    function onApiSortChange(rule) {
      sortState.api = rule || "name_asc";
      apiPage = 1;
      persistSortState();
      loadPool();
    }

    function onLocalSortChange(rule) {
      sortState.local = rule || "name_asc";
      persistSortState();
      renderLocalData();
    }

    function onSiteHeaderSort(field) {
      const rules = SITE_SORT_RULES[field];
      if (!rules || !rules.length) return;
      const idx = rules.indexOf(sortState.site);
      const next = idx < 0 ? rules[0] : rules[(idx + 1) % rules.length];
      onSiteSortChange(next);
    }

    function onApiHeaderSort(field) {
      const rules = API_SORT_RULES[field];
      if (!rules || !rules.length) return;
      const idx = rules.indexOf(sortState.api);
      const next = idx < 0 ? rules[0] : rules[(idx + 1) % rules.length];
      onApiSortChange(next);
    }

    function onLocalHeaderSort(field) {
      const rules = LOCAL_SORT_RULES[field];
      if (!rules || !rules.length) return;
      const idx = rules.indexOf(sortState.local);
      const next = idx < 0 ? rules[0] : rules[(idx + 1) % rules.length];
      onLocalSortChange(next);
    }

    function getSortIndicator(currentRule, rules) {
      if (!Array.isArray(rules) || !rules.length) return "";
      if (currentRule === rules[0]) return "▲";
      if (rules.length > 1 && currentRule === rules[1]) return "▼";
      return "";
    }

    function onApiSearchChange(value) {
      apiSearchText = textValue(value).trim();
      apiPage = 1;
      renderApis();
    }

    function onApiPageChange(page) {
      const nextPage = Number(page || 1);
      if (!Number.isFinite(nextPage) || nextPage < 1) return;
      apiPage = nextPage;
      renderApis();
    }

    function onApiPageSizeChange(value) {
      const raw = String(value || "").toLowerCase();
      if (raw === "all") {
        apiPageSize = "all";
      } else {
        const nextSize = Number.parseInt(raw, 10);
        if (![10, 20, 50, 100].includes(nextSize)) {
          return;
        }
        apiPageSize = nextSize;
      }
      apiPage = 1;
      localStorage.setItem("api_aggregator_page_size", String(apiPageSize));
      renderApis();
    }

    function applyI18n() {
      document.title = t("page_title");
      document.querySelectorAll("[data-i18n]").forEach((node) => {
        const key = node.getAttribute("data-i18n");
        if (key) {
          node.textContent = t(key);
        }
      });
      document.getElementById("btnTestAll").textContent = t("test_all_apis");
      const repoLink = document.getElementById("repoLink");
      if (repoLink) {
        const label = t("repo_button");
        repoLink.title = label;
        repoLink.setAttribute("aria-label", label);
      }
      const authorLink = document.getElementById("authorLink");
      if (authorLink) {
        const label = t("author_home_button");
        authorLink.title = label;
        authorLink.setAttribute("aria-label", label);
      }
      const restartBtn = document.getElementById("restartIconBtn");
      if (restartBtn) {
        updateRestartButtonState(restartBtn);
      }
      updateLanguageIcon();
      updateThemeIcon();
      const apiSearch = document.getElementById("apiSearch");
      if (apiSearch) {
        apiSearch.placeholder = t("api_search_placeholder");
      }
      const apiPageSizePicker = document.getElementById("apiPageSize");
      if (apiPageSizePicker) {
        apiPageSizePicker.value = String(apiPageSize);
      }
      document.getElementById("btnAddSite").textContent = t("add_site");
      document.getElementById("btnAddApi").textContent = t("add_api");
      document.getElementById("btnTestEditor").textContent = t("test_params");
      document.getElementById("btnSave").textContent = t("save");
      document.getElementById("btnCancel").textContent = t("cancel");
      document.getElementById("btnCloseTestModal").textContent = t("close");
      document.getElementById("btnCloseLocalDataModal").textContent = t("close");
      document.getElementById("btnUndoDelete").textContent = t("undo");
      document.getElementById("btnRefreshLocalData").textContent = t("refresh");
      const tabSiteLabel = document.getElementById("tabBtnSiteLabel");
      if (tabSiteLabel) tabSiteLabel.textContent = t("site_pool");
      const tabApiLabel = document.getElementById("tabBtnApiLabel");
      if (tabApiLabel) tabApiLabel.textContent = t("api_pool");
      const tabLocalLabel = document.getElementById("tabBtnLocalLabel");
      if (tabLocalLabel) tabLocalLabel.textContent = t("local_data_pool");
      document.getElementById("testModalTitle").textContent = t("test_all_title");
      document.getElementById("editorHint").textContent = t("json_object");
      document.getElementById("localDataModalTitle").textContent = t("local_data_detail_title");
      const statsTask = activeTestTaskId ? getRunningTask(activeTestTaskId) : null;
      updateTestStats(statsTask);
      renderRunningTasks();
      refreshSingleRepeatButtonLabel();
      updateLocalDeleteConfirmButton();
      refreshUndoText();
      refreshEditorI18n();
      renderLocalData();
    }

    function switchMainTab(tab) {
      const next = tab === "site" || tab === "api" || tab === "local" ? tab : "api";
      mainTab = next;
      localStorage.setItem("api_aggregator_main_tab", mainTab);

      const panels = {
        site: document.getElementById("panelSite"),
        api: document.getElementById("panelApi"),
        local: document.getElementById("panelLocal")
      };
      const buttons = {
        site: document.getElementById("tabBtnSite"),
        api: document.getElementById("tabBtnApi"),
        local: document.getElementById("tabBtnLocal")
      };

      Object.keys(panels).forEach((key) => {
        const active = key === mainTab;
        panels[key]?.classList.toggle("is-active", active);
        buttons[key]?.classList.toggle("is-active", active);
      });
    }

    function buildTestStatsText(stats) {
      const completed = Math.max(0, Number(stats?.completed || 0));
      const total = Math.max(0, Number(stats?.total || 0));
      const success = Math.max(0, Number(stats?.success || 0));
      const fail = Math.max(0, Number(stats?.fail || 0));
      return `${t("test_stats_runs", { completed, total })} | ${t("test_stats_success", { count: success })} | ${t("test_stats_fail", { count: fail })}`;
    }

    function updateTestStats(stats = null) {
      const node = document.getElementById("testProgressText");
      if (!node) return;
      if (!stats) {
        node.textContent = "";
        return;
      }
      node.textContent = buildTestStatsText(stats);
    }

    function createRunningTask(kind, title, extra = {}) {
      const id = `task_${Date.now()}_${++taskSeq}`;
      const task = {
        id,
        kind,
        title: title || kind,
        running: true,
        completed: 0,
        total: 0,
        success: 0,
        fail: 0,
        summary: "",
        ...extra
      };
      runningTasks.push(task);
      renderRunningTasks();
      return task;
    }

    function getRunningTask(taskId) {
      return runningTasks.find((task) => task.id === taskId) || null;
    }

    function patchRunningTask(taskId, patch = {}) {
      const task = getRunningTask(taskId);
      if (!task) return null;
      Object.assign(task, patch);
      renderRunningTasks();
      if (activeTestTaskId === taskId) {
        updateTestStats(task);
      }
      return task;
    }

    function finishRunningTask(taskId, patch = {}) {
      const task = getRunningTask(taskId);
      if (!task) return;
      Object.assign(task, patch, { running: false });
      renderRunningTasks();
    }

    function renderRunningTasks() {
      const bar = document.getElementById("runningTasksBar");
      if (!bar) return;
      const active = runningTasks.filter((task) => task.running);
      if (!active.length) {
        bar.classList.remove("open");
        bar.innerHTML = "";
        return;
      }
      bar.classList.add("open");
      const chips = active.map((task) => `
        <span class="running-task-chip">
          <strong>${escapeHtml(task.title)}</strong>
          <span>${escapeHtml(buildTestStatsText(task))}</span>
          <button type="button" class="btn-square" onclick="onStopTaskClick('${task.id}')">${escapeHtml(t("stop"))}</button>
        </span>
      `).join("");
      bar.innerHTML = `
        <div class="running-tasks-row">
          <strong>${escapeHtml(t("running_tasks"))}</strong>
          ${chips}
        </div>
      `;
    }

    function boolText(value) {
      return value ? t("true_text") : t("false_text");
    }

    function formatItems(count) {
      return t("items_count", { count });
    }

    function getFieldValue(id) {
      const node = document.getElementById(id);
      if (!node) return "";
      if (node.type === "checkbox") return Boolean(node.checked);
      return node.value || "";
    }

    function renderPairRows(containerId, pairs) {
      const container = document.getElementById(containerId);
      if (!container) return;
      const safePairs = Array.isArray(pairs) && pairs.length ? pairs : [{ key: "", value: "" }];
      container.innerHTML = safePairs
        .map((item, idx) => `
          <div class="kv-row">
            <input data-kv="${containerId}" data-kv-role="key" data-kv-index="${idx}" class="text-input" placeholder="${escapeHtml(t("key_name"))}" value="${escapeHtml(textValue(item.key))}">
            <input data-kv="${containerId}" data-kv-role="value" data-kv-index="${idx}" class="text-input" placeholder="${escapeHtml(t("value_name"))}" value="${escapeHtml(textValue(item.value))}">
            <button type="button" class="local-close-btn" title="${escapeHtml(t("delete"))}" aria-label="${escapeHtml(t("delete"))}" onclick="removePairRow('${containerId}', ${idx})">×</button>
          </div>
        `).join("");
    }

    function readPairRows(containerId) {
      const keyNodes = Array.from(document.querySelectorAll(`[data-kv='${containerId}'][data-kv-role='key']`));
      const valueNodes = Array.from(document.querySelectorAll(`[data-kv='${containerId}'][data-kv-role='value']`));
      return keyNodes.map((node, idx) => ({
        key: node.value || "",
        value: valueNodes[idx] ? valueNodes[idx].value || "" : ""
      }));
    }

    function addPairRow(containerId) {
      const pairs = readPairRows(containerId);
      pairs.push({ key: "", value: "" });
      renderPairRows(containerId, pairs);
    }

    function removePairRow(containerId, index) {
      const next = readPairRows(containerId).filter((_, idx) => idx !== index);
      renderPairRows(containerId, next);
    }

    function pairsToMap(containerId) {
      const result = {};
      readPairRows(containerId).forEach((item) => {
        const key = textValue(item.key).trim();
        if (key) {
          result[key] = textValue(item.value);
        }
      });
      return result;
    }

    function renderListRows(containerId, items) {
      const container = document.getElementById(containerId);
      if (!container) return;
      container.classList.add("list-collection");
      const values = Array.isArray(items)
        ? items.map((item) => textValue(item).trim())
        : [];
      const safeValues = values.length ? values : [""];
      container.innerHTML = safeValues
        .map((value, idx) => `
          <div class="list-row" data-list-row="${containerId}" data-list-row-index="${idx}">
            <input data-list="${containerId}" data-list-index="${idx}" class="text-input" placeholder="${escapeHtml(t("value_name"))}" value="${escapeHtml(textValue(value))}" oninput="onListInputChange('${containerId}')">
            <button type="button" class="local-close-btn" title="${escapeHtml(t("delete"))}" aria-label="${escapeHtml(t("delete"))}" onclick="removeListRow('${containerId}', ${idx})">×</button>
          </div>
        `).join("");
      applyListLayout(containerId);
    }

    function readListRows(containerId, keepEmpty = false) {
      const nodes = Array.from(document.querySelectorAll(`[data-list='${containerId}']`));
      const values = nodes.map((node) => textValue(node.value).trim());
      return keepEmpty ? values : values.filter(Boolean);
    }

    function addListRow(containerId) {
      const items = readListRows(containerId, true);
      items.push("");
      renderListRows(containerId, items);
    }

    function removeListRow(containerId, index) {
      const next = readListRows(containerId).filter((_, idx) => idx !== index);
      renderListRows(containerId, next);
    }

    function estimateListItemWidth(text) {
      const len = textValue(text).trim().length;
      return Math.max(140, Math.min(360, 84 + len * 10));
    }

    function applyListLayout(containerId) {
      const container = document.getElementById(containerId);
      if (!container) return;
      const rows = Array.from(container.querySelectorAll(`[data-list-row='${containerId}']`));
      if (!rows.length) return;
      const gap = 8;
      const width = Math.max(260, container.clientWidth || 680);
      const specs = rows.map((row, idx) => {
        const input = row.querySelector(`[data-list='${containerId}'][data-list-index='${idx}']`);
        return { idx, est: estimateListItemWidth(input ? input.value : "") };
      });

      const rowGroups = [];
      let current = [];
      let used = 0;
      specs.forEach((item) => {
        const needed = current.length === 0 ? item.est : item.est + gap;
        if (current.length > 0 && used + needed > width) {
          rowGroups.push(current);
          current = [item];
          used = item.est;
        } else {
          current.push(item);
          used += needed;
        }
      });
      if (current.length) rowGroups.push(current);

      rowGroups.forEach((group) => {
        const cols = group.length || 1;
        group.forEach((entry) => {
          rows[entry.idx].style.setProperty("--row-cols", String(cols));
        });
      });
    }

    function onListInputChange(containerId) {
      applyListLayout(containerId);
    }

    window.addListRow = addListRow;
    window.removeListRow = removeListRow;
    window.onListInputChange = onListInputChange;

    function refreshEditorI18n() {
      const form = document.getElementById("editorForm");
      if (!form || !form.children.length) return;
      form.querySelectorAll("[data-editor-i18n]").forEach((node) => {
        const key = node.getAttribute("data-editor-i18n");
        if (key) {
          node.textContent = t(key);
        }
      });
      form.querySelectorAll("[data-editor-i18n-placeholder]").forEach((node) => {
        const key = node.getAttribute("data-editor-i18n-placeholder");
        if (key) {
          node.placeholder = t(key);
        }
      });
      form.querySelectorAll("[data-kv-role='key']").forEach((node) => {
        node.placeholder = t("key_name");
      });
      form.querySelectorAll("[data-kv-role='value']").forEach((node) => {
        node.placeholder = t("value_name");
      });
      form.querySelectorAll("[data-list]").forEach((node) => {
        node.placeholder = t("value_name");
      });
    }

    function bindEditorAddTriggers(form) {
      if (!form) return;
      form.querySelectorAll("[data-add-action][data-add-target]").forEach((node) => {
        node.classList.add("field-add-trigger");
        const triggerAdd = () => {
          const action = textValue(node.getAttribute("data-add-action")).trim().toLowerCase();
          const target = textValue(node.getAttribute("data-add-target")).trim();
          if (!target) return;
          if (action === "pair") {
            addPairRow(target);
            return;
          }
          addListRow(target);
        };
        node.addEventListener("click", triggerAdd);
        node.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            triggerAdd();
          }
        });
      });
    }

    async function loadEditorTemplate(kind) {
      if (editorTemplates[kind]) {
        return editorTemplates[kind];
      }
      const url = kind === "site" ? "/editor/site-form.html" : "/editor/api-form.html";
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`failed to load ${kind} form template`);
      }
      const html = await resp.text();
      editorTemplates[kind] = html;
      return html;
    }

    function fillSiteForm(data) {
      const siteName = document.getElementById("siteName");
      const siteUrl = document.getElementById("siteUrl");
      const siteTimeout = document.getElementById("siteTimeout");
      if (siteName) siteName.value = textValue(data.name);
      if (siteUrl) siteUrl.value = textValue(data.url);
      if (siteTimeout) siteTimeout.value = String(Number(data.timeout || 60));
      renderPairRows("siteHeaders", mapToPairs(data.headers));
      renderPairRows("siteKeys", mapToPairs(data.keys));
    }

    function fillApiForm(data) {
      const apiName = document.getElementById("apiName");
      const apiUrl = document.getElementById("apiUrl");
      const apiType = document.getElementById("apiType");
      const apiCron = document.getElementById("apiCron");
      if (apiName) apiName.value = textValue(data.name);
      if (apiUrl) apiUrl.value = textValue(data.url);
      if (apiType) apiType.value = textValue(data.type || "text");
      if (apiCron) apiCron.value = textValue(data.cron);
      renderListRows("apiParseList", stringToLineList(data.parse));
      renderListRows("apiScopeList", normalizeList(data.scope));
      renderListRows("apiKeywordsList", normalizeList(data.keywords));
      renderPairRows("apiParams", mapToPairs(data.params));
    }

    function parsePositiveInt(value) {
      const parsed = Number.parseInt(String(value), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(t("timeout_invalid"));
      }
      return parsed;
    }

    function validateCronExpression(value) {
      const cron = textValue(value).trim();
      if (!cron) {
        return "";
      }

      const parts = cron.split(/\s+/).filter(Boolean);
      if (parts.length !== 5) {
        throw new Error(t("cron_invalid"));
      }

      const tokenPattern = /^[A-Za-z0-9*/,\-?#LW]+$/;
      for (const part of parts) {
        if (!tokenPattern.test(part)) {
          throw new Error(t("cron_invalid"));
        }
      }

      const fieldSpecs = [
        { name: "minute", min: 0, max: 59 },
        { name: "hour", min: 0, max: 23 },
        { name: "day", min: 1, max: 31 },
        { name: "month", min: 1, max: 12 },
        { name: "weekday", min: 0, max: 7 }
      ];

      const aliases = {
        month: ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"],
        weekday: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
      };

      function assertInRange(fieldName, num, min, max) {
        if (!Number.isInteger(num) || num < min || num > max) {
          throw new Error(t("cron_invalid_range", { field: fieldName, min, max }));
        }
      }

      function parseCronValue(fieldName, raw) {
        const value = String(raw).trim().toLowerCase();
        const names = aliases[fieldName] || [];
        const idx = names.indexOf(value);
        if (idx >= 0) {
          return fieldName === "weekday" ? idx : idx + 1;
        }
        const numeric = Number.parseInt(value, 10);
        if (!Number.isFinite(numeric)) {
          throw new Error(t("cron_invalid"));
        }
        return numeric;
      }

      function validateCronField(fieldSpec, fieldRaw) {
        const field = String(fieldRaw || "").trim();
        if (!field) {
          throw new Error(t("cron_invalid"));
        }

        // Fast path for wildcard forms like "*" and "*/5".
        if (/^\*(\/[1-9]\d*)?$/.test(field)) {
          return;
        }

        const entries = field.split(",").map((item) => item.trim()).filter(Boolean);
        if (!entries.length) {
          throw new Error(t("cron_invalid"));
        }

        for (const entry of entries) {
          const [basePart, stepPart] = entry.split("/");
          if (entry.split("/").length > 2) {
            throw new Error(t("cron_invalid"));
          }
          const base = String(basePart || "").trim();
          const step = stepPart === undefined ? "" : String(stepPart).trim();

          if (step) {
            if (!/^\d+$/.test(step) || Number.parseInt(step, 10) <= 0) {
              throw new Error(t("cron_invalid"));
            }
          }

          if (base === "*") {
            continue;
          }

          if (base.includes("-")) {
            const [startRaw, endRaw] = base.split("-");
            if (base.split("-").length !== 2 || !startRaw || !endRaw) {
              throw new Error(t("cron_invalid"));
            }
            const start = parseCronValue(fieldSpec.name, startRaw);
            const end = parseCronValue(fieldSpec.name, endRaw);
            assertInRange(fieldSpec.name, start, fieldSpec.min, fieldSpec.max);
            assertInRange(fieldSpec.name, end, fieldSpec.min, fieldSpec.max);
            if (start > end) {
              throw new Error(t("cron_invalid"));
            }
            continue;
          }

          const single = parseCronValue(fieldSpec.name, base);
          assertInRange(fieldSpec.name, single, fieldSpec.min, fieldSpec.max);
        }
      }

      parts.forEach((part, index) => {
        validateCronField(fieldSpecs[index], part);
      });

      return parts.join(" ");
    }

    function buildSitePayload() {
      const name = textValue(getFieldValue("siteName")).trim();
      const url = textValue(getFieldValue("siteUrl")).trim();
      if (!name) throw new Error(t("required_field", { field: t("name") }));
      if (!url) throw new Error(t("required_field", { field: t("url") }));
      return {
        name,
        url,
        timeout: parsePositiveInt(getFieldValue("siteTimeout")),
        headers: pairsToMap("siteHeaders"),
        keys: pairsToMap("siteKeys")
      };
    }

    function buildApiPayload() {
      const name = textValue(getFieldValue("apiName")).trim();
      const url = textValue(getFieldValue("apiUrl")).trim();
      const cron = validateCronExpression(getFieldValue("apiCron"));
      if (!name) throw new Error(t("required_field", { field: t("name") }));
      if (!url) throw new Error(t("required_field", { field: t("url") }));
      return {
        name,
        url,
        type: textValue(getFieldValue("apiType")).trim() || "text",
        params: pairsToMap("apiParams"),
        parse: readListRows("apiParseList").join("\n"),
        scope: readListRows("apiScopeList"),
        keywords: readListRows("apiKeywordsList"),
        cron
      };
    }

    function renderSites() {
      document.getElementById("siteCount").textContent = formatItems(state.sites.length);
      const rows = state.sites.map((s, i) => `
        <tr>
          <td>${i + 1}</td>
          <td><code class="name-code">${escapeHtml(s.name || "")}</code></td>
          <td class="url-cell"><div class="url-scroll" title="${escapeHtml(s.url || "")}">${escapeHtml(s.url || "")}</div></td>
          <td>${Number(s.timeout || 60)}</td>
          <td class="actions-cell">
            <label class="switch-toggle table-switch" title="${Boolean(s.enabled) ? t("disable_action") : t("enable_action")}">
              <input
                type="checkbox"
                ${Boolean(s.enabled) ? "checked" : ""}
                onclick='toggleSiteEnabled(this, "${encodeURIComponent(s.name || "")}", this.checked)'
              >
              <span class="switch-slider"></span>
            </label>
            <button onclick="openSiteEditor(${i})">${t("edit")}</button>
            <button class="danger" onclick='removeSite(this, "${encodeURIComponent(s.name || "")}")'>${t("delete")}</button>
          </td>
        </tr>
      `).join("");
      document.getElementById("siteTable").innerHTML = `
        <tr>
          <th>${t("serial_no")}</th>
          <th class="sortable-head" onclick="onSiteHeaderSort('name')">${t("name")}<span class="sort-indicator">${getSortIndicator(sortState.site, SITE_SORT_RULES.name)}</span></th>
          <th class="sortable-head" onclick="onSiteHeaderSort('url')">${t("url")}<span class="sort-indicator">${getSortIndicator(sortState.site, SITE_SORT_RULES.url)}</span></th>
          <th class="sortable-head" onclick="onSiteHeaderSort('timeout')">${t("timeout")}<span class="sort-indicator">${getSortIndicator(sortState.site, SITE_SORT_RULES.timeout)}</span></th>
          <th>${t("actions")}</th>
        </tr>
        ${rows || `<tr><td colspan="5" class="empty-cell">${t("no_data")}</td></tr>`}
      `;
    }

    function renderApis() {
      const filteredApis = filterApis(state.apis, apiSearchText);
      const total = filteredApis.length;
      const useAll = apiPageSize === "all";
      const pageSize = useAll ? Math.max(1, total || 1) : Number(apiPageSize);
      const totalPages = useAll ? 1 : Math.max(1, Math.ceil(total / pageSize));
      apiPage = Math.min(Math.max(1, apiPage), totalPages);
      const start = useAll ? 0 : (apiPage - 1) * pageSize;
      const pageItems = useAll ? filteredApis : filteredApis.slice(start, start + pageSize);

      document.getElementById("apiCount").textContent = formatItems(total);
      renderApiPager(totalPages);

      const rows = pageItems.map((a, i) => `
        <tr>
          <td>${start + i + 1}</td>
          <td><code class="name-code">${escapeHtml(a.name || "")}</code></td>
          <td class="url-cell"><div class="url-scroll" title="${escapeHtml(a.url || "")}">${escapeHtml(a.url || "")}</div></td>
          <td>${formatTypeCell(a.type)}</td>
          <td>
            <span class="status-dot ${Boolean(a.valid) ? "is-valid" : ""}">
              ${boolText(Boolean(a.valid))}
            </span>
          </td>
          <td class="keywords-cell">${formatKeywordsCell(a.keywords)}</td>
          <td class="actions-cell">
            <label class="switch-toggle table-switch" title="${Boolean(a.enabled) ? t("disable_action") : t("enable_action")}">
              <input
                type="checkbox"
                ${Boolean(a.enabled) ? "checked" : ""}
                onclick='toggleApiEnabled(this, "${encodeURIComponent(a.name || "")}", this.checked)'
              >
              <span class="switch-slider"></span>
            </label>
            <button class="warn" onclick='testSingleApi(this, "${encodeURIComponent(a.name || "")}")'>${t("test")}</button>
            <button onclick='openApiEditorByName("${encodeURIComponent(a.name || "")}")'>${t("edit")}</button>
            <button class="danger" onclick='removeApi(this, "${encodeURIComponent(a.name || "")}")'>${t("delete")}</button>
          </td>
        </tr>
      `).join("");
      document.getElementById("apiTable").innerHTML = `
        <tr>
          <th>${t("serial_no")}</th>
          <th class="sortable-head" onclick="onApiHeaderSort('name')">${t("name")}<span class="sort-indicator">${getSortIndicator(sortState.api, API_SORT_RULES.name)}</span></th>
          <th class="sortable-head" onclick="onApiHeaderSort('url')">${t("url")}<span class="sort-indicator">${getSortIndicator(sortState.api, API_SORT_RULES.url)}</span></th>
          <th class="sortable-head" onclick="onApiHeaderSort('type')">${t("type")}<span class="sort-indicator">${getSortIndicator(sortState.api, API_SORT_RULES.type)}</span></th>
          <th class="sortable-head" onclick="onApiHeaderSort('valid')">${t("valid")}<span class="sort-indicator">${getSortIndicator(sortState.api, API_SORT_RULES.valid)}</span></th>
          <th class="sortable-head" onclick="onApiHeaderSort('keywords')">${t("keywords")}<span class="sort-indicator">${getSortIndicator(sortState.api, API_SORT_RULES.keywords)}</span></th>
          <th>${t("actions")}</th>
        </tr>
        ${rows || `<tr><td colspan="7" class="empty-cell">${t("no_data")}</td></tr>`}
      `;
    }

    function renderApiPager(totalPages) {
      const pager = document.getElementById("apiPagerTop");
      if (!pager) return;
      if (totalPages <= 1) {
        const total = filterApis(state.apis, apiSearchText).length;
        const rangeText = total > 0 ? `1-${total} / ${total}` : `0-0 / 0`;
        pager.innerHTML = `<span class="pager-range">${escapeHtml(rangeText)}</span>`;
        return;
      }

      const filtered = filterApis(state.apis, apiSearchText);
      const total = filtered.length;
      const useAll = apiPageSize === "all";
      const pageSize = useAll ? Math.max(1, total || 1) : Number(apiPageSize);
      const start = total === 0 ? 0 : (apiPage - 1) * pageSize + 1;
      const end = Math.min(total, apiPage * pageSize);
      const rangeText = `${start}-${end} / ${total}`;
      const firstDisabled = apiPage <= 1 ? "disabled" : "";
      const prevDisabled = apiPage <= 1 ? "disabled" : "";
      const nextDisabled = apiPage >= totalPages ? "disabled" : "";
      const lastDisabled = apiPage >= totalPages ? "disabled" : "";
      pager.innerHTML = `
        <button type="button" class="pager-icon-btn" title="${escapeHtml(t("page_first"))}" ${firstDisabled} onclick="onApiPageChange(1)">«</button>
        <button type="button" class="pager-icon-btn" title="${escapeHtml(t("page_prev"))}" ${prevDisabled} onclick="onApiPageChange(${apiPage - 1})">‹</button>
        <span class="pager-range">${escapeHtml(rangeText)}</span>
        <button type="button" class="pager-icon-btn" title="${escapeHtml(t("page_next"))}" ${nextDisabled} onclick="onApiPageChange(${apiPage + 1})">›</button>
        <button type="button" class="pager-icon-btn" title="${escapeHtml(t("page_last"))}" ${lastDisabled} onclick="onApiPageChange(${totalPages})">»</button>
      `;
    }

    function filterApis(items, query) {
      const q = textValue(query).trim().toLowerCase();
      if (!q) return Array.isArray(items) ? items : [];
      return (Array.isArray(items) ? items : []).filter((api) => {
        const name = textValue(api?.name).toLowerCase();
        const url = textValue(api?.url).toLowerCase();
        const keywords = Array.isArray(api?.keywords)
          ? api.keywords.map((k) => textValue(k).toLowerCase())
          : [];
        return name.includes(q) || url.includes(q) || keywords.some((k) => k.includes(q));
      });
    }

    function formatKeywordsCell(keywords) {
      if (!Array.isArray(keywords) || keywords.length === 0) {
        return "0";
      }
      const full = keywords
        .map((item) => textValue(item).trim())
        .filter(Boolean)
        .join(", ");
      const safe = escapeHtml(full || "0");
      return `<div class="keywords-scroll" title="${safe}">${safe}</div>`;
    }

    function formatTypeCell(type) {
      const raw = textValue(type).trim().toLowerCase() || "text";
      const typeMap = {
        text: { symbol: "T", label: "text" },
        image: { symbol: "I", label: "image" },
        video: { symbol: "V", label: "video" },
        audio: { symbol: "A", label: "audio" }
      };
      const meta = typeMap[raw] || { symbol: "?", label: raw || "unknown" };
      return `
        <span class="type-chip type-${escapeHtml(raw)}" title="${escapeHtml(meta.label)}">
          <span class="type-chip-symbol">${escapeHtml(meta.symbol)}</span>
          <span>${escapeHtml(meta.label)}</span>
        </span>
      `;
    }

    function formatLocalType(type) {
      return formatTypeCell(type);
    }

    function getSortedLocalCollections(items) {
      const data = Array.isArray(items) ? [...items] : [];
      const rule = textValue(sortState.local).toLowerCase();
      const byName = (x) => textValue(x?.name).toLowerCase();
      const byType = (x) => textValue(x?.type).toLowerCase();
      const byCount = (x) => Number(x?.count || 0);
      const bySize = (x) => Number(x?.size_bytes || 0);
      const byUpdated = (x) => Number(x?.updated_at || 0);

      if (rule === "name_desc") return data.sort((a, b) => byName(b).localeCompare(byName(a)));
      if (rule === "type_asc") return data.sort((a, b) => byType(a).localeCompare(byType(b)) || byName(a).localeCompare(byName(b)));
      if (rule === "type_desc") return data.sort((a, b) => byType(b).localeCompare(byType(a)) || byName(a).localeCompare(byName(b)));
      if (rule === "count_asc") return data.sort((a, b) => byCount(a) - byCount(b) || byName(a).localeCompare(byName(b)));
      if (rule === "count_desc") return data.sort((a, b) => byCount(b) - byCount(a) || byName(a).localeCompare(byName(b)));
      if (rule === "size_asc") return data.sort((a, b) => bySize(a) - bySize(b) || byName(a).localeCompare(byName(b)));
      if (rule === "size_desc") return data.sort((a, b) => bySize(b) - bySize(a) || byName(a).localeCompare(byName(b)));
      if (rule === "updated_asc") return data.sort((a, b) => byUpdated(a) - byUpdated(b) || byName(a).localeCompare(byName(b)));
      if (rule === "updated_desc") return data.sort((a, b) => byUpdated(b) - byUpdated(a) || byName(a).localeCompare(byName(b)));
      return data.sort((a, b) => byName(a).localeCompare(byName(b)));
    }

    function renderLocalData() {
      const countNode = document.getElementById("localDataCount");
      if (countNode) {
        countNode.textContent = formatItems(localCollections.length);
      }
      const table = document.getElementById("localDataTable");
      if (!table) return;

      const sorted = getSortedLocalCollections(localCollections);
      const rows = sorted.map((item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td><code class="name-code">${escapeHtml(textValue(item.name))}</code></td>
          <td>${formatLocalType(item.type)}</td>
          <td>${Number(item.count || 0)}</td>
          <td>${escapeHtml(formatBytes(item.size_bytes))}</td>
          <td>${escapeHtml(formatTimestamp(item.updated_at))}</td>
          <td class="actions-cell">
            <button onclick='openLocalDataViewer(this, "${encodeURIComponent(textValue(item.type))}", "${encodeURIComponent(textValue(item.name))}")'>${t("view")}</button>
            <button class="danger" onclick='removeLocalCollection(this, "${encodeURIComponent(textValue(item.type))}", "${encodeURIComponent(textValue(item.name))}")'>${t("delete")}</button>
          </td>
        </tr>
      `).join("");

      table.innerHTML = `
        <tr>
          <th>${t("serial_no")}</th>
          <th class="sortable-head" onclick="onLocalHeaderSort('name')">${t("name")}<span class="sort-indicator">${getSortIndicator(sortState.local, LOCAL_SORT_RULES.name)}</span></th>
          <th class="sortable-head" onclick="onLocalHeaderSort('type')">${t("type")}<span class="sort-indicator">${getSortIndicator(sortState.local, LOCAL_SORT_RULES.type)}</span></th>
          <th class="sortable-head" onclick="onLocalHeaderSort('count')">${t("items_count_short")}<span class="sort-indicator">${getSortIndicator(sortState.local, LOCAL_SORT_RULES.count)}</span></th>
          <th class="sortable-head" onclick="onLocalHeaderSort('size')">${t("size")}<span class="sort-indicator">${getSortIndicator(sortState.local, LOCAL_SORT_RULES.size)}</span></th>
          <th class="sortable-head" onclick="onLocalHeaderSort('updated')">${t("updated_at")}<span class="sort-indicator">${getSortIndicator(sortState.local, LOCAL_SORT_RULES.updated)}</span></th>
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
      localViewerState.pendingDeletes = new Set();
      updateLocalDeleteConfirmButton();
    }

    function getPendingDeleteSet() {
      if (!(localViewerState.pendingDeletes instanceof Set)) {
        localViewerState.pendingDeletes = new Set();
      }
      return localViewerState.pendingDeletes;
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
      btn.textContent = pendingCount > 0
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
        width = n <= 2 ? "min(760px, 96vw)" : n <= 6 ? "min(980px, 96vw)" : "min(1120px, 98vw)";
      } else if (isAudio) {
        width = n <= 4 ? "min(900px, 96vw)" : "min(1020px, 98vw)";
      } else {
        width = n <= 6 ? "min(760px, 94vw)" : n <= 20 ? "min(900px, 96vw)" : "min(1020px, 98vw)";
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
      hint.textContent = `${t("items_count", { count: items.length })} · ${formatBytes(detail?.size_bytes || 0)}`;
      tuneLocalDataModalLayout(type, items.length);
      updateLocalDeleteConfirmButton();

      if (items.length === 0) {
        list.innerHTML = `<div class="empty-cell">${t("no_data")}</div>`;
        return;
      }

      if (type === "text") {
        list.innerHTML = `
          <div class="local-list-compact">
            ${items.map((item) => {
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
                    onclick='removeLocalItem(this, "${encodeURIComponent(type)}", "${encodeURIComponent(textValue(detail.name))}", ${itemIndex}, "")'
                  >×</button>
                  <div class="local-row-main">
                    <span class="local-row-index">${itemIndex + 1}</span>
                    <span class="local-row-text" title="${escapeHtml(text)}">${escapeHtml(text)}</span>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        `;
        return;
      }

      if (type === "audio") {
        list.innerHTML = `
          <div class="local-list-compact">
            ${items.map((item) => {
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
                    onclick='removeLocalItem(this, "${encodeURIComponent(type)}", "${encodeURIComponent(textValue(detail.name))}", -1, "${encodeURIComponent(path)}")'
                  >×</button>
                  <div class="local-row-main">
                    <span class="local-row-label">${escapeHtml(textValue(item?.name))}</span>
                    <audio class="local-audio-inline" src="${escapeHtml(fileUrl)}" controls preload="metadata"></audio>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        `;
        return;
      }

      list.innerHTML = `
        <div class="local-media-grid">
          ${items.map((item) => {
            const path = textValue(item?.path);
            const pendingKey = makePendingDeleteKey(type, -1, path);
            const isPending = pendingDeletes.has(pendingKey);
            const fileUrl = `/api/local-file?path=${encodeURIComponent(path)}`;
            const media = type === "image"
              ? `<img class="test-saved-media test-saved-image" src="${escapeHtml(fileUrl)}" alt="saved image">`
              : `<video class="test-saved-media" src="${escapeHtml(fileUrl)}" controls preload="metadata"></video>`;
            return `
              <div class="local-media-card ${isPending ? "is-pending-delete" : ""}">
                <button
                  class="local-close-btn ${isPending ? "is-pending-delete" : ""}"
                  title="${escapeHtml(t("delete"))}"
                  aria-label="${escapeHtml(t("delete"))}"
                  onclick='removeLocalItem(this, "${encodeURIComponent(type)}", "${encodeURIComponent(textValue(detail.name))}", -1, "${encodeURIComponent(path)}")'
                >×</button>
                <div class="local-item-meta">${escapeHtml(textValue(item?.name))}</div>
                ${media}
              </div>
            `;
          }).join("")}
        </div>
      `;
    }

    function render() {
      renderSites();
      renderApis();
      renderLocalData();
    }

    function siteTemplate() {
      return {
        name: "my_site",
        url: "https://example.com",
        enabled: true,
        headers: {},
        keys: {},
        timeout: 60
      };
    }

    function apiTemplate() {
      return {
        name: "my_api",
        url: "https://example.com/api",
        type: "text",
        params: {},
        parse: "",
        enabled: true,
        scope: [],
        keywords: ["my_api"],
        cron: "",
        valid: true
      };
    }

    async function openEditor(kind, data = null) {
      try {
        editorState.kind = kind;
        editorState.originalName = data?.name || "";
        const action = data ? t("edit") : t("add");
        const target = kind === "site" ? t("site_upper") : t("api_upper");
        const source = data || (kind === "site" ? siteTemplate() : apiTemplate());
        document.getElementById("editorTitle").textContent = t("editor_title", { action, target });
        const form = document.getElementById("editorForm");
        form.innerHTML = await loadEditorTemplate(kind);
        bindEditorAddTriggers(form);
        if (kind === "site") {
          fillSiteForm(source);
        } else {
          fillApiForm(source);
        }
        const testBtn = document.getElementById("btnTestEditor");
        if (testBtn) {
          testBtn.style.display = kind === "api" ? "inline-flex" : "none";
        }
        refreshEditorI18n();
        document.getElementById("editorModal").classList.add("open");
      } catch (err) {
        alert(err.message || String(err));
      }
    }

    function openSiteEditor(index) {
      openEditor("site", state.sites[index] || null);
    }

    function openApiEditor(index) {
      openEditor("api", state.apis[index] || null);
    }

    function openApiEditorByName(name) {
      const decoded = decodeURIComponent(name || "");
      const target = state.apis.find((api) => textValue(api?.name) === decoded) || null;
      openEditor("api", target);
    }

    function closeEditor() {
      document.getElementById("editorModal").classList.remove("open");
    }

    async function saveEditor() {
      try {
        const kind = editorState.kind;
        const oldName = editorState.originalName;
        const payload = kind === "site" ? buildSitePayload() : buildApiPayload();
        if (kind === "site") {
          if (oldName) {
            await req(`/api/site/${encodeURIComponent(oldName)}`, {
              method: "PUT",
              body: JSON.stringify(payload)
            });
          } else {
            await req("/api/site", { method: "POST", body: JSON.stringify(payload) });
          }
        } else if (kind === "api") {
          if (oldName) {
            await req(`/api/api/${encodeURIComponent(oldName)}`, {
              method: "PUT",
              body: JSON.stringify(payload)
            });
          } else {
            await req("/api/api", { method: "POST", body: JSON.stringify(payload) });
          }
        }
        closeEditor();
        await loadPool();
      } catch (err) {
        alert(err.message || String(err));
      }
    }

    async function testEditorApi(btn) {
      await withButtonLoading(btn, async () => {
        const payload = buildApiPayload();
        await testEditorPayloadAndRender(payload);
      });
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
      const raw = Number.parseInt(textValue(input?.value || "5"), 10);
      if (!Number.isFinite(raw) || raw < 1) {
        throw new Error(t("test_repeat_invalid_times"));
      }
      return raw;
    }

    function refreshSingleRepeatButtonLabel() {
      const btn = document.getElementById("btnSingleTestRepeat");
      if (!btn) return;
      btn.textContent = singleRepeatRunning ? t("test_repeat_stop") : t("test_repeat_start");
      refreshSingleRepeatPauseButton();
    }

    function refreshSingleRepeatPauseButton() {
      const btn = document.getElementById("btnSingleTestPause");
      if (!btn) return;
      btn.classList.toggle("is-visible", Boolean(singleRepeatRunning));
      btn.disabled = !singleRepeatRunning;
      btn.textContent = singleRepeatPaused ? t("test_repeat_resume") : t("test_repeat_pause");
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
      if (!singleRepeatRunning) {
        return;
      }
      singleRepeatPaused = !singleRepeatPaused;
      if (singleRepeatPaused) {
        updateTestSummary(t("test_repeat_paused"));
      } else {
        updateTestSummary(t("test_running"));
      }
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
      messageNode.textContent = t("test_repeat_duplicate_prompt", { name: textValue(name) || "-" });
      modal.classList.add("open");
      return await new Promise((resolve) => {
        duplicateChoiceResolver = resolve;
      });
    }

    async function runSinglePreviewOnce(payload, options = {}) {
      const detail = await req("/api/test/preview", {
        method: "POST",
        body: JSON.stringify(payload)
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
        saved_file_url: detail.saved_file_url || ""
      });
      return detail;
    }

    async function testEditorPayloadAndRender(payload) {
      stopSingleRepeat();
      const singleTask = createRunningTask("single_once", t("test_single_title"), {
        completed: 0,
        total: 1,
        success: 0,
        fail: 0
      });
      openTestModal("test_single_title", { singleMode: true, payload, taskId: singleTask.id });
      updateTestSummary(t("test_running"));
      updateTestProgress(0, 1);
      try {
        const detail = await runSinglePreviewOnce(payload);
        patchRunningTask(singleTask.id, {
          completed: 1,
          success: Boolean(detail.valid) ? 1 : 0,
          fail: Boolean(detail.valid) ? 0 : 1
        });
        updateTestProgress(1, 1);
        updateTestSummary(
          t("test_done_summary", {
            success: Boolean(detail.valid) ? 1 : 0,
            fail: Boolean(detail.valid) ? 0 : 1
          })
        );
        finishRunningTask(singleTask.id);
      } catch (err) {
        finishRunningTask(singleTask.id, { summary: String(err?.message || err) });
        updateTestSummary(`${t("test_failed")}: ${err.message || String(err)}`);
        throw err;
      }
    }

    async function removeSite(btn, name) {
      await withButtonLoading(btn, async () => {
        try {
          const decoded = decodeURIComponent(name);
          const backup = state.sites.find((item) => textValue(item?.name) === decoded) || null;
          await req(`/api/site/${encodeURIComponent(decoded)}`, { method: "DELETE" });
          await loadPool();
          if (backup) {
            showUndoNotice("site", backup);
          }
        } catch (err) {
          alert(err.message || String(err));
        }
      });
    }

    async function removeApi(btn, name) {
      await withButtonLoading(btn, async () => {
        try {
          const decoded = decodeURIComponent(name);
          const backup = state.apis.find((item) => textValue(item?.name) === decoded) || null;
          await req(`/api/api/${encodeURIComponent(decoded)}`, { method: "DELETE" });
          await loadPool();
          if (backup) {
            showUndoNotice("api", backup);
          }
        } catch (err) {
          alert(err.message || String(err));
        }
      });
    }

    async function loadLocalData() {
      try {
        const data = await req("/api/local-data");
        localCollections = Array.isArray(data?.collections) ? data.collections : [];
        renderLocalData();
      } catch (err) {
        alert(err.message || String(err));
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
          const detail = await req(`/api/local-data/${encodeURIComponent(decodedType)}/${encodeURIComponent(decodedName)}`);
          localViewerState = {
            type: decodedType,
            name: decodedName,
            detail,
            pendingDeletes: new Set()
          };
          document.getElementById("localDataModalTitle").textContent = `${decodedName} (${decodedType})`;
          renderLocalDataItems(detail);
          const modal = document.getElementById("localDataModal");
          if (modal) {
            modal.classList.add("open");
          }
        } catch (err) {
          alert(err.message || String(err));
        }
      });
    }

    async function removeLocalCollection(btn, type, name) {
      await withButtonLoading(btn, async () => {
        try {
          const decodedType = decodeURIComponent(type || "");
          const decodedName = decodeURIComponent(name || "");
          await req(`/api/local-data/${encodeURIComponent(decodedType)}/${encodeURIComponent(decodedName)}`, {
            method: "DELETE"
          });
          if (
            textValue(localViewerState.type) === decodedType &&
            textValue(localViewerState.name) === decodedName
          ) {
            closeLocalDataModal();
          }
          await loadLocalData();
        } catch (err) {
          alert(err.message || String(err));
        }
      });
    }

    function removeLocalItem(_, type, __, index, path) {
      const decodedType = decodeURIComponent(type || "");
      const decodedPath = path ? decodeURIComponent(path || "") : "";
      const pendingKey = makePendingDeleteKey(decodedType, Number(index), decodedPath);
      const pendingDeletes = getPendingDeleteSet();
      if (pendingDeletes.has(pendingKey)) {
        pendingDeletes.delete(pendingKey);
      } else {
        pendingDeletes.add(pendingKey);
      }
      renderLocalDataItems(localViewerState.detail || {});
    }

    async function onConfirmLocalDataDeleteClick(btn) {
      await withButtonLoading(btn, async () => {
        try {
          const decodedType = textValue(localViewerState.type);
          const decodedName = textValue(localViewerState.name);
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
              items
            })
          });

          const detail = await req(`/api/local-data/${encodeURIComponent(decodedType)}/${encodeURIComponent(decodedName)}`);
          localViewerState.detail = detail;
          localViewerState.pendingDeletes = new Set();
          renderLocalDataItems(detail);
          await loadLocalData();
        } catch (err) {
          const msg = textValue(err?.message);
          if (msg.includes("not found")) {
            closeLocalDataModal();
            await loadLocalData();
            return;
          }
          alert(msg || String(err));
        }
      });
    }

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
          await loadPool();
        });
      } catch (err) {
        alert(err.message || String(err));
      }
    }

    async function toggleSiteEnabled(btn, name, nextEnabled) {
      await withButtonLoading(btn, async () => {
        try {
          const decoded = decodeURIComponent(name);
          await req(`/api/site/${encodeURIComponent(decoded)}`, {
            method: "PUT",
            body: JSON.stringify({ enabled: Boolean(nextEnabled) })
          });
          await loadPool();
        } catch (err) {
          alert(err.message || String(err));
        }
      });
    }

    async function toggleApiEnabled(btn, name, nextEnabled) {
      await withButtonLoading(btn, async () => {
        try {
          const decoded = decodeURIComponent(name);
          await req(`/api/api/${encodeURIComponent(decoded)}`, {
            method: "PUT",
            body: JSON.stringify({ enabled: Boolean(nextEnabled) })
          });
          await loadPool();
        } catch (err) {
          alert(err.message || String(err));
        }
      });
    }

    async function testSingleApi(btn, name) {
      await withButtonLoading(btn, async () => {
        try {
          const decoded = decodeURIComponent(name);
          const payload = state.apis.find((api) => textValue(api.name) === decoded);
          if (!payload) {
            throw new Error(t("api_not_found"));
          }
          await testEditorPayloadAndRender(payload);
          await loadPool();
        } catch (err) {
          alert(err.message || String(err));
        }
      });
    }

    function openTestModal(titleKey = "test_all_title", options = {}) {
      const modal = document.getElementById("testModal");
      const log = document.getElementById("testLog");
      const summary = document.getElementById("testSummary");
      const progress = document.getElementById("testProgressFill");
      const title = document.getElementById("testModalTitle");
      activeTestTaskId = textValue(options.taskId).trim();
      if (log) log.innerHTML = "";
      if (summary) summary.textContent = t("test_waiting");
      if (progress) progress.style.width = "0%";
      if (title) title.textContent = t(titleKey);
      updateTestStats(activeTestTaskId ? getRunningTask(activeTestTaskId) : null);
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
        return;
      }
    }

    async function onToggleSingleRepeatClick(btn) {
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
        alert(err.message || String(err));
        return;
      }

      const repeatTask = createRunningTask("single_repeat", t("test_single_title"), {
        completed: 0,
        total: repeatTimes,
        success: 0,
        fail: 0,
        summary: t("test_running")
      });
      singleRepeatTaskId = repeatTask.id;
      activeTestTaskId = repeatTask.id;
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
          if (!singleRepeatRunning) {
            break;
          }
          singleRepeatCount += 1;
          updateTestSummary(t("test_running"));
          const detail = await runSinglePreviewOnce(singleRepeatPayload, { repeatRound: singleRepeatCount });
          const nextSuccess = Number(repeatTask.success || 0) + (Boolean(detail.valid) ? 1 : 0);
          const nextFail = Number(repeatTask.fail || 0) + (Boolean(detail.valid) ? 0 : 1);
          patchRunningTask(repeatTask.id, {
            completed: singleRepeatCount,
            success: nextSuccess,
            fail: nextFail,
            summary: t("test_running")
          });
          updateTestProgress(singleRepeatCount, repeatTimes);
          updateTestSummary(
            t("test_done_summary", {
              success: Boolean(detail.valid) ? 1 : 0,
              fail: Boolean(detail.valid) ? 0 : 1
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
        if (!singleRepeatRunning) {
          break;
        }
        if (singleRepeatCount >= repeatTimes) {
          break;
        }
        updateTestSummary(
          t("test_repeat_waiting", {
            count: singleRepeatCount,
            seconds: intervalSeconds
          })
        );
        await waitSingleRepeatInterval(intervalSeconds * 1000);
      }
      finishRunningTask(repeatTask.id, {
        completed: singleRepeatCount,
        summary: singleRepeatCount >= repeatTimes ? t("test_done_summary", { success: repeatTask.success || 0, fail: repeatTask.fail || 0 }) : t("test_aborted")
      });
      updateTestProgress(singleRepeatCount, repeatTimes);
      singleRepeatRunning = false;
      singleRepeatPaused = false;
      singleRepeatTaskId = "";
      refreshSingleRepeatButtonLabel();
    }

    function updateTestProgress(completed, total) {
      const safeTotal = Math.max(0, Number(total || 0));
      const safeCompleted = Math.max(0, Number(completed || 0));
      const percent = safeTotal > 0 ? Math.min(100, Math.round((safeCompleted / safeTotal) * 100)) : 0;
      const progress = document.getElementById("testProgressFill");
      if (progress) progress.style.width = `${percent}%`;
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

    function updateTestSummary(text) {
      const summary = document.getElementById("testSummary");
      if (summary) {
        summary.textContent = text;
      }
    }

    function applyApiValidity(name, valid) {
      const targetName = textValue(name).trim();
      if (!targetName || !Array.isArray(state.apis)) return false;
      let changed = false;
      state.apis = state.apis.map((api) => {
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
      return changed;
    }

    function applyApiValidityBatch(names, valid) {
      const nameSet = new Set(normalizeList(names));
      if (!nameSet.size || !Array.isArray(state.apis)) return false;
      let changed = false;
      const nextValid = Boolean(valid);
      state.apis = state.apis.map((api) => {
        if (!nameSet.has(textValue(api?.name))) {
          return api;
        }
        if (Boolean(api?.valid) === nextValid) {
          return api;
        }
        changed = true;
        return { ...api, valid: nextValid };
      });
      return changed;
    }

    async function testApisStream(names = [], task = null) {
      const isSingle = Array.isArray(names) && names.length === 1;
      const streamTask = task || createRunningTask(
        "batch",
        isSingle ? t("test_single_title") : t("test_all_title"),
        { completed: 0, total: 0, success: 0, fail: 0 }
      );
      openTestModal(isSingle ? "test_single_title" : "test_all_title", { taskId: streamTask.id });
      updateTestSummary(t("test_running"));
      testRunning = true;
      testStreamAbort = new AbortController();
      patchRunningTask(streamTask.id, { summary: t("test_running") });
      try {
        const params = new URLSearchParams();
        if (Array.isArray(names)) {
          names.forEach((name) => {
            if (name) params.append("name", String(name));
          });
        }
        const streamUrl = params.size ? `/api/test/stream?${params.toString()}` : "/api/test/stream";
        const resp = await fetch(streamUrl, {
          method: "GET",
          cache: "no-store",
          signal: testStreamAbort.signal
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
                summary: t("test_started", { total: item.total || 0 })
              });
              return;
            }
            if (item.event === "progress") {
              updateTestProgress(item.completed || 0, item.total || 0);
              appendTestLog(item);
              if (applyApiValidity(item.name, item.valid)) {
                renderApis();
              }
              updateTestSummary(t("test_progress_summary", {
                completed: item.completed || 0,
                total: item.total || 0
              }));
              patchRunningTask(streamTask.id, {
                completed: item.completed || 0,
                total: item.total || 0,
                success: Math.max(0, Number(item.completed || 0) - Number(item.fail_count || 0)),
                fail: Number(item.fail_count || 0),
                summary: t("test_progress_summary", {
                  completed: item.completed || 0,
                  total: item.total || 0
                })
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
              updateTestSummary(t("test_done_summary", {
                success: item.success_count || 0,
                fail: item.fail_count || 0
              }));
              finishRunningTask(streamTask.id, {
                completed: item.completed || item.total || 0,
                total: item.total || 0,
                success: item.success_count || 0,
                fail: item.fail_count || 0,
                summary: t("test_done_summary", {
                  success: item.success_count || 0,
                  fail: item.fail_count || 0
                })
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
        finishRunningTask(streamTask.id, { summary: `${t("test_failed")}: ${err.message || String(err)}` });
        throw err;
      } finally {
        testRunning = false;
        testStreamAbort = null;
      }

      await loadPool();
    }

    async function onTestAllClick(btn) {
      await withButtonLoading(btn, async () => {
        await testApisStream([], createRunningTask("batch", t("test_all_title")));
      });
    }

    async function onRestartAppClick(btn) {
      const restartIconBtn = btn || document.getElementById("restartIconBtn");
      openRestartModal();
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
          await req("/api/system/restart", { method: "POST" });
          await loadPool();
          const elapsed = Date.now() - startedAt;
          if (elapsed < RESTART_MIN_ANIMATION_MS) {
            await new Promise((resolve) =>
              setTimeout(resolve, RESTART_MIN_ANIMATION_MS - elapsed)
            );
          }
          setRestartModalStatus(t("restart_modal_status_success"), "success");
          setRestartProgressState("success");
          if (modal) {
            modal.dataset.running = "0";
          }
          restartAutoCloseTimer = setTimeout(() => {
            closeRestartModal(true);
          }, 700);
        } catch (err) {
          const elapsed = Date.now() - startedAt;
          if (elapsed < RESTART_MIN_ANIMATION_MS) {
            await new Promise((resolve) =>
              setTimeout(resolve, RESTART_MIN_ANIMATION_MS - elapsed)
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

    async function onSaveClick(btn) {
      await withButtonLoading(btn, async () => {
        await saveEditor();
      });
    }

    async function onEditorTestClick(btn) {
      if (editorState.kind !== "api") {
        return;
      }
      try {
        await testEditorApi(btn);
      } catch (err) {
        alert(err.message || String(err));
      }
    }

    async function loadPool() {
      try {
        const params = new URLSearchParams({
          site_sort: sortState.site,
          api_sort: sortState.api
        });
        const [data, localData] = await Promise.all([
          req(`/api/pool/sorted?${params.toString()}`),
          req("/api/local-data")
        ]);
        state = {
          sites: Array.isArray(data.sites) ? data.sites : [],
          apis: Array.isArray(data.apis) ? data.apis : []
        };
        localCollections = Array.isArray(localData?.collections) ? localData.collections : [];
        render();
      } catch (err) {
        alert(err.message || String(err));
      }
    }

    window.addEventListener("resize", () => {
      document.querySelectorAll(".list-collection[id]").forEach((node) => {
        applyListLayout(node.id);
      });
    });

    setTheme(currentTheme);
    setLanguage(currentLang);
    switchMainTab(mainTab);
    persistSortState();
    loadPool();

