# Dashboard HTTP API（按当前代码实现）

本文档与 `src/api_aggregator/dashboard/server.py` 一一对应，覆盖 Dashboard 对外 HTTP 接口。

## 1. 基础约定

- 默认地址：`http://127.0.0.1:4141`
- 建议先设置：

```bash
BASE="http://127.0.0.1:4141"
```

统一响应：

```json
{
  "status": "ok | error",
  "message": "",
  "data": {}
}
```

说明：

- `status=ok` 不代表业务一定有数据，只表示请求被正常处理。
- 绝大部分写操作都为批量风格（`/batch`）。

## 2. 路由总览

| 分类 | Method | Path |
| --- | --- | --- |
| 页面 | GET | `/` |
| 页面 | GET | `/page.css` |
| 页面 | GET | `/i18n.js` |
| 页面 | GET | `/logo.png` |
| 页面 | GET | `/assets/{path}` |
| 页面 | GET | `/editor/site-form.html` |
| 页面 | GET | `/editor/api-form.html` |
| 池数据 | GET | `/api/pool` |
| 池文件 | GET | `/api/pool/files` |
| 池文件 | POST | `/api/pool/files/delete` |
| 池查询 | GET | `/api/pool/sorted` |
| 池导出 | GET | `/api/pool/export/{pool_type}` |
| 池导出 | POST | `/api/pool/export/{pool_type}` |
| 池导入 | POST | `/api/pool/import/{pool_type}` |
| 池导入 | POST | `/api/pool/import/{pool_type}/path` |
| Site | POST | `/api/site/batch` |
| Site | PUT | `/api/site/batch` |
| Site | DELETE | `/api/site/batch` |
| API | POST | `/api/api/batch` |
| API | PUT | `/api/api/batch` |
| API | DELETE | `/api/api/batch` |
| 测试 | GET | `/api/test/stream` |
| 测试 | POST | `/api/test/preview/batch` |
| 本地数据 | GET | `/api/local-file` |
| 本地数据 | GET | `/api/local-data` |
| 本地数据 | POST | `/api/local-data/items/batch` |
| 本地数据 | DELETE | `/api/local-data/batch` |
| 本地数据 | DELETE | `/api/local-data-item/batch` |
| 系统 | POST | `/api/system/restart` |
| 系统 | POST | `/api/system/restart/full` |
| 更新 | POST | `/api/system/update/check` |
| 更新 | POST | `/api/system/update/start` |
| 更新 | GET | `/api/system/update/status` |

## 3. 页面与静态资源

### GET `/`

```bash
curl "$BASE/"
```

### GET `/assets/{path}`

```bash
curl "$BASE/assets/js/page.js"
```

说明：

- 仅允许访问 Dashboard `assets` 根目录内文件。
- 路径越界返回 `403`，不存在返回 `404`。

## 4. 池数据与池文件

### 4.1 当前池快照

### GET `/api/pool`

返回当前站点池、API 池，以及默认导入导出目录。

```bash
curl "$BASE/api/pool"
```

返回数据字段（`data`）：

- `sites`: Site 列表（附 `api_count`）
- `apis`: API 列表
- `pool_io_default_dir`: 默认池文件目录绝对路径
- `boot_id`: 当前进程启动标识

### 4.2 默认目录文件管理

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

请求体：

```json
{"names": ["file-a.json", "file-b.json"]}
```

### 4.3 排序/筛选/分页查询

### GET `/api/pool/sorted`

```bash
curl "$BASE/api/pool/sorted?site_sort=name_asc&api_sort=valid_first&site_page=1&api_page=1&site_page_size=20&api_page_size=20&site_search=demo&api_search=weather&api_site=倾梦API&api_site=FAPI"
```

参数：

- Site 相关：
  - `site_sort`: `name_asc|name_desc|url_asc|url_desc|timeout_asc|timeout_desc|api_count_asc|api_count_desc|enabled_first|disabled_first`
  - `site_search`
  - `site_page`（>=1）
  - `site_page_size`（整数或 `all`）
- API 相关：
  - `api_sort`: `name_asc|name_desc|url_asc|url_desc|type_asc|type_desc|valid_first|invalid_first|keywords_desc`
  - `api_search`
  - `api_page`（>=1）
  - `api_page_size`（整数或 `all`）
  - `api_site`（可重复）或 `api_sites`（逗号分隔）

### 4.4 导出

`pool_type` 支持：`site|sites|site_pool|api|apis|api_pool`

### GET `/api/pool/export/{pool_type}`

直接下载导出文件。

```bash
curl -L "$BASE/api/pool/export/api" -o api_pool_export.json
```

可选 query：`path`（导出到指定路径后下载该文件）。

### POST `/api/pool/export/{pool_type}`

导出到指定路径，返回导出文件路径。

```bash
curl -X POST "$BASE/api/pool/export/site" \
  -H "Content-Type: application/json" \
  -d '{"path":"pool_files/custom_site.json"}'
```

可选字段：

- `path`: 目标文件或目录
- `items`: 仅导出指定条目（数组）

### 4.5 导入

### POST `/api/pool/import/{pool_type}`

支持三种输入方式：

- `multipart/form-data` 上传 `file`
- `application/json`，字段 `content`（JSON 字符串）
- 原始请求体字节

JSON 方式示例：

```bash
curl -X POST "$BASE/api/pool/import/api" \
  -H "Content-Type: application/json" \
  -d '{"content":"[{\"name\":\"demo\",\"url\":\"https://example.com\"}]"}'
```

### POST `/api/pool/import/{pool_type}/path`

从默认目录按文件名导入：

```bash
curl -X POST "$BASE/api/pool/import/site/path" \
  -H "Content-Type: application/json" \
  -d '{"name":"builtin_sites.json"}'
```

