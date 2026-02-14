if (typeof I18N === "undefined") {
  throw new Error("i18n resource not loaded");
}

let currentLang = PageHelpers.getDefaultLang(I18N);
let currentTheme = PageHelpers.getDefaultTheme();
let sortState = PageHelpers.getDefaultSortState();
let siteSearchText = "";
let apiSearchText = "";
let localSearchText = "";
let sitePage = 1;
let apiPage = 1;
let localPage = 1;
let sitePageSize = PageHelpers.getDefaultPageSize("api_aggregator_page_size_site");
let apiPageSize = PageHelpers.getDefaultPageSize("api_aggregator_page_size_api");
let localPageSize = PageHelpers.getDefaultPageSize("api_aggregator_page_size_local");
let mainTab = PageHelpers.getDefaultMainTab();
let state = { sites: [], apis: [] };
let localCollections = [];
let editorState = { kind: "", originalName: "" };
let localViewerState = { type: "", name: "", detail: null, pendingDeletes: new Set() };
const RESTART_MIN_ANIMATION_MS = 900;
let activeTestTaskId = "";
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
  const nextLabel = currentLang === "zh" ? "English" : "Chinese";
  const title = `${t("language_label")}: ${currentLang === "zh" ? "Chinese" : "English"} (-> ${nextLabel})`;
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

const noticeManager = createNoticeManager({ t, textValue });
const restartManager = createRestartManager({
  t,
  req,
  withButtonLoading,
  loadPool,
  minAnimationMs: RESTART_MIN_ANIMATION_MS,
});
const updateManager = createUpdateManager({
  t,
  req,
  withButtonLoading,
  textValue,
});
const runningTasksManager = createRunningTasksManager({
  t,
  escapeHtml,
  getActiveTestTaskId: () => activeTestTaskId,
});
const testManager = createTestManager({
  t,
  textValue,
  escapeHtml,
  normalizeList,
  setActiveTestTaskId: (taskId) => {
    activeTestTaskId = taskId;
  },
  getRunningTask,
  updateTestStats,
  createRunningTask,
  patchRunningTask,
  finishRunningTask,
  getApis: () => state.apis,
  setApis: (apis) => {
    state.apis = apis;
  },
  renderApis,
  loadPool,
  withButtonLoading,
  req,
  showNoticeModal,
});
const editorManager = createEditorManager({
  t,
  req,
  withButtonLoading,
  textValue,
  normalizeList,
  stringToLineList,
  mapToPairs,
  renderPairRows,
  renderListRows,
  pairsToMap,
  readListRows,
  refreshEditorI18n,
  bindEditorAddTriggers,
  loadPool,
  showNoticeModal,
  testEditorPayloadAndRender,
  setEditorState: (nextState) => {
    editorState = { ...editorState, ...nextState };
  },
  getEditorState: () => editorState,
  getSiteTemplate: siteTemplate,
  getApiTemplate: apiTemplate,
});
const localDataManager = createLocalDataManager({
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
  getLocalCollections: () => localCollections,
  setLocalCollections: (collections) => {
    localCollections = Array.isArray(collections) ? collections : [];
  },
  getLocalSearchText: () => localSearchText,
  getLocalPage: () => localPage,
  setLocalPage: (page) => {
    localPage = page;
  },
  getLocalPageSize: () => localPageSize,
  getSortState: () => sortState,
  localSortRules: LOCAL_SORT_RULES,
  getLocalViewerState: () => localViewerState,
  setLocalViewerState: (nextState) => {
    localViewerState = nextState || { type: "", name: "", detail: null, pendingDeletes: new Set() };
  },
});
const poolActionsManager = createPoolActionsManager({
  t,
  req,
  withButtonLoading,
  textValue,
  showNoticeModal,
  loadPool,
  getSites: () => state.sites,
  getApis: () => state.apis,
  testEditorPayloadAndRender,
});
const uiStateManager = createUiStateManager({
  textValue,
  siteSortRules: SITE_SORT_RULES,
  apiSortRules: API_SORT_RULES,
  localSortRules: LOCAL_SORT_RULES,
  getSortState: () => sortState,
  setSortState: (nextState) => {
    sortState = nextState;
  },
  getSitePage: () => sitePage,
  setSitePage: (page) => {
    sitePage = page;
  },
  getApiPage: () => apiPage,
  setApiPage: (page) => {
    apiPage = page;
  },
  getLocalPage: () => localPage,
  setLocalPage: (page) => {
    localPage = page;
  },
  getSiteSearchText: () => siteSearchText,
  setSiteSearchText: (text) => {
    siteSearchText = text;
  },
  getApiSearchText: () => apiSearchText,
  setApiSearchText: (text) => {
    apiSearchText = text;
  },
  getLocalSearchText: () => localSearchText,
  setLocalSearchText: (text) => {
    localSearchText = text;
  },
  getSitePageSize: () => sitePageSize,
  setSitePageSize: (size) => {
    sitePageSize = size;
  },
  getApiPageSize: () => apiPageSize,
  setApiPageSize: (size) => {
    apiPageSize = size;
  },
  getLocalPageSize: () => localPageSize,
  setLocalPageSize: (size) => {
    localPageSize = size;
  },
  getMainTab: () => mainTab,
  setMainTab: (tab) => {
    mainTab = tab;
  },
  loadPool,
  renderSites,
  renderApis,
  renderLocalData,
});

