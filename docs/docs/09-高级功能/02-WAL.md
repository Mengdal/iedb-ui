IEDB 的预写日志 (WAL) 可保证系统崩溃时**数据零丢失。**



**两种不同的WAL功能：**

1. **SQLite WAL 模式**（始终启用）——IEDB 元数据数据库的内部模式。此模式允许并发访问连接设置、导出作业和压缩锁。`"SQLite WAL mode enabled for concurrent access"`启动时会显示日志消息——这是预期行为，与数据导入无关。
2. **IEDB 的 WAL 功能**（默认禁用）—— 可选的**数据采集**持久性功能，可提供零数据丢失保证。该功能由`WAL_ENABLED`配置，启动日志`"SQLite WAL mode enabled"`正常，并不意味着 IEDB 的数据摄取 WAL 已启用。

## 概述
WAL（预写入日志）是一项可选的持久性功能，它会在确认写入**之前**将所有传入数据持久化到磁盘。启用此功能后，即使程序崩溃，也能保证数据可以恢复。

默认情况下， WAL 功能处于**禁用状态**，以最大程度地提高吞吐量。当需要零数据丢失时，请启用此功能。

### 何时启用
如果需要，请启用 WAL：

+ 系统崩溃时**数据零丢失**
+ **保证**符合监管要求（金融、医疗）
+ **意外故障**（断电、内存不足导致的崩溃）恢复

如果您符合以下条件，请禁用 ：

+ **优先考虑最大吞吐量**
+ **可容忍**极少数崩溃情况下0-5 秒的数据丢失
+ **在客户端设置重试逻辑**或北向设置消息队列

### 性能与健壮性之间的权衡
| **配置** | **吞吐量** | **数据丢失风险** |
| --- | --- | --- |
| **无 WAL（默认）** | 947万次录制/秒 | 0-5秒 |
| **WALC + 异步** | ~770万次接收/秒（-19%） | 不到1秒 |
| **WAL + fdatasync** | ~750万次接收/秒（-21%） | 接近于零 |
| **WALC + fsync** | ~770万次接收/秒（-19%） | 零 |


**权衡**：吞吐量降低约 20%，但数据丢失接近于零（fdatasync 模式）。

## 数据流
### 使用 WAL 的数据流
```plain
1.接收数据：通过 HTTP 请求接收数据（格式为 MessagePack 或行协议）。

2.预写日志（WAL）：
将记录序列化为 MessagePack 二进制格式。
计算 CRC32 校验和以保证数据完整性。
写入磁盘并执行 fdatasync() 强制物理同步，确保数据持久化。
立即响应客户端：返回 HTTP 202 Accepted，表示数据已安全持久化。

3.内存缓冲：
将记录写入内存缓冲区。
当缓冲区达到 5 万条记录或等待 5 秒后触发刷新。

4.生成 Parquet 文件：
将缓冲数据转换为 Arrow 列式格式。
写入 Parquet 文件并上传至对象存储（如 S3/MinIO）。

5.标记 WAL 完成：通知 WAL 对应的数据已成功转存，可安全删除 WAL 中的记录。
```

关键 一旦 WAL 确认写入（步骤 1），即使 IEDB 在步骤 4 完成之前崩溃，也能**保证数据的持久性。**

### WAL 文件
使用单个 WAL 写入器，并通过 goroutine 实现并发访问：

```plain
./data/wal/
├── iedb-20251008_140530.wal
└── iedb-20251008_150530.wal
```

**好处：**

+ 实现简单
+ 自动轮换
+ 启动时的并行恢复

## 配置
### 启用 WAL
编辑`toml`：

```toml
[wal]
enabled = true
sync_mode = "fdatasync"    # 推荐用于生产环境
directory = "./data/wal"
max_size_mb = 500          # 达到 500MB 时轮换
max_age_seconds = 3600     # 超过 1 小时后轮换
```

### 同步模式
支持三种同步模式，每种模式在健壮性上各有优劣：

#### fdatasync（推荐）
```toml
[wal]
sync_mode = "fdatasync"
```

**工作原理：**

