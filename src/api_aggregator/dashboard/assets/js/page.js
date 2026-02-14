if (typeof I18N === "undefined") {
  throw new Error("i18n resource not loaded");
}

let currentLang = PageHelpers.getDefaultLang(I18N);
let currentTheme = PageHelpers.getDefaultTheme();
let sortState = PageHelpers.getDefaultSortState();
let siteSearchText = "";
let apiSearchText = "";
let localSearchText = "";
let apiSiteFilterSelected = new Set();
let apiSiteFilterOptionNames = [];
let apiSiteFilterInitialized = false;
function readPageFromUrl(paramName, fallback) {
  try {
    const raw = new URLSearchParams(window.location.search).get(paramName);
    const parsed = Number.parseInt(String(raw || ""), 10);
    if (Number.isFinite(parsed) && parsed >= 1) return parsed;
  } catch {}
  return fallback;
}
let sitePage = readPageFromUrl("sp", PageHelpers.getDefaultPage("api_aggregator_page_site"));
let apiPage = readPageFromUrl("ap", PageHelpers.getDefaultPage("api_aggregator_page_api"));
let localPage = readPageFromUrl("lp", PageHelpers.getDefaultPage("api_aggregator_page_local"));
let sitePageSize = PageHelpers.getDefaultPageSize("api_aggregator_page_size_site");
let apiPageSize = PageHelpers.getDefaultPageSize("api_aggregator_page_size_api");
let localPageSize = PageHelpers.getDefaultPageSize("api_aggregator_page_size_local");
let mainTab = PageHelpers.getDefaultMainTab();
let state = { sites: [], apis: [] };
let localCollections = [];
let allSiteNames = [];
let sitePagination = { page: sitePage, page_size: sitePageSize, total: 0, total_pages: 1, start: 0, end: 0 };
let apiPagination = { page: apiPage, page_size: apiPageSize, total: 0, total_pages: 1, start: 0, end: 0 };
let localPagination = { page: localPage, page_size: localPageSize, total: 0, total_pages: 1, start: 0, end: 0 };
let hasPoolLoaded = false;
let editorState = { kind: "", originalName: "" };
let localViewerState = { type: "", name: "", detail: null, pendingDeletes: new Set() };
const RESTART_MIN_ANIMATION_MS = 900;
let activeTestTaskId = "";
const SITE_SORT_RULES = {
  name: ["name_asc", "name_desc"],
  url: ["url_asc", "url_desc"],
  timeout: ["timeout_asc", "timeout_desc"],
  api_count: ["api_count_asc", "api_count_desc"]
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

function persistPageQueryState() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("sp", String(Math.max(1, Number(sitePage || 1))));
    url.searchParams.set("ap", String(Math.max(1, Number(apiPage || 1))));
    url.searchParams.set("lp", String(Math.max(1, Number(localPage || 1))));
    window.history.replaceState(null, "", url.toString());
  } catch {}
}

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
  if (hasPoolLoaded) {
    render();
  }
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
  onViewTaskClick: (taskId) => {
    testManager.onViewTaskClick(taskId);
  },
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
  getSites: () => state.sites,
  setSites: (sites) => {
    state.sites = Array.isArray(sites) ? sites : [];
  },
  renderSites,
  getApis: () => state.apis,
  setApis: (apis) => {
    state.apis = Array.isArray(apis) ? apis : [];
  },
  renderApis,
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
  getLocalPagination: () => localPagination,
  setLocalPagination: (meta) => {
    localPagination = {
      page: Math.max(1, Number(meta?.page || localPage || 1)),
      page_size: meta?.page_size ?? localPageSize,
      total: Math.max(0, Number(meta?.total || 0)),
      total_pages: Math.max(1, Number(meta?.total_pages || 1)),
      start: Math.max(0, Number(meta?.start || 0)),
      end: Math.max(0, Number(meta?.end || 0)),
    };
  },
  getLocalSearchText: () => localSearchText,
  getLocalPage: () => localPage,
  setLocalPage: (page) => {
    localPage = page;
    persistPageQueryState();
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
  setSites: (sites) => {
    state.sites = Array.isArray(sites) ? sites : [];
  },
  setApis: (apis) => {
    state.apis = Array.isArray(apis) ? apis : [];
  },
  renderSites,
  renderApis,
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
    persistPageQueryState();
  },
  getApiPage: () => apiPage,
  setApiPage: (page) => {
    apiPage = page;
    persistPageQueryState();
  },
  getLocalPage: () => localPage,
  setLocalPage: (page) => {
    localPage = page;
    persistPageQueryState();
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
  loadLocalData,
  refreshPoolView: () => {
    renderSites();
    renderApis();
  },
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
  const apiSiteFilterToggleAllText = document.querySelector(
    "#apiSiteFilterDropdown [data-i18n='all_sites']"
  );
  if (apiSiteFilterToggleAllText) {
    apiSiteFilterToggleAllText.textContent = t("all_sites");
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
  updateApiSiteFilterButtonLabel();
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

function onToggleRunningTasksPanel() {
  runningTasksManager.onToggleRunningTasksPanel();
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

function closeApiSiteFilterDropdown() {
  const dropdown = document.getElementById("apiSiteFilterDropdown");
  if (dropdown) {
    dropdown.classList.remove("open");
  }
}

function toggleApiSiteFilterDropdown(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const dropdown = document.getElementById("apiSiteFilterDropdown");
  if (!dropdown) return;
  const shouldOpen = !dropdown.classList.contains("open");
  dropdown.classList.toggle("open", shouldOpen);
}

function getApiSiteFilterNames() {
  return (Array.isArray(allSiteNames) ? allSiteNames : [])
    .map((name) => textValue(name).trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, currentLang === "zh" ? "zh-CN" : "en"));
}

function syncApiSiteFilterSelection(nextOptionNames) {
  const optionNames = Array.isArray(nextOptionNames) ? nextOptionNames : [];
  const optionSet = new Set(optionNames);
  const wasAllSelected =
    apiSiteFilterInitialized &&
    apiSiteFilterOptionNames.length > 0 &&
    apiSiteFilterSelected.size === apiSiteFilterOptionNames.length;

  if (!apiSiteFilterInitialized) {
    apiSiteFilterSelected = new Set(optionNames);
    apiSiteFilterInitialized = true;
    apiSiteFilterOptionNames = optionNames;
    return;
  }

  const nextSelected = new Set(
    Array.from(apiSiteFilterSelected).filter((name) => optionSet.has(name))
  );
  if (wasAllSelected) {
    optionNames.forEach((name) => nextSelected.add(name));
  }
  apiSiteFilterSelected = nextSelected;
  apiSiteFilterOptionNames = optionNames;
}

function updateApiSiteFilterButtonLabel() {
  const btn = document.getElementById("apiSiteFilterBtn");
  if (!btn) return;
  const total = apiSiteFilterOptionNames.length;
  const selected = apiSiteFilterSelected.size;
  const label = t("api_site_filter");
  if (!total) {
    btn.textContent = `${label} (0/0)`;
    return;
  }
  btn.textContent = `${label} (${selected}/${total})`;
}

function renderApiSiteFilter() {
  const optionsWrap = document.getElementById("apiSiteFilterOptions");
  const toggleAll = document.getElementById("apiSiteFilterToggleAll");
  if (!optionsWrap || !toggleAll) return;

  const optionNames = getApiSiteFilterNames();
  syncApiSiteFilterSelection(optionNames);
  const optionSet = new Set(optionNames);
  apiSiteFilterSelected = new Set(
    Array.from(apiSiteFilterSelected).filter((name) => optionSet.has(name))
  );

  optionsWrap.innerHTML = "";
  optionNames.forEach((name) => {
    const row = document.createElement("label");
    row.className = "site-filter-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = apiSiteFilterSelected.has(name);
    input.addEventListener("change", () => {
      onApiSiteFilterOptionChange(name, input.checked);
    });
    const text = document.createElement("span");
    text.textContent = name;
    row.appendChild(input);
    row.appendChild(text);
    optionsWrap.appendChild(row);
  });

  const selected = apiSiteFilterSelected.size;
  const total = optionNames.length;
  toggleAll.checked = total > 0 && selected === total;
  toggleAll.indeterminate = selected > 0 && selected < total;
  updateApiSiteFilterButtonLabel();
}

function onApiSiteFilterToggleAll(checked) {
  if (checked) {
    apiSiteFilterSelected = new Set(apiSiteFilterOptionNames);
  } else {
    apiSiteFilterSelected = new Set();
  }
  apiPage = 1;
  localStorage.setItem("api_aggregator_page_api", String(apiPage));
  persistPageQueryState();
  renderApis();
}

function onApiSiteFilterOptionChange(siteName, checked) {
  const normalized = textValue(siteName).trim();
  if (!normalized) return;
  if (checked) {
    apiSiteFilterSelected.add(normalized);
  } else {
    apiSiteFilterSelected.delete(normalized);
  }
  apiPage = 1;
  localStorage.setItem("api_aggregator_page_api", String(apiPage));
  persistPageQueryState();
  renderApis();
}

function resolveApiSiteName(api) {
  const direct = textValue(api?.site).trim();
  if (direct) return direct;
  const url = textValue(api?.url).trim();
  if (!url) return "";
  let matchedName = "";
  let matchedLen = -1;
  (Array.isArray(state.sites) ? state.sites : []).forEach((site) => {
    const siteUrl = textValue(site?.url).trim();
    if (!siteUrl) return;
    if (url.startsWith(siteUrl) && siteUrl.length > matchedLen) {
      matchedLen = siteUrl.length;
      matchedName = textValue(site?.name).trim();
    }
  });
  return matchedName;
}

function filterApisBySite(items) {
  const safeItems = Array.isArray(items) ? items : [];
  const totalSiteOptions = apiSiteFilterOptionNames.length;
  if (!totalSiteOptions) {
    return safeItems;
  }
  if (apiSiteFilterSelected.size >= totalSiteOptions) {
    return safeItems;
  }
  if (apiSiteFilterSelected.size <= 0) {
    return [];
  }
  return safeItems.filter((api) =>
    apiSiteFilterSelected.has(resolveApiSiteName(api))
  );
}

function compareTextAsc(a, b) {
  return String(a || "").localeCompare(String(b || ""), currentLang === "zh" ? "zh-CN" : "en");
}

function sortSites(items, rule) {
  const safeItems = Array.isArray(items) ? [...items] : [];
  const safeRule = textValue(rule).trim().toLowerCase();
  return safeItems.sort((left, right) => {
    const leftName = textValue(left?.name).toLowerCase();
    const rightName = textValue(right?.name).toLowerCase();
    const leftUrl = textValue(left?.url).toLowerCase();
    const rightUrl = textValue(right?.url).toLowerCase();
    const leftTimeout = Number(left?.timeout || 0);
    const rightTimeout = Number(right?.timeout || 0);
    const leftApiCount = Number(left?.api_count || 0);
    const rightApiCount = Number(right?.api_count || 0);
    const leftEnabled = Boolean(left?.enabled) ? 1 : 0;
    const rightEnabled = Boolean(right?.enabled) ? 1 : 0;

    if (safeRule === "name_desc") return compareTextAsc(rightName, leftName);
    if (safeRule === "url_asc") return compareTextAsc(leftUrl, rightUrl) || compareTextAsc(leftName, rightName);
    if (safeRule === "url_desc") return compareTextAsc(rightUrl, leftUrl) || compareTextAsc(leftName, rightName);
    if (safeRule === "timeout_asc") return leftTimeout - rightTimeout || compareTextAsc(leftName, rightName);
    if (safeRule === "timeout_desc") return rightTimeout - leftTimeout || compareTextAsc(leftName, rightName);
    if (safeRule === "api_count_asc") return leftApiCount - rightApiCount || compareTextAsc(leftName, rightName);
    if (safeRule === "api_count_desc") return rightApiCount - leftApiCount || compareTextAsc(leftName, rightName);
    if (safeRule === "enabled_first") return rightEnabled - leftEnabled || compareTextAsc(leftName, rightName);
    if (safeRule === "disabled_first") return leftEnabled - rightEnabled || compareTextAsc(leftName, rightName);
    return compareTextAsc(leftName, rightName);
  });
}

function sortApis(items, rule) {
  const safeItems = Array.isArray(items) ? [...items] : [];
  const safeRule = textValue(rule).trim().toLowerCase();
  return safeItems.sort((left, right) => {
    const leftName = textValue(left?.name).toLowerCase();
    const rightName = textValue(right?.name).toLowerCase();
    const leftUrl = textValue(left?.url).toLowerCase();
    const rightUrl = textValue(right?.url).toLowerCase();
    const leftType = textValue(left?.type).toLowerCase();
    const rightType = textValue(right?.type).toLowerCase();
    const leftValid = Boolean(left?.valid) ? 1 : 0;
    const rightValid = Boolean(right?.valid) ? 1 : 0;
    const leftKeywords = Array.isArray(left?.keywords) ? left.keywords.length : 0;
    const rightKeywords = Array.isArray(right?.keywords) ? right.keywords.length : 0;

    if (safeRule === "name_desc") return compareTextAsc(rightName, leftName);
    if (safeRule === "url_asc") return compareTextAsc(leftUrl, rightUrl) || compareTextAsc(leftName, rightName);
    if (safeRule === "url_desc") return compareTextAsc(rightUrl, leftUrl) || compareTextAsc(leftName, rightName);
    if (safeRule === "type_asc") return compareTextAsc(leftType, rightType) || compareTextAsc(leftName, rightName);
    if (safeRule === "type_desc") return compareTextAsc(rightType, leftType) || compareTextAsc(leftName, rightName);
    if (safeRule === "valid_first") return rightValid - leftValid || compareTextAsc(leftName, rightName);
    if (safeRule === "invalid_first") return leftValid - rightValid || compareTextAsc(leftName, rightName);
    if (safeRule === "keywords_desc") return rightKeywords - leftKeywords || compareTextAsc(leftName, rightName);
    return compareTextAsc(leftName, rightName);
  });
}

function renderSiteUrlCell(url) {
  const rawUrl = textValue(url).trim();
  const safeUrl = escapeHtml(rawUrl);
  if (!rawUrl) {
    return `<div class="url-scroll"></div>`;
  }
  if (!/^https?:\/\//i.test(rawUrl)) {
    return `<div class="url-scroll" title="${safeUrl}">${safeUrl}</div>`;
  }
  return `
    <a
      class="url-scroll site-url-link"
      href="${safeUrl}"
      target="_blank"
      rel="noopener noreferrer"
      title="${safeUrl}"
    >${safeUrl}</a>
  `;
}

function renderSites() {
  const filteredSites = PageHelpers.filterSites(
    Array.isArray(state.sites) ? state.sites : [],
    siteSearchText
  );
  const sortedSites = sortSites(filteredSites, sortState.site);
  const paged = PageHelpers.paginateItems(sortedSites, sitePage, sitePageSize);
  const pageItems = Array.isArray(paged.pageItems) ? paged.pageItems : [];
  sitePage = Math.max(1, Number(paged.page || sitePage || 1));
  localStorage.setItem("api_aggregator_page_site", String(sitePage));
  persistPageQueryState();

  const total = Math.max(0, Number(paged.total || 0));
  const start = total > 0 ? Math.max(0, Number(paged.startIndex || 0)) + 1 : 0;
  const end = total > 0 ? Math.min(total, Math.max(0, Number(paged.startIndex || 0)) + pageItems.length) : 0;
  sitePagination = {
    page: sitePage,
    page_size: sitePageSize,
    total,
    total_pages: Math.max(1, Number(paged.totalPages || 1)),
    start: Math.max(0, Number(paged.startIndex || 0)),
    end,
  };
  document.getElementById("siteCount").textContent = formatItems(total);
  renderPager({
    pagerId: "sitePagerTop",
    page: sitePage,
    totalPages: sitePagination.total_pages,
    total,
    start,
    end,
    onPageChange: "onSitePageChange"
  });

  const rows = pageItems.map((s, i) => `
        <tr>
          <td>${Math.max(0, Number(sitePagination.start || 0)) + i + 1}</td>
          <td><code class="name-code">${escapeHtml(s.name || "")}</code></td>
          <td class="url-cell">${renderSiteUrlCell(s.url || "")}</td>
          <td>${Number(s.timeout || 60)}</td>
          <td>${Math.max(0, Number(s.api_count || 0))}</td>
          <td class="actions-cell">
            <label class="switch-toggle table-switch" title="${Boolean(s.enabled) ? t("disable_action") : t("enable_action")}">
              <input
                type="checkbox"
                ${Boolean(s.enabled) ? "checked" : ""}
                onclick='toggleSiteEnabled(this, "${encodeURIComponent(s.name || "")}", this.checked)'
              >
              <span class="switch-slider"></span>
            </label>
            <button onclick='openSiteEditorByName("${encodeURIComponent(s.name || "")}")'>${t("edit")}</button>
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
          <th class="sortable-head" onclick="onSiteHeaderSort('api_count')">${t("api_count")}<span class="sort-indicator">${PageHelpers.getSortIndicator(sortState.site, SITE_SORT_RULES.api_count)}</span></th>
          <th>${t("actions")}</th>
        </tr>
        ${rows || `<tr><td colspan="6" class="empty-cell">${t("no_data")}</td></tr>`}
      `;
}

function renderApis() {
  renderApiSiteFilter();
  const searchedApis = PageHelpers.filterApis(
    Array.isArray(state.apis) ? state.apis : [],
    apiSearchText
  );
  const siteFilteredApis = filterApisBySite(searchedApis);
  const sortedApis = sortApis(siteFilteredApis, sortState.api);
  const paged = PageHelpers.paginateItems(sortedApis, apiPage, apiPageSize);
  const pageItems = Array.isArray(paged.pageItems) ? paged.pageItems : [];
  apiPage = Math.max(1, Number(paged.page || apiPage || 1));
  localStorage.setItem("api_aggregator_page_api", String(apiPage));
  persistPageQueryState();

  const total = Math.max(0, Number(paged.total || 0));
  const start = total > 0 ? Math.max(0, Number(paged.startIndex || 0)) + 1 : 0;
  const end = total > 0 ? Math.min(total, Math.max(0, Number(paged.startIndex || 0)) + pageItems.length) : 0;
  apiPagination = {
    page: apiPage,
    page_size: apiPageSize,
    total,
    total_pages: Math.max(1, Number(paged.totalPages || 1)),
    start: Math.max(0, Number(paged.startIndex || 0)),
    end,
  };
  document.getElementById("apiCount").textContent = formatItems(total);
  renderPager({
    pagerId: "apiPagerTop",
    page: apiPage,
    totalPages: apiPagination.total_pages,
    total,
    start,
    end,
    onPageChange: "onApiPageChange"
  });

  const rows = pageItems.map((a, i) => `
        <tr>
          <td>${Math.max(0, Number(apiPagination.start || 0)) + i + 1}</td>
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
  const safeTotalPages = Math.max(1, Number(totalPages || 1));
  const safePage = Math.min(Math.max(1, Number(page || 1)), safeTotalPages);
  const rangeText = safeTotal > 0
    ? `${Math.max(1, Number(start || 1))}-${Math.max(1, Number(end || 1))} / ${safeTotal}`
    : "0-0 / 0";
  const firstDisabled = safePage <= 1 ? "disabled" : "";
  const prevDisabled = safePage <= 1 ? "disabled" : "";
  const nextDisabled = safePage >= safeTotalPages ? "disabled" : "";
  const lastDisabled = safePage >= safeTotalPages ? "disabled" : "";
  const prevPage = Math.max(1, safePage - 1);
  const nextPage = Math.min(safeTotalPages, safePage + 1);
  pager.innerHTML = `
        <button type="button" class="pager-icon-btn" title="${escapeHtml(t("page_first"))}" ${firstDisabled} onclick="${onPageChange}(1)">&lt;&lt;</button>
        <button type="button" class="pager-icon-btn" title="${escapeHtml(t("page_prev"))}" ${prevDisabled} onclick="${onPageChange}(${prevPage})">&lt;</button>
        <span class="pager-range">${escapeHtml(rangeText)}</span>
        <button type="button" class="pager-icon-btn" title="${escapeHtml(t("page_next"))}" ${nextDisabled} onclick="${onPageChange}(${nextPage})">&gt;</button>
        <button type="button" class="pager-icon-btn" title="${escapeHtml(t("page_last"))}" ${lastDisabled} onclick="${onPageChange}(${safeTotalPages})">&gt;&gt;</button>
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

function openSiteEditorByName(name) {
  const decoded = decodeURIComponent(name || "");
  const target = state.sites.find((site) => textValue(site?.name) === decoded) || null;
  openEditor("site", target);
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

function onToggleSingleTestParamSheetClick() {
  testManager.onToggleSingleTestParamSheetClick();
}

function onToggleBatchPauseClick() {
  testManager.onToggleBatchPauseClick();
}

function onStopBatchTestClick() {
  testManager.onStopBatchTestClick();
}

async function runSinglePreviewOnce(payload, options = {}) {
  return await testManager.runSinglePreviewOnce(payload, options);
}

async function testEditorPayloadAndRender(payload, options = {}) {
  await testManager.testEditorPayloadAndRender(payload, options);
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

function onViewTaskClick(taskId) {
  testManager.onViewTaskClick(taskId);
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
  await withButtonLoading(btn, async () => {
    await testApisStream([], createRunningTask("batch", t("test_all_title")));
  });
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

async function loadPool(options = {}) {
  const includeLocalData = options.includeLocalData !== false;
  const silent = Boolean(options.silent);
  try {
    const data = await req("/api/pool");
    state = {
      sites: Array.isArray(data.sites) ? data.sites : [],
      apis: Array.isArray(data.apis) ? data.apis : []
    };
    allSiteNames = Array.from(
      new Set(
        state.sites
          .map((item) => textValue(item?.name).trim())
          .filter(Boolean)
      )
    );
    sitePage = Math.max(1, Number(sitePage || 1));
    apiPage = Math.max(1, Number(apiPage || 1));
    localStorage.setItem("api_aggregator_page_site", String(sitePage));
    localStorage.setItem("api_aggregator_page_api", String(apiPage));
    persistPageQueryState();
    hasPoolLoaded = true;
    renderSites();
    renderApis();
    if (includeLocalData) {
      await loadLocalData();
    }
  } catch (err) {
    if (!silent) {
      showNoticeModal(err.message || String(err));
    }
  }
}

window.addEventListener("resize", () => {
  document.querySelectorAll(".list-collection[id]").forEach((node) => {
    applyListLayout(node.id);
  });
});

document.addEventListener("click", (event) => {
  const wrap = document.getElementById("apiSiteFilterWrap");
  if (!wrap) return;
  const target = event.target;
  if (target instanceof Node && wrap.contains(target)) {
    return;
  }
  closeApiSiteFilterDropdown();
});

setTheme(currentTheme);
setLanguage(currentLang);
switchMainTab(mainTab);
persistSortState();
loadPool();