function updateRestartButtonState(btn = document.getElementById("restartIconBtn")) {
  restartManager.updateButtonState(btn);
}

function updateUpdateButtonState(btn = document.getElementById("updateIconBtn")) {
  updateManager.updateButtonState(btn);
}

function closeRestartModal(force = false) {
  restartManager.closeModal(force);
}

function closeUpdateModal(force = false) {
  updateManager.closeModal(force);
}

function showNoticeModal(message, tone = "error") {
  noticeManager.show(message, tone);
}

function closeNoticeModal() {
  noticeManager.close();
}

function persistSortState() {
  uiStateManager.persistSortState();
}

function onSiteSortChange(rule) {
  uiStateManager.onSiteSortChange(rule);
}

function onApiSortChange(rule) {
  uiStateManager.onApiSortChange(rule);
}

function onLocalSortChange(rule) {
  uiStateManager.onLocalSortChange(rule);
}

function onSiteHeaderSort(field) {
  uiStateManager.onSiteHeaderSort(field);
}

function onApiHeaderSort(field) {
  uiStateManager.onApiHeaderSort(field);
}

function onLocalHeaderSort(field) {
  uiStateManager.onLocalHeaderSort(field);
}

function onSiteSearchChange(value) {
  uiStateManager.onSiteSearchChange(value);
}

function onApiSearchChange(value) {
  uiStateManager.onApiSearchChange(value);
}

function onLocalSearchChange(value) {
  uiStateManager.onLocalSearchChange(value);
}

function onSitePageChange(page) {
  uiStateManager.onSitePageChange(page);
}

function onApiPageChange(page) {
  uiStateManager.onApiPageChange(page);
}

function onLocalPageChange(page) {
  uiStateManager.onLocalPageChange(page);
}

function onSitePageSizeChange(value) {
  uiStateManager.onSitePageSizeChange(value);
}

function onApiPageSizeChange(value) {
  uiStateManager.onApiPageSizeChange(value);
}

