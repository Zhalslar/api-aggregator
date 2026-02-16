from __future__ import annotations

import asyncio
import sys
from collections.abc import Awaitable, Callable
from datetime import datetime
from pathlib import Path
from typing import Any

from ..log import logger


class UpdateService:
    """Manage update checking/running state for dashboard APIs."""

    def __init__(
        self,
        restart_process_handler: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        self.restart_process_handler = restart_process_handler
        self._update_lock = asyncio.Lock()
        self._update_task: asyncio.Task[None] | None = None
        self._update_state: dict[str, Any] = self._new_update_state()

    @staticmethod
    def _new_update_state() -> dict[str, Any]:
        return {
            "status": "idle",
            "progress": 0,
            "message": "",
            "check": {},
            "logs": [],
            "started_at": 0,
            "ended_at": 0,
        }

    def _update_state_patch(self, **patch: Any) -> None:
        self._update_state.update(patch)

    def _append_update_log(self, text: str) -> None:
        logs = self._update_state.get("logs")
        if not isinstance(logs, list):
            logs = []
            self._update_state["logs"] = logs
        stamp = datetime.now().strftime("%H:%M:%S")
        logs.append(f"[{stamp}] {text}")
        if len(logs) > 120:
            self._update_state["logs"] = logs[-120:]

    @staticmethod
    async def _run_cmd(
        args: list[str], *, cwd: Path, timeout: float = 300
    ) -> tuple[int, str, str]:
        proc = await asyncio.create_subprocess_exec(
            *args,
            cwd=str(cwd),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise RuntimeError(
                f"command timed out after {int(timeout)}s: {' '.join(args)}"
            ) from None
        out_text = stdout.decode("utf-8", errors="replace").strip()
        err_text = stderr.decode("utf-8", errors="replace").strip()
        return proc.returncode, out_text, err_text # type: ignore

    async def _inspect_update(self) -> dict[str, Any]:
        project_root = Path.cwd()
        result: dict[str, Any] = {
            "available": False,
            "has_update": False,
            "dirty": False,
            "branch": "",
            "ahead": 0,
            "behind": 0,
            "current": "",
            "current_short": "",
            "remote": "",
            "remote_short": "",
            "reason": "",
        }

        code, out, err = await self._run_cmd(
            ["git", "rev-parse", "--is-inside-work-tree"], cwd=project_root, timeout=20
        )
        if code != 0 or out.lower() != "true":
            result["reason"] = err or "not a git repository"
            return result

        code, _, _ = await self._run_cmd(
            ["git", "fetch", "--all", "--prune"], cwd=project_root, timeout=120
        )
        if code != 0:
            result["reason"] = "git fetch failed"
            return result

        code, out, _ = await self._run_cmd(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=project_root,
            timeout=20,
        )
        if code == 0:
            result["branch"] = out.strip()

        code, out, _ = await self._run_cmd(
            ["git", "rev-parse", "HEAD"], cwd=project_root, timeout=20
        )
        if code == 0:
            result["current"] = out.strip()

        code, out, _ = await self._run_cmd(
            ["git", "rev-parse", "--short", "HEAD"], cwd=project_root, timeout=20
        )
        if code == 0:
            result["current_short"] = out.strip()

        code, out, _ = await self._run_cmd(
            ["git", "status", "--porcelain"], cwd=project_root, timeout=20
        )
        if code == 0:
            result["dirty"] = bool(out.strip())

        code, out, err = await self._run_cmd(
            ["git", "rev-parse", "@{u}"], cwd=project_root, timeout=20
        )
        if code != 0:
            result["available"] = True
            result["reason"] = err or "no upstream tracking branch"
            return result
        result["remote"] = out.strip()

        code, out, _ = await self._run_cmd(
            ["git", "rev-parse", "--short", "@{u}"], cwd=project_root, timeout=20
        )
        if code == 0:
            result["remote_short"] = out.strip()

        code, out, err = await self._run_cmd(
            ["git", "rev-list", "--left-right", "--count", "HEAD...@{u}"],
            cwd=project_root,
            timeout=20,
        )
        if code != 0:
            result["reason"] = err or "failed to compare local/remote commits"
            return result

        parts = out.split()
        if len(parts) >= 2:
            try:
                result["ahead"] = int(parts[0])
                result["behind"] = int(parts[1])
            except Exception:
                result["ahead"] = 0
                result["behind"] = 0

        result["available"] = True
        result["has_update"] = result["behind"] > 0
        return result

    def is_running(self) -> bool:
        return self._update_lock.locked()

    def get_status(self) -> dict[str, Any]:
        return dict(self._update_state)

    async def check(self) -> dict[str, Any]:
        if self._update_lock.locked():
            return dict(self._update_state)

        try:
            check = await self._inspect_update()
            if not check.get("available"):
                status = "unavailable"
                msg = str(check.get("reason") or "update check unavailable")
            elif check.get("has_update"):
                status = "ready"
                msg = "update is available"
            else:
                status = "up_to_date"
                msg = "already up-to-date"
            self._update_state_patch(
                status=status,
                progress=0,
                message=msg,
                check=check,
                logs=[],
                started_at=0,
                ended_at=0,
            )
            return dict(self._update_state)
        except Exception as exc:
            logger.error("[api_aggregator] update check failed: %s", exc)
            self._update_state_patch(
                status="error",
                progress=0,
                message=f"update check failed: {exc}",
                check={},
                logs=[],
                started_at=0,
                ended_at=0,
            )
            raise

    async def start(self) -> bool:
        if self._update_lock.locked():
            return False
        self._update_task = asyncio.create_task(self._run_update_task())
        return True

    async def _run_update_task(self) -> None:
        async with self._update_lock:
            started_at = int(asyncio.get_running_loop().time() * 1000)
            self._update_state = self._new_update_state()
            self._update_state_patch(
                status="running",
                progress=2,
                message="checking update status",
                started_at=started_at,
                ended_at=0,
            )
            self._append_update_log("Starting update task.")
            try:
                check = await self._inspect_update()
                self._update_state_patch(check=check, progress=12)
                if not check.get("available"):
                    message = str(check.get("reason") or "update is unavailable")
                    self._append_update_log(f"Update unavailable: {message}")
                    self._update_state_patch(
                        status="error",
                        progress=12,
                        message=message,
                        ended_at=int(asyncio.get_running_loop().time() * 1000),
                    )
                    return
                if check.get("dirty"):
                    message = "working tree has local changes; update aborted"
                    self._append_update_log(message)
                    self._update_state_patch(
                        status="error",
                        progress=12,
                        message=message,
                        ended_at=int(asyncio.get_running_loop().time() * 1000),
                    )
                    return
                if not check.get("has_update"):
                    self._append_update_log("No update available.")
                    self._update_state_patch(
                        status="up_to_date",
                        progress=100,
                        message="already up-to-date",
                        ended_at=int(asyncio.get_running_loop().time() * 1000),
                    )
                    return

                root = Path.cwd()
                self._append_update_log("Pulling latest commits.")
                self._update_state_patch(progress=28, message="pulling latest commits")
                code, out, err = await self._run_cmd(
                    ["git", "pull", "--ff-only"], cwd=root, timeout=240
                )
                if out:
                    self._append_update_log(out)
                if code != 0:
                    self._append_update_log(err or "git pull failed")
                    self._update_state_patch(
                        status="error",
                        progress=28,
                        message=err or "git pull failed",
                        ended_at=int(asyncio.get_running_loop().time() * 1000),
                    )
                    return

                self._append_update_log("Installing updated package.")
                self._update_state_patch(progress=62, message="installing package")
                code, out, err = await self._run_cmd(
                    [sys.executable, "-m", "pip", "install", "-e", ".[scheduler]"],
                    cwd=root,
                    timeout=600,
                )
                if code != 0:
                    self._append_update_log(
                        "Install with scheduler extra failed, retrying with -e ."
                    )
                    code, out, err = await self._run_cmd(
                        [sys.executable, "-m", "pip", "install", "-e", "."],
                        cwd=root,
                        timeout=600,
                    )
                if out:
                    self._append_update_log(out)
                if code != 0:
                    self._append_update_log(err or "pip install failed")
                    self._update_state_patch(
                        status="error",
                        progress=62,
                        message=err or "pip install failed",
                        ended_at=int(asyncio.get_running_loop().time() * 1000),
                    )
                    return

                self._append_update_log("Update succeeded. Restarting process.")
                self._update_state_patch(
                    status="restarting",
                    progress=100,
                    message="update applied, restarting process",
                    ended_at=int(asyncio.get_running_loop().time() * 1000),
                )
                if self.restart_process_handler is None:
                    self._update_state_patch(
                        status="success",
                        message="update finished (restart unavailable)",
                    )
                    return
                await self.restart_process_handler()
            except Exception as exc:
                logger.error("[api_aggregator] update failed: %s", exc)
                self._append_update_log(f"Update failed: {exc}")
                self._update_state_patch(
                    status="error",
                    message=f"update failed: {exc}",
                    ended_at=int(asyncio.get_running_loop().time() * 1000),
                )
