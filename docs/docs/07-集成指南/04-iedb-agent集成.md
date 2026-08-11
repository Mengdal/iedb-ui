# iedb-agent集成

将边缘设备的时序数据通过 iedb-agent 采集、缓冲并转发到 IotEdgeDB，在弱网、断连等复杂环境下也能可靠地完成数据上传。

## 概述

iedb-agent 是 IotEdgeDB 的边缘采集代理，一个轻量级 Rust 服务，用于从边缘设备采集、缓冲和转发时序数据至 IotEdgeDB。

```text
    边缘设备                                  IotEdgeDB 服务器
┌──────────────┐                         ┌──────────────────┐
│  iedb-agent  │ ─── 刷写：Parquet ──→    │  /api/v1/ingest  │
│              │                         │                  │
│ WAL + Buffer │ ←── 查询：HTTP ──────    │ DuckDB + Parquet │
└──────────────┘                         └──────────────────┘
  ARM32 / ARM64                            amd64 / ARM64
```

**主要特点：**

+ **Line Protocol 采集**——通过 HTTP 接口接收兼容 InfluxDB 的 Line Protocol 格式时序数据
+ **WAL 持久化**——预写日志（Write-Ahead Log），带 CRC32 完整性校验和崩溃安全回放
+ **内存缓冲**——基于标签索引的时间分区 Chunk，支持快速查询
+ **增量 Parquet 刷写**——按时间 Chunk 快照生成 Parquet 文件，支持 HTTP 或 S3 上传
+ **零 Arrow/DataFusion 依赖**——纯行式设计，极简依赖树，专为资源受限的边缘设备打造
+ **ARM32 / ARM64 支持**——通过 cargo-zigbuild 生成静态 musl 二进制文件，无 GLIBC 依赖
+ **Agent 注册与心跳**——自动向 IotEdgeDB 注册，周期性上报表元数据变更
+ **内存保护与背压**——可配置内存上限，超限时触发强制刷写或拒绝写入（HTTP 503）
+ **失败重试**——上传失败的 Parquet 文件暂存至本地 staging 目录，后台自动重试
+ **认证支持**——支持 IotEdgeDB Bearer Token 认证

## 应用场景

边缘设备的网络环境与数据中心截然不同。弱网、断连、带宽受限是常态，设备本身也往往是资源受限的 ARM 小主机。直接把数据逐条推送到中心数据库，任何一次网络抖动都会造成数据丢失。

iedb-agent 解决的正是这个链路痛点：

+ **本地缓冲，断网不丢**——数据先写入 WAL 与内存缓冲，网络恢复后自动补传
+ **批量上传，节省带宽**——按时间分块合并成 Parquet 文件后一次性上传，而不是逐条推送
+ **资源占用极低**——纯 Rust 静态编译，单二进制约 6MB，无运行时依赖，树莓派等设备也能长期运行
+ **与 IotEdgeDB 无缝协同**——自动注册、心跳上报、表元数据同步，接入后即可在中心端用 SQL 查询

## 快速开始

### 方式一：下载预编译二进制（推荐）

