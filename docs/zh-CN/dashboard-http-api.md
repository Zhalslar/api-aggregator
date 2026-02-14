# Dashboard HTTP API（按路由可复制 curl）

本文档与 `src/api_aggregator/dashboard/server.py` 中的对外 handler 一一对应。

## 基础信息

- 默认地址：`http://127.0.0.1:4141`
- 建议先设置变量：

```bash
BASE="http://127.0.0.1:4141"
```

- JSON 成功响应格式：

```json
{
  "status": "ok",
  "message": "",
  "data": {}
}
```

- JSON 失败响应格式：

```json
{
  "status": "error",
  "message": "error detail",
  "data": {}
}
```

## 页面与静态资源

### `GET /`（`index`）

```bash
curl "$BASE/"
```

### `GET /page.css`（`styles`）

```bash
curl "$BASE/page.css"
```

### `GET /i18n.js`（`i18n_script`）

```bash
curl "$BASE/i18n.js"
```

### `GET /logo.png`（`logo`）

```bash
curl "$BASE/logo.png" --output logo.png
```

### `GET /assets/{path}`（`asset_file`）

```bash
curl "$BASE/assets/js/page.js"
```

### `GET /editor/site-form.html`（`site_form`）

```bash
curl "$BASE/editor/site-form.html"
```

### `GET /editor/api-form.html`（`api_form`）

```bash
curl "$BASE/editor/api-form.html"
```

## 配置池

### `GET /api/pool`（`get_pool`）

```bash
curl "$BASE/api/pool"
```

### `GET /api/pool/sorted`（`get_pool_sorted`）

- `site_sort`：
  `name_asc`(默认)、`name_desc`、`url_asc`、`url_desc`、`timeout_asc`、`timeout_desc`、`enabled_first`、`disabled_first`
- `api_sort`：
  `name_asc`(默认)、`name_desc`、`url_asc`、`url_desc`、`type_asc`、`type_desc`、`valid_first`、`invalid_first`、`keywords_desc`

```bash
curl "$BASE/api/pool/sorted?site_sort=enabled_first&api_sort=valid_first"
```

## Site 管理

### `POST /api/site`（`create_site`）

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

### `PUT /api/site/{name}`（`update_site`）

```bash
curl -X PUT "$BASE/api/site/site-a" \
  -H "Content-Type: application/json" \
  -d '{
    "timeout":90,
    "enabled":true
  }'
```

### `DELETE /api/site/{name}`（`delete_site`）

```bash
curl -X DELETE "$BASE/api/site/site-a"
```

## API 管理

### `POST /api/api`（`create_api`）

```bash
curl -X POST "$BASE/api/api" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"quote",
    "url":"https://api.example.com/quote",
    "type":"text",
    "params":{"lang":"zh"},
    "parse":"data.content",
    "enabled":true,
    "scope":[],
    "keywords":["quote"],
    "cron":"0 * * * *",
    "valid":true
  }'
```

### `PUT /api/api/{name}`（`update_api`）

```bash
curl -X PUT "$BASE/api/api/quote" \
  -H "Content-Type: application/json" \
  -d '{
    "keywords":["quote","每日一言"],
    "enabled":true
  }'
```

### `DELETE /api/api/{name}`（`delete_api`）

```bash
curl -X DELETE "$BASE/api/api/quote"
```

## 测试接口

### `GET /api/test/stream`（`test_api_stream`）

- 事件流类型：`application/x-ndjson`
- `name` 可重复传入；不传时默认测试全部 API。

```bash
curl -N "$BASE/api/test/stream?name=quote&name=weather"
```

示例事件：

```json
{"event":"start","total":2,"completed":0}
{"event":"progress","name":"quote","valid":true,"status":200,"reason":"ok"}
{"event":"done","total":2,"completed":2,"success_count":1,"fail_count":1}
```

### `POST /api/test/preview`（`test_api_preview`）

```bash
curl -X POST "$BASE/api/test/preview" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"quote",
    "url":"https://api.example.com/quote",
    "type":"text"
  }'
```

## 本地数据

### `GET /api/local-file?path=...`（`local_file`）

```bash
curl "$BASE/api/local-file?path=image/wallpaper/wallpaper_0_abcd1234.jpg" \
  --output demo.jpg
```

### `GET /api/local-data`（`get_local_data`）

```bash
curl "$BASE/api/local-data"
```

### `GET /api/local-data/{data_type}/{name}`（`get_local_data_items`）

- `data_type`：`text` / `image` / `video` / `audio`

```bash
curl "$BASE/api/local-data/text/quote"
```

### `DELETE /api/local-data/{data_type}/{name}`（`delete_local_data`）

```bash
curl -X DELETE "$BASE/api/local-data/text/quote"
```

### `DELETE /api/local-data-item`（`delete_local_data_item`）

文本类型示例：

```bash
curl -X DELETE "$BASE/api/local-data-item" \
  -H "Content-Type: application/json" \
  -d '{
    "type":"text",
    "name":"quote",
    "items":[{"index":0},{"index":2}]
  }'
```

二进制类型示例：

```bash
curl -X DELETE "$BASE/api/local-data-item" \
  -H "Content-Type: application/json" \
  -d '{
    "type":"image",
    "name":"wallpaper",
    "items":[{"path":"image/wallpaper/wallpaper_0_abcd1234.jpg"}]
  }'
```

## 系统接口

### `POST /api/system/restart`（`restart_system`）

```bash
curl -X POST "$BASE/api/system/restart"
```

## 常见错误码

- `400`：参数缺失、JSON 体非对象、字段不合法
- `403`：路径越界（资产或本地文件访问）
- `404`：资源不存在
- `409`：重启已在进行中
- `500`：重启失败或内部错误
