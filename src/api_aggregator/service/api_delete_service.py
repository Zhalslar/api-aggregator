from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..entry import APIEntryManager


@dataclass
class DeleteResult:
    ok: bool
    status: int
    message: str
    data: dict[str, Any]


class ApiDeleteService:
    """Handle explicit batch delete semantics."""

    def __init__(self, api_mgr: APIEntryManager) -> None:
        self.api_mgr = api_mgr

    def delete_by_names(self, names: list[str]) -> DeleteResult:
        if not names:
            return DeleteResult(
                ok=False,
                status=400,
                message="missing api names",
                data={},
            )

        success, failed = self.api_mgr.remove_entries(names)
        data = {"requested": names, "deleted": success, "failed": failed}

        if not success:
            if len(names) == 1:
                missing = failed[0] if failed else names[0]
                return DeleteResult(
                    ok=False,
                    status=404,
                    message=f"api not found: {missing}",
                    data={},
                )
            return DeleteResult(
                ok=False,
                status=404,
                message="no apis were deleted",
                data={},
            )

        return DeleteResult(
            ok=True,
            status=200,
            message="apis deleted" if not failed else "apis deleted partially",
            data=data,
        )
