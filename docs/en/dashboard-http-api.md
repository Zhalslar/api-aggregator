# Dashboard HTTP API (Current Implementation)

This document maps to `src/api_aggregator/dashboard/server.py`.

## 1. Conventions

- Default base URL: `http://127.0.0.1:4141`
- Recommended shell variable:

```bash
BASE="http://127.0.0.1:4141"
```

Unified JSON response shape:

```json
{
  "status": "ok | error",
  "message": "",
  "data": {}
}
```

Most write APIs are batch-oriented (`/batch`).

## 2. Route Index

| Category | Method | Path |
| --- | --- | --- |
| Page | GET | `/` |
| Page | GET | `/page.css` |
| Page | GET | `/i18n.js` |
| Page | GET | `/logo.png` |
| Page | GET | `/assets/{path}` |
| Page | GET | `/editor/site-form.html` |
| Page | GET | `/editor/api-form.html` |
| Pool | GET | `/api/pool` |
| Pool files | GET | `/api/pool/files` |
| Pool files | POST | `/api/pool/files/delete` |
| Pool query | GET | `/api/pool/sorted` |
| Pool export | GET | `/api/pool/export/{pool_type}` |
| Pool export | POST | `/api/pool/export/{pool_type}` |
| Pool import | POST | `/api/pool/import/{pool_type}` |
| Pool import | POST | `/api/pool/import/{pool_type}/path` |
| Site | POST | `/api/site/batch` |
| Site | PUT | `/api/site/batch` |
| Site | DELETE | `/api/site/batch` |
| API | POST | `/api/api/batch` |
| API | PUT | `/api/api/batch` |
| API | DELETE | `/api/api/batch` |
| Test | GET | `/api/test/stream` |
| Test | POST | `/api/test/preview/batch` |
| Local data | GET | `/api/local-file` |
| Local data | GET | `/api/local-data` |
| Local data | POST | `/api/local-data/items/batch` |
| Local data | DELETE | `/api/local-data/batch` |
| Local data | DELETE | `/api/local-data-item/batch` |
| System | POST | `/api/system/restart` |
| System | POST | `/api/system/restart/full` |
| Update | POST | `/api/system/update/check` |
| Update | POST | `/api/system/update/start` |
| Update | GET | `/api/system/update/status` |

## 3. Page and Static Assets

### GET `/`

```bash
curl "$BASE/"
```

### GET `/assets/{path}`

```bash
curl "$BASE/assets/js/page.js"
```

Notes:

- Access is restricted to the dashboard `assets` root.
- Out-of-root path returns `403`; missing file returns `404`.

## 4. Pool and Pool File APIs

### GET `/api/pool`

Returns runtime site/api pools and default pool file directory.

```bash
curl "$BASE/api/pool"
```

`data` fields:

- `sites`: site list with `api_count`
- `apis`: api list
- `pool_io_default_dir`: absolute default directory path
- `boot_id`: current process boot id

### GET `/api/pool/files`

```bash
curl "$BASE/api/pool/files"
```

### POST `/api/pool/files/delete`

```bash
curl -X POST "$BASE/api/pool/files/delete" \
  -H "Content-Type: application/json" \
  -d '{"names":["api_pool_default.json"]}'
```

### GET `/api/pool/sorted`

```bash
curl "$BASE/api/pool/sorted?site_sort=name_asc&api_sort=valid_first&site_page=1&api_page=1&site_page_size=20&api_page_size=20&site_search=demo&api_search=weather&api_site=FAPI"
```

Site query params:

- `site_sort`: `name_asc|name_desc|url_asc|url_desc|timeout_asc|timeout_desc|api_count_asc|api_count_desc|enabled_first|disabled_first`
- `site_search`, `site_page`, `site_page_size`

API query params:

- `api_sort`: `name_asc|name_desc|url_asc|url_desc|type_asc|type_desc|valid_first|invalid_first|keywords_desc`
- `api_search`, `api_page`, `api_page_size`
- `api_site` (repeatable) or `api_sites` (CSV)

### Pool export/import

`pool_type`: `site|sites|site_pool|api|apis|api_pool`

GET export as download:

```bash
curl -L "$BASE/api/pool/export/api" -o api_pool_export.json
```

POST export to custom path:

```bash
curl -X POST "$BASE/api/pool/export/site" \
  -H "Content-Type: application/json" \
  -d '{"path":"pool_files/custom_site.json"}'
```

POST import from upload/json/raw body:

```bash
curl -X POST "$BASE/api/pool/import/api" \
  -H "Content-Type: application/json" \
  -d '{"content":"[{\"name\":\"demo\",\"url\":\"https://example.com\"}]"}'
```

