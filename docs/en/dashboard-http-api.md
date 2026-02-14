# Dashboard HTTP API (Route-by-Route curl)

This document maps directly to handlers in `src/api_aggregator/dashboard/server.py`.

## Base

- Default URL: `http://127.0.0.1:4141`
- Optional shell variable:

```bash
BASE="http://127.0.0.1:4141"
```

## Common Response

Success:

```json
{"status":"ok","message":"","data":{}}
```

Error:

```json
{"status":"error","message":"error detail","data":{}}
```

## Pages and Static Assets

### `GET /` (`index`)

```bash
curl "$BASE/"
```

### `GET /page.css` (`styles`)

```bash
curl "$BASE/page.css"
```

### `GET /i18n.js` (`i18n_script`)

```bash
curl "$BASE/i18n.js"
```

### `GET /logo.png` (`logo`)

```bash
curl "$BASE/logo.png" --output logo.png
```

### `GET /assets/{path}` (`asset_file`)

```bash
curl "$BASE/assets/js/page.js"
```

### `GET /editor/site-form.html` (`site_form`)

```bash
curl "$BASE/editor/site-form.html"
```

### `GET /editor/api-form.html` (`api_form`)

```bash
curl "$BASE/editor/api-form.html"
```

## Pool APIs

### `GET /api/pool` (`get_pool`)

```bash
curl "$BASE/api/pool"
```

### `GET /api/pool/sorted` (`get_pool_sorted`)

```bash
curl "$BASE/api/pool/sorted?site_sort=enabled_first&api_sort=valid_first"
```

## Site APIs

### `POST /api/site` (`create_site`)

```bash
curl -X POST "$BASE/api/site" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"site-a",
    "url":"https://api.example.com",
    "enabled":true,
    "headers":{"User-Agent":"demo"},
    "keys":{},
    "timeout":60
  }'
```

### `PUT /api/site/{name}` (`update_site`)

```bash
curl -X PUT "$BASE/api/site/site-a" \
  -H "Content-Type: application/json" \
  -d '{"timeout":90,"enabled":true}'
```

### `DELETE /api/site/{name}` (`delete_site`)

```bash
curl -X DELETE "$BASE/api/site/site-a"
```

## API Entry APIs

### `POST /api/api` (`create_api`)

```bash
curl -X POST "$BASE/api/api" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"quote",
    "url":"https://api.example.com/quote",
    "type":"text",
    "params":{"lang":"en"},
    "parse":"data.content",
    "enabled":true,
    "scope":[],
    "keywords":["quote"],
    "cron":"0 * * * *",
    "valid":true
  }'
```

### `PUT /api/api/{name}` (`update_api`)

```bash
curl -X PUT "$BASE/api/api/quote" \
  -H "Content-Type: application/json" \
  -d '{"keywords":["quote","daily"],"enabled":true}'
```

### `DELETE /api/api/{name}` (`delete_api`)

```bash
curl -X DELETE "$BASE/api/api/quote"
```

## Test APIs

### `GET /api/test/stream` (`test_api_stream`)

```bash
curl -N "$BASE/api/test/stream?name=quote&name=weather"
```

### `POST /api/test/preview` (`test_api_preview`)

```bash
curl -X POST "$BASE/api/test/preview" \
  -H "Content-Type: application/json" \
  -d '{"name":"quote","url":"https://api.example.com/quote","type":"text"}'
```

## Local Data APIs

### `GET /api/local-file?path=...` (`local_file`)

```bash
curl "$BASE/api/local-file?path=image/wallpaper/wallpaper_0_abcd1234.jpg" \
  --output demo.jpg
```

### `GET /api/local-data` (`get_local_data`)

```bash
curl "$BASE/api/local-data"
```

### `GET /api/local-data/{data_type}/{name}` (`get_local_data_items`)

```bash
curl "$BASE/api/local-data/text/quote"
```

### `DELETE /api/local-data/{data_type}/{name}` (`delete_local_data`)

```bash
curl -X DELETE "$BASE/api/local-data/text/quote"
```

### `DELETE /api/local-data-item` (`delete_local_data_item`)

```bash
curl -X DELETE "$BASE/api/local-data-item" \
  -H "Content-Type: application/json" \
  -d '{"type":"text","name":"quote","items":[{"index":0},{"index":2}]}'
```

## System API

### `POST /api/system/restart` (`restart_system`)

```bash
curl -X POST "$BASE/api/system/restart"
```