function onLocalPageSizeChange(value) {
  uiStateManager.onLocalPageSizeChange(value);
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
  const updateBtn = document.getElementById("updateIconBtn");
  if (updateBtn) {
    updateUpdateButtonState(updateBtn);
  }
  updateLanguageIcon();
  updateThemeIcon();
  const siteSearch = document.getElementById("siteSearch");
  if (siteSearch) {
    siteSearch.placeholder = t("site_search_placeholder");
  }
  const apiSearch = document.getElementById("apiSearch");
  if (apiSearch) {
    apiSearch.placeholder = t("api_search_placeholder");
  }
  const localSearch = document.getElementById("localSearch");
  if (localSearch) {
    localSearch.placeholder = t("local_search_placeholder");
  }
  const sitePageSizePicker = document.getElementById("sitePageSize");
  if (sitePageSizePicker) {
    sitePageSizePicker.value = String(sitePageSize);
  }
  const apiPageSizePicker = document.getElementById("apiPageSize");
  if (apiPageSizePicker) {
    apiPageSizePicker.value = String(apiPageSize);
  }
  const localPageSizePicker = document.getElementById("localPageSize");
  if (localPageSizePicker) {
    localPageSizePicker.value = String(localPageSize);
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
  document.getElementById("btnUpdateConfirm").textContent = t("update_confirm_button");
  document.getElementById("btnUpdateCancel").textContent = t("cancel");
  document.getElementById("btnUpdateClose").textContent = t("close");
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
  uiStateManager.switchMainTab(tab);
}

function buildTestStatsText(stats) {
  return runningTasksManager.buildTestStatsText(stats);
}

function updateTestStats(stats = null) {
  runningTasksManager.updateTestStats(stats);
}

function createRunningTask(kind, title, extra = {}) {
  return runningTasksManager.createRunningTask(kind, title, extra);
}

function getRunningTask(taskId) {
  return runningTasksManager.getRunningTask(taskId);
}

function patchRunningTask(taskId, patch = {}) {
  return runningTasksManager.patchRunningTask(taskId, patch);
}

function finishRunningTask(taskId, patch = {}) {
  runningTasksManager.finishRunningTask(taskId, patch);
}

function renderRunningTasks() {
  runningTasksManager.renderRunningTasks();
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

const editorFormManager = createEditorFormManager({ t, textValue, escapeHtml });

function renderPairRows(containerId, pairs) {
  editorFormManager.renderPairRows(containerId, pairs);
}

function readPairRows(containerId) {
  return editorFormManager.readPairRows(containerId);
}

function addPairRow(containerId) {
  editorFormManager.addPairRow(containerId);
}

function removePairRow(containerId, index) {
  editorFormManager.removePairRow(containerId, index);
}

function pairsToMap(containerId) {
  return editorFormManager.pairsToMap(containerId);
}

function renderListRows(containerId, items) {
  editorFormManager.renderListRows(containerId, items);
}

function readListRows(containerId, keepEmpty = false) {
  return editorFormManager.readListRows(containerId, keepEmpty);
}

function addListRow(containerId) {
  editorFormManager.addListRow(containerId);
}

function removeListRow(containerId, index) {
  editorFormManager.removeListRow(containerId, index);
}

function applyListLayout(containerId) {
  editorFormManager.applyListLayout(containerId);
}

function onListInputChange(containerId) {
  editorFormManager.onListInputChange(containerId);
}

window.addListRow = addListRow;
window.removeListRow = removeListRow;
window.onListInputChange = onListInputChange;
window.addPairRow = addPairRow;
window.removePairRow = removePairRow; 

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
  return await editorManager.loadEditorTemplate(kind);
}

function fillSiteForm(data) {
  editorManager.fillSiteForm(data);
}

function fillApiForm(data) {
  editorManager.fillApiForm(data);
}

function parsePositiveInt(value) {
  return editorManager.parsePositiveInt(value);
}

function validateCronExpression(value) {
  return editorManager.validateCronExpression(value);
}

function buildSitePayload() {
  return editorManager.buildSitePayload();
}

function buildApiPayload() {
  return editorManager.buildApiPayload();
}

function renderSites() {
  const filteredSites = PageHelpers.filterSites(state.sites, siteSearchText);
  const total = filteredSites.length;
  const pagination = PageHelpers.paginateItems(filteredSites, sitePage, sitePageSize);
  sitePage = pagination.page;

  document.getElementById("siteCount").textContent = formatItems(total);
  renderPager({
    pagerId: "sitePagerTop",
    page: sitePage,
    totalPages: pagination.totalPages,
    total,
    start: pagination.startIndex + 1,
    end: pagination.startIndex + pagination.pageItems.length,
    onPageChange: "onSitePageChange"
  });

  const rows = pagination.pageItems.map((s, i) => `
        <tr>
          <td>${pagination.startIndex + i + 1}</td>
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
          <th class="sortable-head" onclick="onSiteHeaderSort('name')">${t("name")}<span class="sort-indicator">${PageHelpers.getSortIndicator(sortState.site, SITE_SORT_RULES.name)}</span></th>
          <th class="sortable-head" onclick="onSiteHeaderSort('url')">${t("url")}<span class="sort-indicator">${PageHelpers.getSortIndicator(sortState.site, SITE_SORT_RULES.url)}</span></th>
          <th class="sortable-head" onclick="onSiteHeaderSort('timeout')">${t("timeout")}<span class="sort-indicator">${PageHelpers.getSortIndicator(sortState.site, SITE_SORT_RULES.timeout)}</span></th>
          <th>${t("actions")}</th>
        </tr>
        ${rows || `<tr><td colspan="5" class="empty-cell">${t("no_data")}</td></tr>`}
      `;
}

function renderApis() {
  const filteredApis = PageHelpers.filterApis(state.apis, apiSearchText);
  const total = filteredApis.length;
  const pagination = PageHelpers.paginateItems(filteredApis, apiPage, apiPageSize);
  apiPage = pagination.page;

  document.getElementById("apiCount").textContent = formatItems(total);
  renderPager({
    pagerId: "apiPagerTop",
    page: apiPage,
    totalPages: pagination.totalPages,
    total,
    start: pagination.startIndex + 1,
    end: pagination.startIndex + pagination.pageItems.length,
    onPageChange: "onApiPageChange"
  });

  const rows = pagination.pageItems.map((a, i) => `
        <tr>
          <td>${pagination.startIndex + i + 1}</td>
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
          <th class="sortable-head" onclick="onApiHeaderSort('name')">${t("name")}<span class="sort-indicator">${PageHelpers.getSortIndicator(sortState.api, API_SORT_RULES.name)}</span></th>
          <th class="sortable-head" onclick="onApiHeaderSort('url')">${t("url")}<span class="sort-indicator">${PageHelpers.getSortIndicator(sortState.api, API_SORT_RULES.url)}</span></th>
          <th class="sortable-head" onclick="onApiHeaderSort('type')">${t("type")}<span class="sort-indicator">${PageHelpers.getSortIndicator(sortState.api, API_SORT_RULES.type)}</span></th>
          <th class="sortable-head" onclick="onApiHeaderSort('valid')">${t("valid")}<span class="sort-indicator">${PageHelpers.getSortIndicator(sortState.api, API_SORT_RULES.valid)}</span></th>
          <th class="sortable-head" onclick="onApiHeaderSort('keywords')">${t("keywords")}<span class="sort-indicator">${PageHelpers.getSortIndicator(sortState.api, API_SORT_RULES.keywords)}</span></th>
          <th>${t("actions")}</th>
        </tr>
        ${rows || `<tr><td colspan="7" class="empty-cell">${t("no_data")}</td></tr>`}
      `;
}

function renderPager({ pagerId, page, totalPages, total, start, end, onPageChange }) {
  const pager = document.getElementById(pagerId);
  if (!pager) return;
  const safeTotal = Math.max(0, Number(total || 0));
  const rangeText = safeTotal > 0
    ? `${Math.max(1, Number(start || 1))}-${Math.max(1, Number(end || 1))} / ${safeTotal}`
    : "0-0 / 0";
  if (totalPages <= 1) {
    pager.innerHTML = `<span class="pager-range">${escapeHtml(rangeText)}</span>`;
    return;
  }

  const firstDisabled = page <= 1 ? "disabled" : "";
  const prevDisabled = page <= 1 ? "disabled" : "";
  const nextDisabled = page >= totalPages ? "disabled" : "";
  const lastDisabled = page >= totalPages ? "disabled" : "";
  pager.innerHTML = `
        <button type="button" class="pager-icon-btn" title="${escapeHtml(t("page_first"))}" ${firstDisabled} onclick="${onPageChange}(1)">&lt;&lt;</button>
        <button type="button" class="pager-icon-btn" title="${escapeHtml(t("page_prev"))}" ${prevDisabled} onclick="${onPageChange}(${page - 1})">&lt;</button>
        <span class="pager-range">${escapeHtml(rangeText)}</span>
        <button type="button" class="pager-icon-btn" title="${escapeHtml(t("page_next"))}" ${nextDisabled} onclick="${onPageChange}(${page + 1})">&gt;</button>
        <button type="button" class="pager-icon-btn" title="${escapeHtml(t("page_last"))}" ${lastDisabled} onclick="${onPageChange}(${totalPages})">&gt;&gt;</button>
      `;
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

function renderLocalData() {
  localDataManager.renderLocalData();
}

function closeLocalDataModal() {
  localDataManager.closeLocalDataModal();
}

function getPendingDeleteSet() {
  return localDataManager.getPendingDeleteSet();
}

function makePendingDeleteKey(type, index, path) {
  return localDataManager.makePendingDeleteKey(type, index, path);
}

function updateLocalDeleteConfirmButton() {
  localDataManager.updateLocalDeleteConfirmButton();
}

function tuneLocalDataModalLayout(type, count) {
  localDataManager.tuneLocalDataModalLayout(type, count);
}

function renderLocalDataItems(detail) {
  localDataManager.renderLocalDataItems(detail);
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
  await editorManager.openEditor(kind, data);
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
  editorManager.closeEditor();
}

async function saveEditor() {
  await editorManager.saveEditor();
}

async function testEditorApi(btn) {
  await editorManager.testEditorApi(btn);
}

function getSingleRepeatIntervalSeconds() {
  return testManager.getSingleRepeatIntervalSeconds();
}

function getSingleRepeatTimes() {
  return testManager.getSingleRepeatTimes();
}

function refreshSingleRepeatButtonLabel() {
  testManager.refreshSingleRepeatButtonLabel();
}

function refreshSingleRepeatPauseButton() {
  testManager.refreshSingleRepeatPauseButton();
}

function stopSingleRepeat() {
  testManager.stopSingleRepeat();
}

function setSingleRepeatControlsVisible(visible, payload = null) {
  testManager.setSingleRepeatControlsVisible(visible, payload);
}

function waitSingleRepeatInterval(ms) {
  return testManager.waitSingleRepeatInterval(ms);
}

async function waitIfSingleRepeatPaused() {
  await testManager.waitIfSingleRepeatPaused();
}

function onToggleSingleRepeatPauseClick() {
  testManager.onToggleSingleRepeatPauseClick();
}

function closeDuplicateChoiceModal(defaultChoice = "skip_once") {
  testManager.closeDuplicateChoiceModal(defaultChoice);
}

function onDuplicateChoiceClick(choice) {
  testManager.onDuplicateChoiceClick(choice);
}

async function askDuplicateHandling(name) {
  return await testManager.askDuplicateHandling(name);
}

async function runSinglePreviewOnce(payload, options = {}) {
  return await testManager.runSinglePreviewOnce(payload, options);
}

async function testEditorPayloadAndRender(payload) {
  await testManager.testEditorPayloadAndRender(payload);
}

async function removeSite(btn, name) {
  await poolActionsManager.removeSite(btn, name);
}

async function removeApi(btn, name) {
  await poolActionsManager.removeApi(btn, name);
}

async function loadLocalData() {
  await localDataManager.loadLocalData();
}

async function onRefreshLocalDataClick(btn) {
  await localDataManager.onRefreshLocalDataClick(btn);
}

async function openLocalDataViewer(btn, type, name) {
  await localDataManager.openLocalDataViewer(btn, type, name);
}

async function removeLocalCollection(btn, type, name) {
  await localDataManager.removeLocalCollection(btn, type, name);
}

function removeLocalItem(btn, type, name, index, path) {
  localDataManager.removeLocalItem(btn, type, name, index, path);
}

async function onConfirmLocalDataDeleteClick(btn) {
  await localDataManager.onConfirmLocalDataDeleteClick(btn);
}

function clearUndoNotice() {
  poolActionsManager.clearUndoNotice();
}

function refreshUndoText() {
  poolActionsManager.refreshUndoText();
}

function showUndoNotice(kind, payload) {
  poolActionsManager.showUndoNotice(kind, payload);
}

async function onUndoDeleteClick(btn) {
  await poolActionsManager.onUndoDeleteClick(btn);
}

async function toggleSiteEnabled(btn, name, nextEnabled) {
  await poolActionsManager.toggleSiteEnabled(btn, name, nextEnabled);
}

async function toggleApiEnabled(btn, name, nextEnabled) {
  await poolActionsManager.toggleApiEnabled(btn, name, nextEnabled);
}

async function testSingleApi(btn, name) {
  await poolActionsManager.testSingleApi(btn, name);
}

function openTestModal(titleKey = "test_all_title", options = {}) {
  testManager.openTestModal(titleKey, options);
}

function closeTestModal() {
  testManager.closeTestModal();
}

function onStopTaskClick(taskId) {
  testManager.onStopTaskClick(taskId);
}

async function onToggleSingleRepeatClick(btn) {
  void btn;
  await testManager.onToggleSingleRepeatClick();
}

function updateTestProgress(completed, total) {
  testManager.updateTestProgress(completed, total);
}

function appendTestLog(item) {
  testManager.appendTestLog(item);
}

function renderSavedDataBlock(item) {
  return testManager.renderSavedDataBlock(item);
}

function updateTestSummary(text) {
  testManager.updateTestSummary(text);
}

function applyApiValidity(name, valid) {
  return testManager.applyApiValidity(name, valid);
}

function applyApiValidityBatch(names, valid) {
  return testManager.applyApiValidityBatch(names, valid);
}

async function testApisStream(names = [], task = null) {
  await testManager.testApisStream(names, task);
}

async function onTestAllClick(btn) {
  await testManager.onTestAllClick(btn);
}

async function onUpdateAppClick(btn) {
  await updateManager.onUpdateAppClick(btn);
}

async function onUpdateConfirmClick(btn) {
  await updateManager.onUpdateConfirmClick(btn);
}

async function onRestartAppClick(btn) {
  await restartManager.onRestartAppClick(btn);
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
    showNoticeModal(err.message || String(err));
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
    showNoticeModal(err.message || String(err));
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