POST import from default directory by file name:

```bash
curl -X POST "$BASE/api/pool/import/site/path" \
  -H "Content-Type: application/json" \
  -d '{"name":"builtin_sites.json"}'
```

## 5. Site Batch APIs

### POST `/api/site/batch`

```bash
curl -X POST "$BASE/api/site/batch" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"name":"demo-site","url":"https://api.example.com","enabled":true,"headers":{},"keys":{},"timeout":60}]}'
```

### PUT `/api/site/batch`

```bash
curl -X PUT "$BASE/api/site/batch" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"name":"demo-site","payload":{"timeout":90}}]}'
```

### DELETE `/api/site/batch`

```bash
curl -X DELETE "$BASE/api/site/batch" \
  -H "Content-Type: application/json" \
  -d '{"names":["demo-site"]}'
```

## 6. API Batch APIs

### POST `/api/api/batch`

```bash
curl -X POST "$BASE/api/api/batch" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"name":"quote","url":"https://api.example.com/quote","type":"text","params":{},"parse":"","enabled":true,"scope":[],"keywords":["quote"],"cron":"","valid":true}]}'
```

### PUT `/api/api/batch`

```bash
curl -X PUT "$BASE/api/api/batch" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"name":"quote","payload":{"keywords":["quote","daily"]}}]}'
```

### DELETE `/api/api/batch`

```bash
curl -X DELETE "$BASE/api/api/batch" \
  -H "Content-Type: application/json" \
  -d '{"names":["quote"]}'
```

## 7. Test APIs

### GET `/api/test/stream`

NDJSON streaming endpoint.

```bash
curl -N "$BASE/api/test/stream?name=quote&site=FAPI&query=weather"
```

Params:

- `name` repeatable
- `site` repeatable, or `sites` CSV
- `query` matches `name/url/keywords`

### POST `/api/test/preview/batch`

```bash
curl -X POST "$BASE/api/test/preview/batch" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"name":"preview_1","url":"https://api.example.com/a","type":"text"}]}'
```

## 8. Local Data APIs

### GET `/api/local-file?path=...`

```bash
curl "$BASE/api/local-file?path=image/wallpaper/wallpaper_0_abcd1234.jpg" --output demo.jpg
```

### GET `/api/local-data`

```bash
curl "$BASE/api/local-data?page=1&page_size=20&search=quote&sort=updated_desc&type=text&type=image"
```

Sort values:

- `name_asc|name_desc|type_asc|type_desc|count_asc|count_desc|size_asc|size_desc|updated_asc|updated_desc`

### POST `/api/local-data/items/batch`

```bash
curl -X POST "$BASE/api/local-data/items/batch" \
  -H "Content-Type: application/json" \
  -d '{"targets":[{"type":"text","name":"quote"}]}'
```

### DELETE `/api/local-data/batch`

```bash
curl -X DELETE "$BASE/api/local-data/batch" \
  -H "Content-Type: application/json" \
  -d '{"targets":[{"type":"text","name":"quote"}]}'
```

### DELETE `/api/local-data-item/batch`

Text item delete by index:

```bash
curl -X DELETE "$BASE/api/local-data-item/batch" \
  -H "Content-Type: application/json" \
  -d '{"targets":[{"type":"text","name":"quote","items":[{"index":0}]}]}'
```

Binary item delete by relative path:

```bash
curl -X DELETE "$BASE/api/local-data-item/batch" \
  -H "Content-Type: application/json" \
  -d '{"targets":[{"type":"image","name":"wallpaper","items":[{"path":"image/wallpaper/wallpaper_0_abcd1234.jpg"}]}]}'
```

## 9. System and Update APIs

### POST `/api/system/restart`

Restart core services in-place.

```bash
curl -X POST "$BASE/api/system/restart"
```

### POST `/api/system/restart/full`

Schedule full Python process restart.

```bash
curl -X POST "$BASE/api/system/restart/full"
```

### POST `/api/system/update/check`

```bash
curl -X POST "$BASE/api/system/update/check"
```

### POST `/api/system/update/start`

```bash
curl -X POST "$BASE/api/system/update/start"
```

### GET `/api/system/update/status`

```bash
curl "$BASE/api/system/update/status"
```

## 10. Common Status Codes

- `400`: invalid payload/body/query
- `403`: out-of-root file path access
- `404`: resource not found
- `409`: restart/update already in progress
- `500`: internal failure
- `503`: restart handler unavailable

## 11. Migration Note

Legacy routes such as `/api/site`, `/api/api`, and `/api/test/preview` are not part of the current implementation. Use `/batch` routes.
