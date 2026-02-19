# Changelog

All notable changes to this project will be documented in this file.

## [0.1.1] - 2026-02-16

### Changed
- Switched to standard `src` layout.
- Renamed package from `api_aggregator_core` to `apicore`.
- Updated CI/docs/tests to use the new package path.
- Set publish package name to `api-aggregator` and repository to `https://github.com/Zhalslar/api-aggregator`.
- Scheduler now degrades gracefully when `APScheduler` is unavailable (cron disabled, core features still run).
- Moved `APScheduler` to optional dependency group `scheduler` (still included by default via `requirements.txt`).
- Added multilingual documentation with Chinese as the default README and a dedicated English README (`README.en.md`).
- Overhauled README styling and content completeness (logo header, badges, TOC, quick start, config table, dev/release workflow, FAQ).
- Added missing docs: API/data schema manual and Dashboard HTTP API manual under `docs/zh-CN/`.
- Renamed import package from `apicore` to `api_aggregator` for naming consistency with distribution `api-aggregator`.
- Removed config-level `need_prefix/save_data/use_local`; data is now always persisted, and local fallback is controlled per request via `DataService.fetch(..., use_local=...)`.

### Fixed
- Corrected API entry default value normalization in `APIEntryManager.add_entry`.
  - `enabled` now defaults to boolean `True`.
  - `scope` now defaults to list `[]`.
  - `keywords` and `params` are normalized to expected data structures.
  - string booleans such as `"false"` and `"0"` are parsed correctly.

### Added
- `requirements.txt` for runtime dependencies.
- `pyproject.toml` for lint/test tool configuration.
- `tests/test_api_entry_manager.py` regression tests for add-entry normalization.
- Initial `README.md` and release checklist.


## [0.1.2] - 2026-02-19

### Added
- Auto-import default pool files on first startup when pools are empty; write marker files in the data directory to prevent repeated imports.

## [0.1.3] - 2026-02-19

### Added
- Added `APICoreApp.load_site_pool_from_file(...)` and `APICoreApp.load_api_pool_from_file(...)` for loading pool files by explicit path.

### Removed
- Removed one-time auto-import of default pool files during `APICoreApp.start()`.