从 [GitHub Releases](https://github.com/1093181236-cloud/iedb-agent/releases) 下载对应平台的二进制：

+ `iedb-agent-armv7` — ARM32（树莓派、嵌入式主板）
+ `iedb-agent-aarch64` — ARM64（树莓派 4/5、AWS Graviton）

```bash
# 以 ARM64 为例
gh release download v0.1.1 --repo 1093181236-cloud/iedb-agent --pattern "*-aarch64"
chmod +x iedb-agent-aarch64
sudo mv iedb-agent-aarch64 /usr/local/bin/iedb-agent
```

### 方式二：源码构建

```bash
cargo build --release
# 产物: target/release/iedb-agent
```

### 配置与启动

```bash
cp iedb-agent-arm32.toml.example iedb-agent.toml
# 编辑: 设置 [iotedgedb].url 和 [agent].id

./target/release/iedb-agent
```

启动后，Agent 会向 IotEdgeDB 注册并开始监听写入端口，默认 `8080`。

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/write?db=<name>` | 写入 Line Protocol 数据（body 为 text/plain） |
| `GET` | `/query?db=<name>&table=<name>&start=<ns>&end=<ns>&tag=<k>=<v>` | 查询内存缓冲 → JSON |
| `GET` | `/health` | 健康检查 → `ok` |

### 写入示例

```bash
# 写入一条数据，时间戳为纳秒（示例：2024-08-11 22:00:00 UTC）
curl -X POST "http://localhost:8080/write?db=mydb" \
  -d "cpu,host=srv01 cpu=75.5,mem=62.3 1723413600000000000"
```

### 查询示例

```bash
# 查询所有行
curl "http://localhost:8080/query?db=mydb&table=cpu"

# 带时间范围和标签过滤
curl "http://localhost:8080/query?db=mydb&table=cpu&start=1700000000000000000&end=1800000000000000000&tag=host=srv01"
```

### 响应格式

```json
{
  "rows": [
    {
      "time": 1700000000000000000,
      "tags": {"host": "srv01"},
      "fields": {"cpu": 75.5, "mem": 62.3}
    }
  ]
}
```

## 配置说明

```toml
[server]
port = 8080
# max_body_bytes = 10485760  # 请求体最大字节数（默认 10MB）

[data]
dir = "/var/lib/iedb-agent"

[wal]
flush_interval_secs = 1          # WAL 缓冲区刷写间隔
max_write_buffer_ops = 100000    # WAL 缓冲区最大操作数，超限则拒绝写入

[flush]
snapshot_interval = "10m"        # Chunk 边界 + 快照频率
backend = "http"                 # "http"（默认）或 "s3"
memory_limit = "512MB"           # 内存缓冲区上限，超限触发强制快照

# HTTP 模式（默认，无需 S3）
[iotedgedb]
url = "http://iotededb:8000"
# token = "iedb_xxxxxxxxxxxxxxxxxxxx"   # Bearer Token（iotededb 开启认证时必填）

# S3 模式（多 Agent 生产环境）
[s3]
bucket = "mybucket"
region = "us-east-1"
endpoint = "https://s3.amazonaws.com"
access_key = "..."
secret_key = "..."

[agent]
id = "agent-01"                  # 唯一 Agent 标识符
```

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `server.port` | u16 | `8080` | HTTP 监听端口 |
| `server.max_body_bytes` | usize | `10485760` (10MB) | 单次写入请求体大小上限 |
| `data.dir` | path | `/var/lib/iedb-agent` | 数据存储目录（WAL、meta、staging） |
| `wal.flush_interval_secs` | u64 | `1` | WAL 缓冲区刷写到磁盘的间隔（秒） |
| `wal.max_write_buffer_ops` | usize | `100000` | WAL 缓冲操作数上限，超限返回 503 |
| `flush.snapshot_interval` | string | `"10m"` | 快照间隔（支持 `s`/`m` 后缀） |
| `flush.backend` | string | `"http"` | 上传后端：`"http"` 或 `"s3"` |
| `flush.memory_limit` | string | `"512MB"` | 内存上限（支持 `MB`/`GB` 后缀） |
| `iotedgedb.url` | string | 必填 | IotEdgeDB 服务地址 |
| `iotedgedb.token` | string | 可选 | IotEdgeDB 认证 Bearer Token |
| `agent.id` | string | 必填 | 全局唯一的 Agent 标识 |

## 架构设计

### 数据写入流程

```
POST /write (Line Protocol)
  │
  ├─ 1. 解析 LP → 按表分组行
  ├─ 2. 计算 chunk_time = floor(time / snapshot_interval)
  ├─ 3. WalManager.buffer_op() 缓冲写入（op_limit 门控）
  ├─ 4. WAL 刷写（1s 间隔）→ {data}/wal/{seq}.wal（CRC32 完整性校验）
  ├─ 5. Buffer 插入 → Table.chunks（标签索引，按 chunk_time 排序）
  └─ 204 No Content
```

写入采用**同步刷写 WAL 后插入 Buffer**的单一写入路径，确保：

+ WAL 先于内存持久化（崩溃安全）
+ 单次 HTTP 请求内完成 WAL + Buffer（无异步空洞）
+ WAL 缓冲超限时直接返回 HTTP 503

### 快照刷写流程

```
快照触发（每 snapshot_interval 或内存压力）
  │
  ├─ end_time_marker = now - snapshot_interval
  ├─ 收集 chunk_time < end_time_marker 的 Chunk
  ├─ 归并排序 + 去重 → Parquet 字节
  ├─ 上传: HTTP POST 到 iotededb 或 S3 PUT
  ├─ 成功 → 移除 Chunk，写 last_snapshot.json（fsync 保证持久化），清理 WAL
  └─ 失败 → 保存到 staging/，保留 Chunk + WAL，后台重试
```

### 崩溃恢复流程

```
启动
  │
  ├─ 读取 meta/last_snapshot.json → flushed_wal_seq
  ├─ 扫描 wal/ 目录 → 找到 seq > flushed_wal_seq 的 WAL 文件
  ├─ 按序回放 WAL 操作到 Buffer → 恢复未刷写数据
  └─ 正常服务
```

### 上传后端

#### HTTP 模式（默认）

+ Parquet 字节通过 HTTP POST 发送至 `{iotedgedb_url}/api/v1/ingest/parquet?db=<name>&measurement=<name>`
+ 支持 Bearer Token 认证
+ 适用于单 Agent 或小规模部署

#### S3 模式

+ 使用 AWS SigV4 签名直传 S3
+ S3 key 格式：`{db}/{table}/{year}/{month}/{day}/{hour}/{agent_id}_{timestamp}_{nanos}.parquet`
+ 通过 key 路径实现按时间的自动分区
+ 适用于多 Agent 大规模生产环境

### 内存保护

三级内存保护机制：

```
1. WAL 缓冲区 op_limit    → BufferFull → HTTP 503 Service Unavailable
2. memory_limit 被超出     → 强制快照 → 释放 staging 覆盖的 Chunk
3. 快照后仍超限           → HTTP 503 Service Unavailable
```

## 部署

### systemd 服务（推荐）

```ini
[Unit]
Description=IotEdgeDB Edge Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/iedb-agent
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

保存为 `/etc/systemd/system/iedb-agent.service`，然后：

```bash
systemctl daemon-reload
systemctl enable --now iedb-agent
systemctl status iedb-agent
```

### ARM32 配置调优建议

| 设备内存 | 建议 `memory_limit` | 建议 `snapshot_interval` |
| --- | --- | --- |
| 256 MB | `"64MB"` | `"30s"` |
| 512 MB | `"128MB"` | `"60s"` |
| 1 GB | `"256MB"` | `"120s"` |

## 端到端验证

1. 启动 IotEdgeDB：

```bash
iedb serve --config iedb.toml
```

2. 在边缘设备上启动 iedb-agent（参考「快速开始」）。

3. 写入测试数据：

```bash
# 写入一条数据，时间戳为纳秒（示例：2024-08-11 22:00:00 UTC）
curl -X POST "http://EDGE_IP:8080/write?db=test" \
  -d "cpu,host=srv01 cpu=75.5 1723413600000000000"
```

4. 查询 Agent 内存缓冲：

```bash
curl "http://EDGE_IP:8080/query?db=test&table=cpu"
```

5. 查询 IotEdgeDB（Parquet + Agent 缓冲联合查询）：

```bash
curl -X POST "http://IOTEDGEDB_IP:8000/api/v1/query" \
  -H "Content-Type: application/json" \
  -H "x-iedb-database: test" \
  -d '{"sql":"SELECT * FROM cpu ORDER BY time"}'
```

## 总结

iedb-agent 把 IotEdgeDB 的时序能力延伸到边缘侧：

+ 设备端本地缓冲，断网不丢、弱网可用
+ 按时间分块批量上传，节省带宽
+ 纯 Rust 静态编译，ARM32/ARM64 轻量部署
+ 自动注册与心跳，接入后即可在中心端用 SQL 统一查询

IotEdgeDB 负责存储与分析，iedb-agent 负责采集与传输，两者配合即构成一套完整的边缘到中心时序数据方案。