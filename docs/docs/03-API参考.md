IotEdgeDB 提供全面的 REST API，用于数据写入、查询和管理。

## 基本 URL
```plain
http://localhost:8000
```

## 验证
所有接口（公共接口除外）都需要身份验证。IEDB 支持多种身份验证方法，以兼容各种客户端：

### Bearear Token（标准版）
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:8000/api/v1/query
```

### Token Header（InfluxDB 2.x 样式）
```bash
curl -H "Authorization: Token YOUR_TOKEN" http://localhost:8000/api/v1/query
```

### API Key Header
```bash
curl -H "x-api-key: YOUR_TOKEN" http://localhost:8000/api/v1/query
```

### 公共接口（无需身份验证）
+ `GET /health`-健康检查
+ `GET /ready`-  k8s检查
+ `GET /metrics`- 指标监控
+ `GET /api/v1/auth/verify`- token 验证

## 快速示例
### 写入数据（messagePack）
```python
import msgpack
import requests

data = {
    "m": "cpu",
    "columns": {
        "time": [1697472000000],
        "host": ["server01"],
        "usage": [45.2]
    }
}

response = requests.post(
    "http://localhost:8000/api/v1/write/msgpack",
    headers={
        "Authorization": "Bearer YOUR_TOKEN",
        "Content-Type": "application/msgpack",
        "x-iedb-database": "default"
    },
    data=msgpack.packb(data)
)
```

### 查询数据（JSON）
```bash
curl -X POST http://localhost:8000/api/v1/query \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT * FROM default.cpu LIMIT 10", "format": "json"}'
```

### 查询数据（Apache Arrow）
对于大型结果集，请使用 Arrow 格式，吞吐量可达 2.88M 行/秒：

```python
import requests
import pyarrow as pa

response = requests.post(
    "http://localhost:8000/api/v1/query/arrow",
    headers={"Authorization": "Bearer YOUR_TOKEN"},
    json={"sql": "SELECT * FROM default.cpu LIMIT 100000"}
)

reader = pa.ipc.open_stream(response.content)
arrow_table = reader.read_all()
```

### 健康检查
```bash
curl http://localhost:8000/health
```

---

## 健康与监测
### GET /health
```json
{
  "status": "ok",
  "time": "2024-12-02T10:30:00Z",
  "uptime": "1h 23m 45s",
  "uptime_sec": 5025
}
```

### GET /ready
**响应：**

```json
{
  "status": "ready",
  "time": "2024-12-02T10:30:00Z",
  "uptime_sec": 5025
}
```

### GET /metrics
```bash
curl -H "Accept: application/json" http://localhost:8000/metrics
```

### GET /api/v1/metrics
所有指标均以JSON格式提供。

### GET /api/v1/metrics/memory
详细的内存统计信息。

### GET /api/v1/metrics/query-pool
数据库连接池统计信息。

### GET /api/v1/metrics/endpoints
每个请求接口的统计信息。

### GET /api/v1/metrics/timeseries/ :type
时间序列指标数据。

**参数：**

+ `:type`- `system`，`application`， 或者`api`
+ `?duration_minutes=30`- 时间范围（默认值：30，最大值：1440）

### GET /api/v1/logs
最近的应用程序日志。

**查询参数：**

+ `?limit=100`- 日志数量（默认值：100，最大值：1000）
+ `?level=error`- 按级别筛选（错误、警告、信息、调试）
+ `?since_minutes=60`- 时间范围（默认值：60，最大值：1440）

---

## 数据写入
### POST /api/v1/write/msgpack
高性能 MessagePack 二进制写入（推荐）。

**Header：**

+ `Authorization: Bearer TOKEN`
+ `Content-Type: application/msgpack`
+ `Content-Encoding: gzip`（可选）
+ `x-iedb-database: default`（可选）

**Body (MessagePack):**

```json
{
  "m": "measurement_name",
  "columns": {
    "time": [1697472000000, 1697472001000],
    "host": ["server01", "server02"],
    "value": [45.2, 67.8]
  }
}
```

**响应：** `204 No Content`

### GET /api/v1/write/msgpack/stats
MessagePack 接收统计信息。

### GET /api/v1/write/msgpack/spec
MessagePack 格式规范。

### POST /write
兼容 InfluxDB 1.x 行协议的接口。此方法与 InfluxDB 的原生 API 相匹配，可实现即插即用的客户端兼容性。

**参数：**

+ `db`- 目标数据库名称（必填）
+ `rp`- 数据保留策略（可选，忽略）
+ `precision`- 时间戳精度: `ns`, `us`, `ms`, `s` (default: `ns`)
+ `p`- 身份验证令牌（InfluxDB 1.x 风格）

**Header：**

+ `Content-Type: text/plain`
+ `Authorization: Bearer TOKEN`（或使用`p`查询参数）

**Body：**

```plain
cpu,host=server01 usage=45.2 1697472000000000000
mem,host=server01 used=8.2,total=16.0 1697472000000000000
```

**示例：**

```bash
curl -X POST "http://localhost:8000/write?db=mydb&p=YOUR_TOKEN" \
  -d 'cpu,host=server01 usage=45.2'
