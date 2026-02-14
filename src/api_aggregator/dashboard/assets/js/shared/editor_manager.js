function createEditorManager(deps) {
  const {
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
    getSites,
    setSites,
    renderSites,
    getApis,
    setApis,
    renderApis,
    setEditorState,
    getEditorState,
    getSiteTemplate,
    getApiTemplate,
  } = deps;

  const editorTemplates = { site: "", api: "" };

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
      { name: "weekday", min: 0, max: 7 },
    ];

    const aliases = {
      month: [
        "jan",
        "feb",
        "mar",
        "apr",
        "may",
        "jun",
        "jul",
        "aug",
        "sep",
        "oct",
        "nov",
        "dec",
      ],
      weekday: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
    };

    function assertInRange(fieldName, num, min, max) {
      if (!Number.isInteger(num) || num < min || num > max) {
        throw new Error(t("cron_invalid_range", { field: fieldName, min, max }));
      }
    }

    function parseCronValue(fieldName, raw) {
      const val = String(raw).trim().toLowerCase();
      const names = aliases[fieldName] || [];
      const idx = names.indexOf(val);
      if (idx >= 0) {
        return fieldName === "weekday" ? idx : idx + 1;
      }
      const numeric = Number.parseInt(val, 10);
      if (!Number.isFinite(numeric)) {
        throw new Error(t("cron_invalid"));
      }
      return numeric;
    }

    function validateCronField(fieldSpec, fieldRaw) {
      const field = String(fieldRaw || "").trim();
      if (!field) throw new Error(t("cron_invalid"));

      if (/^\*(\/[1-9]\d*)?$/.test(field)) {
        return;
      }

      const entries = field.split(",").map((item) => item.trim()).filter(Boolean);
      if (!entries.length) throw new Error(t("cron_invalid"));

      for (const entry of entries) {
        const [basePart, stepPart] = entry.split("/");
        if (entry.split("/").length > 2) throw new Error(t("cron_invalid"));
        const base = String(basePart || "").trim();
        const step = stepPart === undefined ? "" : String(stepPart).trim();

        if (step) {
          if (!/^\d+$/.test(step) || Number.parseInt(step, 10) <= 0) {
            throw new Error(t("cron_invalid"));
          }
        }

        if (base === "*") continue;

        if (base.includes("-")) {
          const [startRaw, endRaw] = base.split("-");
          if (base.split("-").length !== 2 || !startRaw || !endRaw) {
            throw new Error(t("cron_invalid"));
          }
          const start = parseCronValue(fieldSpec.name, startRaw);
          const end = parseCronValue(fieldSpec.name, endRaw);
          assertInRange(fieldSpec.name, start, fieldSpec.min, fieldSpec.max);
          assertInRange(fieldSpec.name, end, fieldSpec.min, fieldSpec.max);
          if (start > end) throw new Error(t("cron_invalid"));
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
    const name = textValue(document.getElementById("siteName")?.value).trim();
    const url = textValue(document.getElementById("siteUrl")?.value).trim();
    if (!name) throw new Error(t("required_field", { field: t("name") }));
    if (!url) throw new Error(t("required_field", { field: t("url") }));
    return {
      name,
      url,
      timeout: parsePositiveInt(document.getElementById("siteTimeout")?.value),
      headers: pairsToMap("siteHeaders"),
      keys: pairsToMap("siteKeys"),
    };
  }

  function buildApiPayload() {
    const name = textValue(document.getElementById("apiName")?.value).trim();
    const url = textValue(document.getElementById("apiUrl")?.value).trim();
    const cron = validateCronExpression(document.getElementById("apiCron")?.value);
    if (!name) throw new Error(t("required_field", { field: t("name") }));
    if (!url) throw new Error(t("required_field", { field: t("url") }));
    return {
      name,
      url,
      type: textValue(document.getElementById("apiType")?.value).trim() || "text",
      params: pairsToMap("apiParams"),
      parse: readListRows("apiParseList").join("\n"),
      scope: readListRows("apiScopeList"),
      keywords: readListRows("apiKeywordsList"),
      cron,
    };
  }

  async function openEditor(kind, data = null) {
    try {
      setEditorState({ kind, originalName: data?.name || "" });
      const action = data ? t("edit") : t("add");
      const target = kind === "site" ? t("site_upper") : t("api_upper");
      const source = data || (kind === "site" ? getSiteTemplate() : getApiTemplate());
      document.getElementById("editorTitle").textContent = t("editor_title", {
        action,
        target,
      });
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
      showNoticeModal(err.message || String(err));
    }
  }

  function closeEditor() {
    document.getElementById("editorModal").classList.remove("open");
  }

  async function saveEditor() {
    try {
      const st = getEditorState();
      const kind = st.kind;
      const oldName = st.originalName;
      const payload = kind === "site" ? buildSitePayload() : buildApiPayload();
      if (!oldName && payload.enabled === undefined) {
        payload.enabled = true;
      }
      let saved = null;
      if (kind === "site") {
        if (oldName) {
          saved = await req(`/api/site/${encodeURIComponent(oldName)}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
        } else {
          saved = await req("/api/site", { method: "POST", body: JSON.stringify(payload) });
        }
      } else if (kind === "api") {
        if (oldName) {
          saved = await req(`/api/api/${encodeURIComponent(oldName)}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
        } else {
          saved = await req("/api/api", { method: "POST", body: JSON.stringify(payload) });
        }
      }

      if (kind === "site" && saved) {
        const prev = Array.isArray(getSites()) ? getSites() : [];
        const index = oldName
          ? prev.findIndex((item) => textValue(item?.name) === oldName)
          : -1;
        const next = [...prev];
        if (index >= 0) {
          next[index] = { ...next[index], ...saved };
        } else {
          next.push(saved);
        }
        setSites(next);
        renderSites();
      } else if (kind === "api" && saved) {
        const prev = Array.isArray(getApis()) ? getApis() : [];
        const index = oldName
          ? prev.findIndex((item) => textValue(item?.name) === oldName)
          : -1;
        const next = [...prev];
        if (index >= 0) {
          next[index] = { ...next[index], ...saved };
        } else {
          next.push(saved);
        }
        setApis(next);
        renderApis();
      }

      closeEditor();
      void loadPool({ includeLocalData: false, silent: true });
    } catch (err) {
      showNoticeModal(err.message || String(err));
    }
  }

  async function testEditorApi(btn) {
    await withButtonLoading(btn, async () => {
      const payload = buildApiPayload();
      await testEditorPayloadAndRender(payload);
    });
  }

  return {
    loadEditorTemplate,
    fillSiteForm,
    fillApiForm,
    parsePositiveInt,
    validateCronExpression,
    buildSitePayload,
    buildApiPayload,
    openEditor,
    closeEditor,
    saveEditor,
    testEditorApi,
  };
}
