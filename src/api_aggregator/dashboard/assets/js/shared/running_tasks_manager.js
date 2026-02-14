function createRunningTasksManager(deps) {
  const { t, escapeHtml, getActiveTestTaskId } = deps;

  let taskSeq = 0;
  const runningTasks = [];

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
      ...extra,
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
    if (getActiveTestTaskId() === taskId) {
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
    const chips = active
      .map(
        (task) => `
        <span class="running-task-chip">
          <strong>${escapeHtml(task.title)}</strong>
          <span>${escapeHtml(buildTestStatsText(task))}</span>
          <button type="button" class="btn-square" onclick="onStopTaskClick('${task.id}')">${escapeHtml(t("stop"))}</button>
        </span>
      `
      )
      .join("");
    bar.innerHTML = `
        <div class="running-tasks-row">
          <strong>${escapeHtml(t("running_tasks"))}</strong>
          ${chips}
        </div>
      `;
  }

  return {
    buildTestStatsText,
    updateTestStats,
    createRunningTask,
    getRunningTask,
    patchRunningTask,
    finishRunningTask,
    renderRunningTasks,
  };
}
