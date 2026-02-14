# API / 数据结构手册

本文说明 `site_pool.json` 与 `api_pool.json` 的字段定义、默认值和约束。

## 文件位置

- 运行时数据目录：`<data_dir>/`
- 站点池：`<data_dir>/site_pool.json`
- API 池：`<data_dir>/api_pool.json`

默认情况下，`data_dir` 由 `APIConfig` 指向 `src/api_aggregator/data`（可在初始化时自定义）。

## 结构总览

两个文件都采用 JSON 数组：

```json
[
  { "...": "..." },
  { "...": "..." }
]
```

- 每个元素代表 1 条配置项。
- 非数组内容会被视为无效并回退为空列表。

## site_pool.json

### 单条结构

```json
{
  "__template_key": "default",
  "name": "example-site",
  "url": "https://api.example.com",
  "enabled": true,
  "headers": {
    "User-Agent": "custom-client/1.0"
  },
  "keys": {
    "token": "your-token"
  },
  "timeout": 60
}
```

### 字段说明

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `__template_key` | `string` | 否 | `"default"` | 模板标记，系统内部使用。 |
| `name` | `string` | 是 | 无 | 站点名。必须非空；重复时会自动改名为 `name_2`、`name_3`。 |
| `url` | `string` | 是 | 无 | 站点根地址前缀，用于匹配 API URL。 |
| `enabled` | `boolean` | 否 | `true` | 是否启用该站点配置。 |
| `headers` | `object<string,string>` | 否 | `{}` | 请求头附加项。 |
| `keys` | `object<string,string>` | 否 | `{}` | 鉴权/密钥参数，会同时注入 headers 与 params。 |
| `timeout` | `number` | 否 | `60` | 请求超时秒数。 |

### 行为规则

- `url` 匹配逻辑是“前缀匹配”（`startswith`）。
- 命中站点后：`headers` 与 `keys` 会参与请求参数构建。

## api_pool.json

### 单条结构

```json
{
  "name": "daily_quote",
  "url": "https://api.example.com/quote",
  "type": "text",
  "params": {
    "lang": "zh"
  },
  "parse": "data.content",
  "enabled": true,
  "scope": ["admin", "group_123"],
  "keywords": ["每日一言", "quote"],
  "cron": "0 * * * *",
  "valid": true,
  "template": "default",
  "__template_key": "default"
}
```

### 字段说明

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | `string` | 是 | 无 | API 名称。必须非空；重复时自动改名。 |
| `url` | `string` | 是 | 无 | API 请求地址。 |
| `type` | `string` | 否 | `"text"` | 数据类型：`text` / `image` / `video` / `audio`。 |
| `params` | `object` | 否 | `{}` | 查询参数。非对象会被归一化为 `{}`。 |
| `parse` | `string` | 否 | `""` | JSON 嵌套提取规则（如 `data.content`）。 |
| `enabled` | `boolean` | 否 | `true` | 是否启用。支持字符串布尔归一化。 |
| `scope` | `string[]` | 否 | `[]` | 权限范围：可放 `admin`、用户ID、群ID、会话ID。 |
| `keywords` | `string[]` | 否 | `[name]` | 正则关键词列表；空字符串会被过滤。 |
| `cron` | `string` | 否 | `""` | 5 段 crontab 表达式。 |
| `valid` | `boolean` | 否 | `true` | 业务有效标记（测试接口可更新）。 |
| `template` | `string` | 否 | `"default"` | 模板名（Dashboard 维护用）。 |
| `__template_key` | `string` | 否 | 跟随 `template` | 模板键（Dashboard 维护用）。 |

### 归一化规则（新增/编辑时）

- `enabled` / `valid`：支持 `"true"`、`"false"`、`"1"`、`"0"` 等输入。
- `scope`：
  - 传数组 -> 过滤空字符串后保留。
  - 传字符串 -> 转为单元素数组。
  - 其他 -> `[]`。
- `keywords`：同 `scope`，默认 `[name]`。
- `params`：仅接受对象，其他类型回退 `{}`。

## 最小可用示例

### site_pool.json

```json
[
  {
    "name": "default-site",
    "url": "https://api.example.com",
    "enabled": true,
    "headers": {},
    "keys": {},
    "timeout": 60
  }
]
```

### api_pool.json

```json
[
  {
    "name": "quote",
    "url": "https://api.example.com/quote",
    "type": "text",
    "params": {},
    "parse": "",
    "enabled": true,
    "scope": [],
    "keywords": ["quote"],
    "cron": "",
    "valid": true
  }
]
```

## 常见错误

1. `name` 或 `url` 为空
- 新增/更新会失败，返回错误信息。

2. `scope` 写成对象 `{}`
- 会导致匹配逻辑异常。请使用数组 `[]`。

3. `type` 非法
- 仅支持 `text/image/video/audio`，否则在构建 `APIEntry` 时抛错。

