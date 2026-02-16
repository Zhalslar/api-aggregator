from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable


class RestartUnavailableError(Exception):
    """Raised when restart handler is not configured."""


class RestartInProgressError(Exception):
    """Raised when restart task is already running."""


class RuntimeControlService:
    """Control runtime operations such as core-service restart."""

    def __init__(
        self,
        restart_handler: Callable[[], Awaitable[None]] | None = None,
        restart_process_handler: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        self.restart_handler = restart_handler
        self.restart_process_handler = restart_process_handler
        self._restart_lock = asyncio.Lock()
        self._process_restart_lock = asyncio.Lock()

    def is_restarting(self) -> bool:
        return self._restart_lock.locked()

    async def restart_system(self) -> None:
        if self.restart_handler is None:
            raise RestartUnavailableError("restart handler is not configured")
        if self._restart_lock.locked():
            raise RestartInProgressError("restart already in progress")
        async with self._restart_lock:
            await self.restart_handler()

    async def restart_process_async(self, delay_seconds: float = 0.2) -> None:
        if self.restart_process_handler is None:
            raise RestartUnavailableError("process restart handler is not configured")
        if self._process_restart_lock.locked():
            raise RestartInProgressError("process restart already in progress")

        async def _run() -> None:
            async with self._process_restart_lock:
                await asyncio.sleep(max(0.0, float(delay_seconds)))
                await self.restart_process_handler()

        asyncio.create_task(_run())