## 5. Site 批量接口

### POST `/api/site/batch`

```bash
curl -X POST "$BASE/api/site/batch" \
  -H "Content-Type: application/json" \
  -d '{
    "items":[
      {
        "name":"demo-site",
        "url":"https://api.example.com",
        "enabled":true,
        "headers":{"User-Agent":"demo"},
        "keys":{},
        "timeout":60
      }
    ]
  }'
```

### PUT `/api/site/batch`

```bash
curl -X PUT "$BASE/api/site/batch" \
  -H "Content-Type: application/json" \
  -d '{
    "items":[
      {"name":"demo-site","payload":{"timeout":90,"enabled":true}}
    ]
  }'
```

### DELETE `/api/site/batch`

```bash
curl -X DELETE "$BASE/api/site/batch" \
  -H "Content-Type: application/json" \
  -d '{"names":["demo-site"]}'
```

## 6. API 批量接口

### POST `/api/api/batch`

```bash
curl -X POST "$BASE/api/api/batch" \
  -H "Content-Type: application/json" \
  -d '{
    "items":[
      {
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
      }
    ]
  }'
```

### PUT `/api/api/batch`

```bash
curl -X PUT "$BASE/api/api/batch" \
  -H "Content-Type: application/json" \
  -d '{
    "items":[
      {"name":"quote","payload":{"keywords":["quote","每日一言"]}}
    ]
  }'
```

### DELETE `/api/api/batch`

```bash
curl -X DELETE "$BASE/api/api/batch" \
  -H "Content-Type: application/json" \
  -d '{"names":["quote"]}'
```

## 7. 测试接口

### GET `/api/test/stream`

流式返回 `application/x-ndjson; charset=utf-8`。

```bash
curl -N "$BASE/api/test/stream?name=quote&site=倾梦API&query=weather"
```

可选参数：

- `name`：可重复，指定 API 名
- `site`：可重复，按站点过滤
- `sites`：逗号分隔站点列表
- `query`：按 `name/url/keywords` 过滤

事件示例：

```json
{"event":"start","total":2,"completed":0}
{"event":"progress","name":"quote","valid":true,"status":200,"reason":"ok"}
{"event":"done","total":2,"completed":2,"success_count":1,"fail_count":1}
```

### POST `/api/test/preview/batch`

```bash
curl -X POST "$BASE/api/test/preview/batch" \
  -H "Content-Type: application/json" \
  -d '{
    "items":[
      {"name":"preview_1","url":"https://api.example.com/a","type":"text"},
      {"name":"preview_2","url":"https://api.example.com/b","type":"image"}
    ]
  }'
```

## 8. 本地数据接口

### GET `/api/local-file?path=...`

```bash
curl "$BASE/api/local-file?path=image/wallpaper/wallpaper_0_abcd1234.jpg" --output demo.jpg
```

### GET `/api/local-data`

```bash
curl "$BASE/api/local-data?page=1&page_size=20&search=quote&sort=updated_desc&type=text&type=image"
```

参数：

- `page`、`page_size`（整数或 `all`）
- `search`
- `sort`: `name_asc|name_desc|type_asc|type_desc|count_asc|count_desc|size_asc|size_desc|updated_asc|updated_desc`
- `type`（可重复）或 `types`（逗号分隔）

### POST `/api/local-data/items/batch`

```bash
curl -X POST "$BASE/api/local-data/items/batch" \
  -H "Content-Type: application/json" \
  -d '{
    "targets":[
      {"type":"text","name":"quote"},
      {"type":"image","name":"wallpaper"}
    ]
  }'
```

### DELETE `/api/local-data/batch`

```bash
curl -X DELETE "$BASE/api/local-data/batch" \
  -H "Content-Type: application/json" \
  -d '{
    "targets":[
      {"type":"text","name":"quote"}
    ]
  }'
```

### DELETE `/api/local-data-item/batch`

文本项删除（按索引）：

```bash
curl -X DELETE "$BASE/api/local-data-item/batch" \
  -H "Content-Type: application/json" \
  -d '{
    "targets":[
      {"type":"text","name":"quote","items":[{"index":0},{"index":2}]}
    ]
  }'
```

二进制项删除（按 path）：

```bash
curl -X DELETE "$BASE/api/local-data-item/batch" \
  -H "Content-Type: application/json" \
  -d '{
    "targets":[
      {"type":"image","name":"wallpaper","items":[{"path":"image/wallpaper/wallpaper_0_abcd1234.jpg"}]}
    ]
  }'
```

## 9. 系统与更新

### POST `/api/system/restart`

重载核心服务（不重启 Python 进程）。

```bash
curl -X POST "$BASE/api/system/restart"
```

### POST `/api/system/restart/full`

异步重启整个 Python 进程。

```bash
curl -X POST "$BASE/api/system/restart/full"
```

### POST `/api/system/update/check`

检查 git 更新状态。

```bash
curl -X POST "$BASE/api/system/update/check"
```

### POST `/api/system/update/start`

启动后台更新任务（`git pull --ff-only` + `pip install -e` + 进程重启）。

```bash
curl -X POST "$BASE/api/system/update/start"
```

### GET `/api/system/update/status`

```bash
curl "$BASE/api/system/update/status"
```

## 10. 常见状态码

- `400`：请求体结构错误、字段缺失或参数非法
- `403`：文件路径越界（资产或本地文件访问）
- `404`：资源不存在
- `409`：重启/更新任务已在进行中
- `500`：服务内部异常
- `503`：未配置对应重启处理器

## 11. 兼容性说明

旧接口（如 `/api/site`、`/api/api`、`/api/test/preview`）已不在当前实现中，需迁移到 `/batch` 系列接口。