+ 将数据同步到磁盘（文件内容）
+ 跳过元数据同步（文件大小、修改时间）
+ 速度提升 50% `fsync`，健壮性几乎相同

**保证：**

+ 数据存储在物理磁盘上。
+ 崩溃后可以恢复所有数据
+ 文件元数据可能已过时（并非关键问题）

**使用场景**：生产环境部署（推荐）

#### fsync（最高安全级别）
```toml
[wal]
sync_mode = "fsync"
```

**工作原理：**

+ 将数据和元数据都同步到磁盘
+ 速度最慢，但安全保证

**适用情况：**

+ 监管合规要求
+ 数据丢失零容忍
+ 性能次要

#### 异步（性能优先）
```toml
[wal]
sync_mode = "async"
```

**工作原理：**

+ 写入操作系统缓冲区缓存
+ 没有显式同步（操作系统定期刷新）
+ 速度极快，但风险窗口较小。

**适用情况：**

+ 需要达到原吞吐量的 90%。
+ 可容忍约 1 秒的数据丢失
+ 具备北向重试机制

### 轮换设置
控制 WAL 文件轮换时间：

```toml
[wal]
max_size_mb = 100           # 文件达到 100MB 时轮换
max_age_seconds = 3600      # 超过 1 小时后轮换（即使文件很小）
```

**为什么轮换很重要：**

+ 防止无限制增长
+ 恢复速度更快（文件更小）
+ 自动清理旧的 WAL

## 运维
### 启动恢复
启动时会自动从WAL文件中恢复数据：

```plain
2025-10-08 14:30:00 [INFO] WAL recovery started: 4 files
2025-10-08 14:30:01 [INFO] Recovering WAL: worker-1-20251008_143000.wal
2025-10-08 14:30:01 [INFO] WAL read complete: 1000 entries, 5242880 bytes, 0 corrupted
2025-10-08 14:30:02 [INFO] Recovering WAL: worker-2-20251008_143000.wal
...
2025-10-08 14:30:05 [INFO] WAL recovery complete: 4000 batches, 200000 entries, 0 corrupted
2025-10-08 14:30:05 [INFO] WAL archived: worker-1-20251008_143000.wal.recovered
```

**过程：**

1. 查找所有`*.wal`文件`WAL_DIR`
2. 读取并验证每个条目（校验和验证）
3. 回放记录到缓冲区系统中
4. 存档已恢复为 WAL`*.wal.recovered`
5. 继续正常使用

**恢复时间：**

+ 每 100MB 的 WAL 文件大约需要 5 秒
+ 并行恢复
+ 已损坏的条目将被跳过

## 监测
### WAL 状态
```bash
curl http://localhost:8000/api/wal/status \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**响应：**

```json
{
  "enabled": true,
  "configuration": {
    "sync_mode": "fdatasync",
    "worker_id": 1,
    "current_file": "./data/wal/worker-1-20251008_143000.wal"
  },
  "stats": {
    "current_size_mb": 45.2,
    "current_age_seconds": 1850,
    "total_entries": 5000,
    "total_bytes": 47382528,
    "total_syncs": 5000,
    "total_rotations": 2
  }
}
```

### WAL 文件
```bash
curl http://localhost:8000/api/wal/files \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**响应：**

```json
{
  "active": [
    {
      "name": "worker-1-20251008_143000.wal",
      "size_mb": 45.2,
      "modified": 1696775400
    }
  ],
  "recovered": [
    {
      "name": "worker-1-20251008_120000.wal.recovered",
      "size_mb": 98.5,
      "modified": 1696768800
    }
  ],
  "total_size_mb": 143.7
}
```

### 健康检查
```bash
curl http://localhost:8000/api/wal/health \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 清理旧的WAL文件
```bash
# Cleanup files older than 24 hours (default)
curl -X POST http://localhost:8000/api/wal/cleanup \
  -H "Authorization: Bearer YOUR_TOKEN"

# Custom age (in hours)
curl -X POST "http://localhost:8000/api/wal/cleanup?max_age_hours=48" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 故障排除
### WAL恢复时间过长
**响应：**