```

### POST /api/v2/write
兼容 InfluxDB 2.x 的接口。此路径与 InfluxDB 的原生 API 相匹配，可实现即插即用的客户端兼容性。

**查询参数：**

+ `bucket`- 目标数据库/存储桶名称（必填）
+ `org`- 组织（可选，忽略）
+ `precision`- 时间戳精度: `ns`, `us`, `ms`, `s` (default: `ns`)

**Header：**

+ `Content-Type: text/plain`
+ `Authorization: Token YOUR_TOKEN`（InfluxDB 2.x 风格）

**例子：**

```bash
curl -X POST "http://localhost:8000/api/v2/write?bucket=mydb&org=myorg" \
  -H "Authorization: Token YOUR_TOKEN" \
  -d 'cpu,host=server01 usage=45.2'
```

### POST /api/v1/write/line-protocol
IEDB原生Line Protocol接口，用请求头而非查询参数。

**Header：**

+ `Content-Type: text/plain`
+ `Authorization: Bearer TOKEN`
+ `x-iedb-database: default`- 目标数据库

### POST /api/v1/write/line-protocol/flush
强制将缓冲区数据刷新到磁盘。

### GET /api/v1/write/line-protocol/stats
行协议接收统计信息。

### GET /api/v1/write/line-protocol/health
行协议处理程序健康状况。

---

## 数据查询
### POST /api/v1/query
**请求**

```json
{
  "sql": "SELECT * FROM default.cpu LIMIT 10",
  "format": "json"
}
```

**响应：**

```json
{
  "columns": ["time", "host", "usage"],
  "types": ["TIMESTAMP", "VARCHAR", "DOUBLE"],
  "data": [
    [1697472000000, "server01", 45.2],
    [1697472001000, "server02", 67.8]
  ],
  "row_count": 2,
  "execution_time_ms": 12
}
```

### POST /api/v1/query/arrow
使用 Apache Arrow IPC 响应执行 SQL 查询。

**请求：**

```json
{
  "sql": "SELECT * FROM default.cpu LIMIT 10000"
}
```

**响应：** `application/vnd.apache.arrow.stream`

### POST /api/v1/query/estimate
执行查询前估算查询性能。

**请求：**

```json
{
  "sql": "SELECT * FROM default.cpu WHERE time > now() - INTERVAL '1 hour'"
}
```

### GET /api/v1/measurements
列出所有数据库中的测量（表）数据。

### GET /api/v1/query/ :measurement
直接查询特定测量（表）的字段。

---

## 授权管理
### GET /api/v1/auth/verify
验证Token有效性（公共接口）。

**请求：**

```json
{
  "valid": true,
  "token_id": "abc123",
  "name": "my-token",
  "is_admin": false
}
```

### GET /api/v1/auth/tokens
列出所有Token（仅限管理员）。

### POST /api/v1/auth/tokens
创建新Token（仅限管理员）。

**请求：**

```json
{
  "name": "my-service",
  "description": "Token for my service",
  "is_admin": false
}
```

**响应：**

```json
{
  "id": "abc123",
  "name": "my-service",
  "token": "arc_xxxxxxxxxxxxxxxxxxxxxxxx",
  "is_admin": false,
  "created_at": "2024-12-02T10:30:00Z"
}
```

### GET /api/v1/auth/tokens/ :id
获取Token详情（仅限管理员）。

### DELETE /api/v1/auth/tokens/ :id
删除/撤销Token（仅限管理员）。

### POST /api/v1/auth/tokens/ :id /rotate
生成一个新的 Token 值替代旧值，旧值立即失效。用于安全更新，不改变权限/绑定信息（仅限管理员）。

### POST /api/v1/auth/tokens/ :id /revoke
撤销Token，把 token 标记为不可用，但记录仍保留方便审计/追踪（仅限管理员）。

### GET /api/v1/auth/cache/stats
Token缓存统计信息（仅限管理员）。

### POST /api/v1/auth/cache/invalidate
使Token缓存失效（仅限管理员）。

---

## 数据压缩
### GET /api/v1/compaction/status
**响应：**

```json
{
  "enabled": true,
  "running": false,
  "last_run": "2024-12-02T10:00:00Z",
  "next_run": "2024-12-02T11:00:00Z"
}
```

### GET /api/v1/compaction/stats
压缩统计数据。

### GET /api/v1/compaction/candidates
列出符合压缩条件的文件。

### POST /api/v1/compaction/trigger
手动触发压缩。

**请求：**

```json
{
  "database": "default",
  "measurement": "cpu"
}
```

### GET /api/v1/compaction/jobs
列出正在进行的压缩的任务。

### GET /api/v1/compaction/history
压缩历史。

---

## 删除
### POST /api/v1/delete
删除符合条件的数据。

**请求：**

```json
{
  "database": "default",
  "measurement": "cpu",
  "where": "host = 'server01' AND time < '2024-01-01'",
  "confirm": true
}
```

**响应：**

```json
{
  "deleted_rows": 1523,
  "deleted_files": 3
}
```

### GET /api/v1/delete/config
获取删除操作配置。

---

## 数据库管理
开发人员管理数据库的接口。

### GET /api/v1/databases
列出所有包含measurement（测量表）的数据库。

**响应：**

```json
{
  "databases": [
    {"name": "default", "measurement_count": 5},
    {"name": "production", "measurement_count": 12}
  ],
  "count": 2
}
```

### POST /api/v1/databases
创建一个新数据库。

**请求：**

```json
{
  "name": 
}
```

**响应（201 创建）：**

```json
{
  "name": "my_database",
  "measurement_count": 0,
  "created_at": "2024-12-21T10:30:00Z"
}
```

**验证规则：**

+ 必须以字母开头 (a-z, A-Z)
+ 可以包含字母、数字、下划线和连字符
+ 最多 64 个字符
+ 已屏蔽的保留名称：`system``internal``_internal`

**错误响应（400）：**

```json
{
  "error": "Invalid database name: must start with a letter and contain only alphanumeric characters, underscores, or hyphens"
}
```

### GET /api/v1/databases/ :name
获取有关特定数据库的信息。

**响应：**

```json
{
  "name": "production",
  "measurement_count": 12
}
```

**错误响应（404）：**

```json
{
  "error": "Database 'nonexistent' not found"
}
```

### GET /api/v1/databases/ :name /measurements
列出数据库中的所有测量表的数据。

**响应：**

```json
{
  "database": "production",
  "measurements": [
    {"name": "cpu"},
    {"name": "memory"},
    {"name": "disk"}
  ],
  "count": 3
}
```

### DELETE /api/v1/databases/ :name
删除数据库及其所有数据。

警告 此操作会破坏数据且无法撤销。要求：

+ `delete.enabled = true`配置中允许删除
+ `?confirm=true`查询参数确认

**请求：**

```bash
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8000/api/v1/databases/old_data?confirm=true"
```

**响应：**

```json
{
  "message": "Database 'old_data' deleted successfully",
  "files_deleted": 47
}
```

**错误响应：**

_配置禁用删除（403）：_

```json
{
  "error": "Delete operations are disabled. Set delete.enabled=true in iedb.toml to enable."
}
```

_缺少确认信息（400）：_

```json
{
  "error": "Confirmation required. Add ?confirm=true to delete the database."
}
```

---

## 数据保留
### POST /api/v1/retention
制定数据保留策略。

**请求：**

```json
{
  "name": "30-day-retention",
  "database": "default",
  "measurement": "cpu",
  "duration": "30d",
  "schedule": "0 2 * * *"
}
```

### GET /api/v1/retention
列出所有数据保留策略。

### GET /api/v1/retention/ :id
获取具体的保留策略。

### PUT /api/v1/retention/ :id
更新数据保留策略。

### DELETE /api/v1/retention/ :id
删除保留策略。

### POST /api/v1/retention/ :id /execute
手动执行策略。

### GET /api/v1/retention/ :id /executions
获取策略执行历史记录。

---

## 连续查询
### POST /api/v1/continuous_queries
创建连续查询。

**请求：**

```json
{
  "name": "hourly-rollup",
  "source_database": "default",
  "source_measurement": "cpu",
  "destination_database": "default",
  "destination_measurement": "cpu_hourly",
  "query": "SELECT time_bucket('1 hour', time) as time, host, AVG(usage) as avg_usage FROM default.cpu GROUP BY 1, 2",
  "schedule": "0 * * * *"
}
```

### GET /api/v1/continuous_queries
列出所有连续查询。

### GET /api/v1/continuous_queries/ :id
获取特定的连续查询。

### PUT /api/v1/continuous_queries/ :id
更新连续查询。

### DELETE /api/v1/continuous_queries/ :id
删除连续查询。

### POST /api/v1/continuous_queries/ :id /execute
手动执行连续查询。

### GET /api/v1/continuous_queries/ :id /executions
获取执行历史记录。

---

## MQTT订阅
管理 MQTT 代理订阅，以便直接接收物联网数据。有关详细使用方法，请参阅[MQTT 集成指南](./07-集成指南/01-MQTT集成.md)。

### POST /api/v1/mqtt/subscriptions
创建一个新的MQTT订阅。

**请求：**

```json
{
  "name": "factory-sensors",
  "broker": "tcp://localhost:1883",
  "topics": ["sensors/#"],
  "database": "iot",
  "qos": 1,
  "auto_start": true
}
```

**响应（201 created）：**

```json
{
  "id": "sub_abc123",
  "name": "factory-sensors",
  "broker": "tcp://localhost:1883",
  "topics": ["sensors/#"],
  "database": "iot",
  "status": "running",
  "created_at": "2026-02-01T10:00:00Z"
}
```

### GET /api/v1/mqtt/subscriptions
列出所有MQTT订阅。

**响应：**

```json
{
  "subscriptions": [
    {
      "id": "sub_abc123",
      "name": "factory-sensors",
      "broker": "tcp://localhost:1883",
      "status": "running"
    }
  ],
  "count": 1
}
```

### GET /api/v1/mqtt/subscriptions/ :id
获取订阅详情。

### PUT /api/v1/mqtt/subscriptions/ :id
更新订阅。必须先取消订阅。

### DELETE /api/v1/mqtt/subscriptions/ :id
删除订阅。必须先取消订阅。

### POST /api/v1/mqtt/subscriptions/ :id /start
恢复已停止的订阅。

**响应：**

```json
{
  "id": "sub_abc123",
  "status": "running",
  "message": "Subscription started"
}
```

### POST /api/v1/mqtt/subscriptions/ :id /stop
停止正在运行的订阅。

### POST /api/v1/mqtt/subscriptions/ :id /restart
重新启动订阅（停止 + 启动）。

### GET /api/v1/mqtt/subscriptions/ :id /stats
获取特定订阅的统计信息。

**响应：**

```json
{
  "id": "sub_abc123",
  "messages_received": 15420,
  "bytes_received": 2458320,
  "decode_errors": 0,
  "last_message_at": "2026-02-01T10:30:15Z",
  "topics": {
    "sensors/temperature": 8500,
    "sensors/humidity": 6920
  }
}
```

### GET /api/v1/mqtt/stats
所有正在运行的订阅的汇总统计数据。

**响应：**

```json
{
  "status": "success",
  "running_count": 2,
  "subscriptions_stats": {
    "sub_abc123": { ... },
    "sub_def456": { ... }
  }
}
```

### GET /api/v1/mqtt/health
MQTT 服务健康状况检查。

**响应：**

```json
{
  "status": "healthy",
  "healthy": true,
  "running_count": 2,
  "connected_count": 2,
  "disconnected_count": 0,
  "service": "mqtt_subscriptions"
}
```

---

## 响应格式
### 成功响应
```json
{
  "status": "success",
  "data": [...],
  "count": 10
}
```

### 错误响应
```json
{
  "error": "Error message"
}
```

### HTTP状态码
+ `200`- 成功
+ `204`- 无内容（写入成功）
+ `400`- 错误的请求
+ `401`- 未经授权
+ `403`- 禁止访问（需要管理员权限）
+ `404`- 未找到
+ `500`- 内部服务器错误

---

## 速率限制
IEDB 默认情况下不强制执行速率限制。对于生产环境部署，请考虑：

+ 反向代理速率限制（Nginx、Traefik）
+ API 网关
+ 应用层限流

## CORS
CORS 跨域默认启用，并采用宽松设置。生产环境请通过反向代理进行配置。

## 最佳实践
### 1. 使用 MessagePack 进行写入
MessagePack 比 Line Protocol 快 5 倍：

```python
# Fast: MessagePack columnar
data = {"m": "cpu", "columns": {...}}
requests.post(url, data=msgpack.packb(data))

