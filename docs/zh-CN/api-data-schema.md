# API / 数据结构手册（当前实现）

本文按代码实现说明数据模型与落盘结构，覆盖以下模块：

- `src/api_aggregator/model.py`
- `src/api_aggregator/database.py`
- `src/api_aggregator/data_service/local_data.py`
- `src/api_aggregator/service/pool_io_service.py`

## 1. 数据总览

运行时主要数据分三层：

1. 池元数据（SQLite）
- 文件：`data/api_aggregator.db`
- 表：`site_pool`、`api_pool`
- 每行使用 JSON 字符串存储完整 payload。

2. 本地内容缓存（文件系统）
- 根目录：`data/local/`
- 子目录：`text/`、`image/`、`video/`、`audio/`

3. 池导入导出文件（JSON）
- 默认目录：`pool_files/`
- 用于导入导出，不是主存储。

## 2. Site 数据模型

### 2.1 字段定义

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | `string` | 是 | 无 | 站点名称，唯一。 |
| `url` | `string` | 是 | 无 | 站点前缀 URL，用于匹配 API 所属站点。 |
| `enabled` | `boolean` | 否 | `true` | 是否启用。 |
| `headers` | `object` | 否 | `{}` | 请求头附加项。 |
| `keys` | `object` | 否 | `{}` | 会同时注入请求 header 和 query params。 |
| `timeout` | `number` | 否 | `60` | 请求超时（秒）。 |

示例：

```json
{
  "name": "FAPI",
  "url": "https://api.lolimi.cn",
  "enabled": true,
  "headers": {},
  "keys": {},
  "timeout": 60
}
```

### 2.2 行为规则

- `SiteEntry.is_vested(full_url)` 使用前缀匹配：`full_url.startswith(site.url)`。
- 若 API URL 命中站点：
  - 请求 headers 使用站点 headers（无命中时用全局默认 headers）。
  - `keys` 会合并进 headers 和 params。
  - 超时使用站点 timeout（无命中时用全局默认 timeout）。

## 3. API 数据模型

### 3.1 字段定义

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | `string` | 是 | 无 | API 名称，唯一。 |
| `url` | `string` | 是 | 无 | 请求地址。 |
| `type` | `string` | 否 | `"text"` | `text/image/video/audio`。 |
| `params` | `object` | 否 | `{}` | 请求参数。 |
| `parse` | `string` | 否 | `""` | JSON 路径提取规则。 |
| `enabled` | `boolean` | 否 | `true` | 开关。 |
| `scope` | `string[]` | 否 | `[]` | 作用域限制（admin/user/group/session）。 |
| `keywords` | `string[]` | 否 | `[name]` | 正则触发词。 |
| `cron` | `string` | 否 | `""` | 5 段 cron 表达式。 |
| `valid` | `boolean` | 否 | `true` | 业务有效性标记（测试后可更新）。 |
| `site` | `string` | 否 | `""` | 所属站点名（自动解析/同步）。 |

示例：

```json
{
  "name": "quote",
  "url": "https://api.example.com/quote",
  "type": "text",
  "params": {"lang": "zh"},
  "parse": "data.content",
  "enabled": true,
  "scope": [],
  "keywords": ["quote"],
  "cron": "0 * * * *",
  "valid": true,
  "site": "FAPI"
}
```

### 3.2 触发规则（消息匹配）

`APIEntry.check_activate(...)` 必须同时满足：

1. `enabled=true`
2. `valid=true`
3. scope 放行
4. `keywords` 任一正则命中

### 3.3 归一化规则

- 布尔字段支持字符串归一化：`true/false/1/0/yes/no/on/off`。
- `scope/keywords`：
  - 数组 -> 过滤空字符串
  - 字符串 -> 单元素数组
  - 其他 -> 空数组
- `keywords` 空时默认回填 `[name]`。
- `type` 非法时，运行时会回退到 `text`。

## 4. SQLite 存储结构

数据库：`data/api_aggregator.db`

表结构：

- `site_pool(pos INTEGER PRIMARY KEY, name TEXT UNIQUE, payload TEXT)`
- `api_pool(pos INTEGER PRIMARY KEY, name TEXT UNIQUE, payload TEXT)`

说明：

- `payload` 为 JSON 字符串，存完整对象。
- `pos` 保留顺序。
- 批量更新采用 upsert + delete names。

## 5. 本地数据结构（data/local）

## 5.1 文本类型（text）

路径：`data/local/text/{name}.json`

- 内容：字符串数组
- 去重索引：`data/local/text/{name}.index.json`

示例：

```json
[
  "第一条文本",
  "第二条文本"
]
```

索引示例：

```json
{
  "version": 1,
  "source_mtime_ns": 1739586000000000000,
  "source_size": 128,
  "hashes": ["..."]
}
```

## 5.2 二进制类型（image/video/audio）

目录：`data/local/{type}/{name}/`

- 数据文件命名：`{name}_{seq}_{hash8}.{ext}`
- 去重索引：`data/local/{type}/{name}/.index.json`

索引示例：

```json
{
  "version": 1,
  "hash_to_file": {
    "<sha256>": "wallpaper_0_abcd1234.jpg"
  }
}
```

## 6. 池导入导出文件结构（pool_files）

导出目标：JSON 数组，每个元素是一条 Site 或 API。

关键规则：

- 导出时会去掉部分运行态字段：
  - Site：移除 `enabled`
  - API：移除 `enabled`、`valid`、`site`
- 导入时会自动归一化并跳过重名。
- 仅支持 `.json` 文件。

## 7. Dashboard 批量请求体模型

## 7.1 `ItemsBatch`

```json
{"items": [{"...": "..."}]}
```

用于新增与预览测试。

## 7.2 `UpdateItemsBatch`

```json
{
  "items": [
    {"name": "target_name", "payload": {"field": "new_value"}}
  ]
}
```

用于批量更新。

## 7.3 `NamesBatch`

```json
{"names": ["name_a", "name_b"]}
```

用于按名称批量删除 Site/API。

## 7.4 `TargetsBatch`

```json
{
  "targets": [
    {"type": "text", "name": "quote"},
    {"type": "image", "name": "wallpaper", "items": [{"path": "..."}]}
  ]
}
```

用于本地集合查询/删除、集合内条目删除。

## 8. 常见数据错误与排查

1. `site name/url` 或 `api name/url` 为空
- 触发 `ValueError`，接口返回 `status=error`。

2. `items/names/targets` 结构不符合批量模型
- 常见于传了对象而不是数组，返回 `400`。

3. 本地文件访问越界
- `GET /api/local-file` 或 `/assets/*` 非法路径会返回 `403`。

4. 导入文件不是 JSON 数组
- 返回 `import file must be a JSON array`。

5. API type 填写非法
- 存储可写入，但运行时会降级为 `text`，导致预期类型不一致。