```plain
2025-10-08 14:30:00 [INFO] WAL recovery started: 50 files
... (minutes pass) ...
```

**解决方案：**

1. **调整轮换设置：**

```toml
[wal]
max_size_mb = 50          # 文件更小，恢复更快
max_age_seconds = 1800    # 轮换更频繁
```

2. **使用速度更快的磁盘进行 WAL 日志记录：**

```toml
[wal]
dir = "/mnt/nvme/iedb-wal"   # NVMe SSD
```

3. **使用更快的存储设备：**
+ 用于 WAL 目录的 NVMe SSD
+ 将磁盘与数据存储分开

### WAL 磁盘空间增长
**问题：**

```bash
$ du -sh ./data/wal
5.2G    ./data/wal
```

**解决方案：**

1. **手动清理：**

```bash
rm -f ./data/wal/*.wal.recovered
```

2. **降低留存率：**

```toml
[wal]
max_size_mb = 50          # 更快轮换
max_age_seconds = 1800    # 30 minutes
```

3. **添加定时任务进行清理：**

```bash
# Cleanup recovered WALs older than 24 hours
0 2 * * * find /path/to/data/wal -name "*.wal.recovered" -mtime +1 -delete
```

### WAL 写入失败
**问题：**

```plain
2025-10-08 14:30:00 [ERROR] WAL append failed: [Errno 28] No space left on device
```

**解决方案：**

1. **检查磁盘空间：**

```bash
df -h /path/to/WAL_DIR
```

2. **检查权限：**

```bash
ls -ld ./data/wal
chmod 755 ./data/wal
```

3. **将 WAL 日志移动到更大的磁盘：**

```toml
[wal]
dir = "/mnt/large-disk/iedb-wal"
```

### 使用 WAL 时性能下降
**症状：**

+ 吞吐量从 947 万接收/秒下降到 200 万接收/秒
+ fsync 调用导致 CPU 使用率过高

**解决方案：**

1. **验证同步模式：**

```toml
[wal]
sync_mode = "fdatasync"  # Should be fdatasync, not fsync
```

2. **检查磁盘 I/O 等待时间：**

```bash
iostat -x 1
# Look for %iowait > 50%
```

3. **将 WAL 日志移动到速度更快的磁盘：**

```toml
[wal]
dir = "/mnt/nvme/iedb-wal"
```

4. **如果持久性并非至关重要，请考虑禁用 WAL：**

```toml
[wal]
enabled = false
```

## 最佳实践
### 生产部署
**推荐配置：**

```toml
[wal]
enabled = true
sync_mode = "fdatasync"
dir = "/mnt/fast-ssd/iedb-wal"
max_size_mb = 100
max_age_seconds = 3600
```

**监控设置：**

1. 监控 WAL 使用情况
2. 写入失败警报
3. 跟踪重启期间的恢复时间
4. 日志记录

**备用策略：**

+ WAL 文件是临时性的（恢复后会被删除）。
+ 不要直接备份 WAL 文件
+ 备份最终的 Parquet 文件到 S3/MinIO

### 开发/测试
**推荐配置：**

```toml
[wal]
enabled = false  # 关闭，提高性能
```

**测试 WAL：**

```toml
[wal]
enabled = true
sync_mode = "async"
max_size_mb = 10
```

## 概括
**启用 WAL 的条件是：**

+ 要求零数据丢失。
+ 受监管行业（金融、医疗）
+ 可以接受 19% 的吞吐量下降

**如果满足以下条件，则禁用 WAL：**

+ 最大吞吐量是首要考虑因素。
+ 可容忍 0-5 秒的数据丢失风险
+ 具备北向重试/排队机制

**推荐设置：**

```toml
[wal]
enabled = true
sync_mode = "fdatasync"     # 最佳平衡
dir = "/mnt/nvme/iedb-wal"   # 高效存储
```

## 后续步骤
+ [**文件压缩**](./01-文件压缩.md)- 优化查询性能
+ [**配置参考**](../05-配置/01-配置概览.md)- 最大化吞吐量