# Slower: Line Protocol text
data = "cpu,host=server01 usage=45.2"
requests.post(url, data=data)
```

### 2. 批量写入
每次请求发送多条记录：

```python
data = {
    "m": "cpu",
    "columns": {
        "time": [t1, t2, t3, ...],
        "host": [h1, h2, h3, ...],
        "usage": [u1, u2, u3, ...]
    }
}
```

### 3. 使用 Arrow 进行大型查询
对于超过 1 万行的数据，请使用 Arrow 接口：

```python
response = requests.post(url + "/api/v1/query/arrow", ...)
table = pa.ipc.open_stream(response.content).read_all()
df = table.to_pandas()  # 零拷贝
```

### 4. 启用 Gzip 压缩
```python
import gzip

compressed = gzip.compress(msgpack.packb(data))
requests.post(
    url,
    data=compressed,
    headers={"Content-Encoding": "gzip", ...}
)
```



## 企业功能
以下接口 IEDB 企业版许可证使用。

### 集群
| **方法** | **接口** | **描述** |
| --- | --- | --- |
| `GET` | `/api/v1/cluster` | 集群状态 |
| `GET` | `/api/v1/cluster/nodes` | 列出集群节点 |
| `GET` | `/api/v1/cluster/nodes/:id` | 获取特定节点 |
| `GET` | `/api/v1/cluster/local` | 本地节点信息 |
| `GET` | `/api/v1/cluster/health` | 健康检查 |


请参阅[集群管理](./09-高级功能/03-集群管理.md)以获取详细的 API 文档。

### RBAC
| **方法** | **接口** | **描述** |
| --- | --- | --- |
| `POST/GET/PATCH/DELETE` | `/api/v1/rbac/organizations` | 组织管理 |
| `POST/GET/PATCH/DELETE` | `/api/v1/rbac/organizations/:org_id/teams` | 团队管理 |
| `POST/GET/PATCH/DELETE` | `/api/v1/rbac/teams/:team_id/roles` | 角色管理 |
| `POST/GET/DELETE` | `/api/v1/rbac/roles/:role_id/measurements` | 测量权限 |


有关详细的 API 文档，请参阅[RBAC 。](./11-数据安全/01-RBAC.md)

### 分层存储
| **方法** | **接口** | **描述** |
| --- | --- | --- |
| `GET` | `/api/v1/tiering/status` | 分级状态 |
| `GET` | `/api/v1/tiering/files` | 按层级列出文件 |
| `POST` | `/api/v1/tiering/migrate` | 触发迁移 |
| `GET` | `/api/v1/tiering/stats` | 移民统计数据 |
| `POST/GET/PUT/DELETE` | `/api/v1/tiering/policies` | 每个数据库的策略 |


有关详细的 API 文档，请参阅[分层存储。](./08-数据生命周期/04-分层存储.md)

### 审计日志
| **方法** | **接口** | **描述** |
| --- | --- | --- |
| `GET` | `/api/v1/audit/logs` | 查询审计日志 |
| `GET` | `/api/v1/audit/stats` | 审计统计 |


请参阅[审计日志记录](./11-数据安全/02-审计日志.md)以获取详细的 API 文档。

### 查询治理
| **方法** | **接口** | **描述** |
| --- | --- | --- |
| `POST/GET/PUT/DELETE` | `/api/v1/governance/policies` | 查询管理 |
| `GET` | `/api/v1/governance/usage/:token_id` | 使用情况监控 |


有关详细的 API 文档，请参阅[查询治理部分。](./10-查询/02-查询治理.md)

### 查询管理
| **方法** | **接口** | **描述** |
| --- | --- | --- |
| `GET` | `/api/v1/queries/active` | 活跃查询 |
| `GET` | `/api/v1/queries/history` | 查询历史记录 |
| `GET` | `/api/v1/queries/:id` | 查询详情 |
| `DELETE` | `/api/v1/queries/:id` | 取消查询 |


有关详细的 API 文档，请参阅[查询管理。](./10-查询/03-查询管理.md)

## 后续步骤
+ [**入门**](./02-快速上手.md)指南
+ [**配置**](./05-配置/01-配置概览.md)- 服务器配置

  


