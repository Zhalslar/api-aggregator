from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

try:
    from api_aggregator import APICoreApp
except ModuleNotFoundError:
    # Fallback for source tree runs without editable install.
    sys.path.insert(0, str(Path(__file__).parent / "src"))
    from api_aggregator import APICoreApp


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Start api-aggregator runtime.")
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=None,
        help="Data directory path (default: src/api_aggregator/data).",
    )
    parser.add_argument(
        "--dashboard-host",
        default="0.0.0.0",
        help="Dashboard bind host (default: 0.0.0.0).",
    )
    parser.add_argument(
        "--dashboard-port",
        type=int,
        default=4141,
        help="Dashboard port (default: 4141).",
    )
    parser.add_argument(
        "--no-dashboard",
        action="store_true",
        help="Disable dashboard server.",
    )
    return parser.parse_args()


async def amain() -> None:
    args = parse_args()
    app = APICoreApp(data_dir=args.data_dir)
    app.cfg.dashboard.host = args.dashboard_host
    app.cfg.dashboard.port = args.dashboard_port

    if args.no_dashboard:
        app.cfg.dashboard.enabled = False
        app.dashboard_enabled = False
        app.dashboard = None

    await app.run_forever()


def main() -> None:
    asyncio.run(amain())


if __name__ == "__main__":
    main()
