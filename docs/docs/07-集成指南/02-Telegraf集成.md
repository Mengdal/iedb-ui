# Telegraf集成
直接将 Telegraf 的监控指标写入 IotEdgeDB，无需改造现有采集链路，就能把服务器、数据库、容器、云服务和 IoT 设备的指标统一汇聚到 IotEdgeDB 中。

## 概述

Telegraf 是一个非常成熟的指标采集代理，拥有 300+ 个输入插件，可以从几乎任何系统、服务或设备中采集数据。

这意味着你可以继续沿用 Telegraf 现有的采集能力，把系统监控、数据库指标、云服务遥测、工业 IoT 数据等，直接写入 IotEdgeDB 的高性能时序存储中。

**主要特点：**

+ **300+ 输入插件**——覆盖系统、数据库、云服务、容器、消息队列、IoT 等常见场景
+ **官方HTTP输出插件**——Telegraf 直接将指标发送到 IotEdgeDB
+ **MessagePack 传输**——更高效的写入格式
+ **gzip 压缩**——降低网络带宽开销
+ **Parquet 存储**——数据以开放格式保存，便于后续分析
+ **SQL 查询**——写入后即可直接使用 SQL 分析
+ **避免供应商锁定**——数据始终保持可迁移、可访问

## 为什么 Telegraf 很重要

在监控生态里，Telegraf 的地位非常特殊。它不是某个单一场景的采集器，而是一个高度插件化的指标接入层。正因为如此，它能在不改动采集架构的前提下，接入各种来源的数据。

### 插件驱动的架构

Telegraf 的能力主要来自它的插件体系，整体分为四类：

+ **输入插件（Input）**——从系统、服务和 API 采集指标
+ **处理插件（Processor）**——在传输过程中对指标进行转换和过滤
+ **聚合插件（Aggregator）**——按时间窗口计算统计值
+ **输出插件（Output）**——把指标发送到后端存储，例如 IotEdgeDB

有了 300+ 个输入插件，Telegraf 几乎可以采集任何东西：

| 类别 | 示例 | 插件数量 |
| --- | --- | --- |
| 系统 | CPU、内存、磁盘、网络、进程 | 15+ |
| 数据库 | MySQL、PostgreSQL、MongoDB、Redis、Elasticsearch | 50+ |
| 云服务 | AWS CloudWatch、Azure Monitor、Alibaba Cloud | 30+ |
| 容器 | Docker、Kubernetes、containerd | 10+ |
| 消息队列 | Kafka、RabbitMQ、NATS、MQTT | 15+ |
| Web 服务器 | NGINX、Apache、HAProxy、Traefik | 10+ |
| IoT / 工业 | Modbus、OPC-UA、S7、SNMP | 20+ |

### 轻量、稳定、经过实战验证

Telegraf 是一个单文件 Go 程序，没有复杂的外部依赖，支持 Linux、Windows、macOS 以及 ARM 设备。它已经在大量生产环境中运行，从初创团队到大型企业都在使用。

InfluxData 最初是为了配合 InfluxDB 打造它的，但 Telegraf 本身支持很多输出目标。

## IotEdgeDB 的插件使用

IotEdgeDB 输出插件的配置非常简单：

```toml
[[outputs.http]]
  url = "http://127.0.0.1:8000/api/v1/write/line-protocol"
  data_format = "influx"
  [outputs.http.headers]
    x-iedb-database = "default"
    x-api-key = "your-api-key-here" 
```

就这几行，就能把 Telegraf 接到 IotEdgeDB 上。

### 配置项说明

| 选项 | 说明 | 默认值 |
| --- | --- | --- |
| `url` | IotEdgeDB 的 写入端点 | 必填 |
| `api_key` | IotEdgeDB API Token，支持环境变量 | 必填 |
| `database` | IotEdgeDB 中的目标数据库 | `default` |
| `content_encoding` | 压缩方式（`gzip` 或空） | 空 |
| `timeout` | 请求超时时间 | `5s` |

这个插件使用 IotEdgeDB 的 行协议格式进行数据传输。配合 gzip 压缩后，尤其在高基数指标场景下，可以显著减少网络带宽消耗。

## 完整示例：采集系统指标

下面用一个完整的例子来演示如何把服务器的 CPU、内存、磁盘、网络和系统指标写入 IotEdgeDB。

先创建 `telegraf.conf`：

```toml
# Telegraf Agent 全局配置
[agent]
  interval = "10s"                # 数据采集频率
  round_interval = true           # 将采集间隔对齐到整时间点
  flush_interval = "10s"          # 数据发送频率
  flush_jitter = "0s"             # 避免所有 Agent 同时发送造成拥塞
  metric_batch_size = 1000        # 每个批次的最大指标数量
  metric_buffer_limit = 10000     # 单个输出插件缓冲区的最大指标数量
  collection_jitter = "0s"        # 采集抖动的最大值，用于分散采集
  precision = ""                  # 时间戳精度
  debug = false                   # 是否开启调试模式
  quiet = false                   # 是否仅显示错误日志
  logfile = ""                    # 日志文件路径，留空则输出到 stderr
  hostname = ""                   # 指标中使用的 host tag，留空则使用系统主机名
  omit_hostname = false           # 是否不在指标中设置 host tag

# 采集系统整体进程状态
[[inputs.processes]]

# CPU 采集配置
[[inputs.cpu]]
  ## 是否报告每个 CPU 核心的统计信息
  percpu = true
  ## 是否报告 CPU 整体统计信息
  totalcpu = true
  ## 是否采集原始 CPU 时间指标（如 time_user）
  collect_cpu_time = false
  ## 是否计算并上报所有非空闲 CPU 状态的累计时间（time_active）
  report_active = false
  ## 是否采集 CPU 核心 ID 和物理 ID 标签（仅部分平台支持）
  core_tags = false

# =========================================
# Memory (内存) 采集配置
# =========================================
[[inputs.mem]]
  # 采集系统内存指标（可用内存、已用内存、缓存、Buffers等）
  # 此插件无需特殊参数，保持空配即可默认采集所有核心指标

# =========================================
# Disk (磁盘使用率) 采集配置
# =========================================
[[inputs.disk]]
  ## 如果你只想采集指定的挂载点，取消下行的注释并修改
  # mount_points = ["/", "/data"]
  
  ## 忽略一些临时的虚拟文件系统，只采集物理磁盘
  ignore_fs = ["tmpfs", "devtmpfs", "devfs", "iso9660", "overlay", "aufs", "squashfs"]

# =========================================
# Disk IO (磁盘读写速率) 采集配置
# =========================================
[[inputs.diskio]]
  ## 默认采集所有物理磁盘的 IO（读写字节数、读写次数、耗时等）
  ## 如果只想采集特定的磁盘，可以这样配：
  # devices = ["sda", "sdb", "nvme0n1"]

# =========================================
# Network (网络流量) 采集配置
# =========================================
[[inputs.net]]
  ## 采集网卡的收发字节数（bytes_recv / bytes_sent）、错包、丢包等
  ## 默认采集所有网卡。如果只想采集主要的网卡，可以指定：
  # interfaces = ["eth0", "en0", "wlan0"]

# =========================================
# System (系统整体负载)
# =========================================
[[inputs.system]]
  # 采集系统的基础指标，如：load1, load5, load15（系统负载）和 uptime（运行时间）
  # 监控面板的头部通常都需要这些宏观指标
  fielddrop = ["uptime_format"]

# 输出到 GreptimeDB 的 HTTP API 配置
[[outputs.http]]
  url = "http://localhost:8000/api/v1/write/line-protocol"
  data_format = "influx"
    [outputs.http.headers]
    x-iedb-database = "default"
    x-api-key = "$token"

# =========================================
# 聚合器：合并同类项 (非常适合列式时序数据库)
# =========================================
[[aggregators.merge]]
  ## 告诉 Telegraf：如果发现表名(Measurement)、标签(Tags)和时间戳(Timestamp)完全一致的数据
  ## 请不要分开传，直接把它们的 Fields 合并成一个超级大字典，然后再发给输出端。
  drop_original = true
```

这份配置会：

+ 每 10 秒采集一次指标
+ 每次最多打包 1,000 条指标再刷新
+ 使用 gzip 压缩传输数据
+ 忽略虚拟文件系统
+ 采集每个 CPU 核心以及总 CPU 使用率

## 如何运行 Telegraf

### 方式一：使用 Docker

```bash

# 启动 Telegraf
sudo docker run -d \
  --name telegraf \
  -e TOKEN=$TOKEN \
  -v $(pwd)/telegraf.conf:/etc/telegraf/telegraf.conf:ro \
  -v /:/hostfs:ro \
  -e HOST_ETC=/hostfs/etc \
  -e HOST_PROC=/hostfs/proc \
  -e HOST_SYS=/hostfs/sys \
  -e HOST_VAR=/hostfs/var \
  -e HOST_RUN=/hostfs/run \
  -e HOST_MOUNT_PREFIX=/hostfs \
  telegraf:1.37
```

挂载宿主机文件系统后，Telegraf 就能在容器里读取主机的系统指标。

### 方式二：使用 Systemd 原生安装

如果你是在物理机或虚拟机上直接安装 Telegraf，可以参考下面的方式：

```bash
# 安装 Telegraf 1.37+（Debian / Ubuntu）
wget https://dl.influxdata.com/telegraf/releases/telegraf_1.37.0-1_amd64.deb
sudo dpkg -i telegraf_1.37.0-1_amd64.deb

# 复制配置文件
sudo cp telegraf.conf /etc/telegraf/telegraf.conf

# 把 API Token 放到环境变量里
sudo systemctl edit telegraf
# 添加：Environment="TOKEN=your-token-here"

# 启动服务
sudo systemctl enable telegraf
sudo systemctl start telegraf

# 查看状态
sudo systemctl status telegraf
```

## 验证数据是否已经写入 IotEdgeDB

Telegraf 启动后，先看日志确认它正在发送数据：

```bash
docker logs telegraf
```

然后查询 IotEdgeDB，确认表已经创建：

```bash
curl -X POST http://localhost:8000/api/v1/query \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sql": "SHOW TABLES FROM telegraf"}'
```

如果写入成功，你应该能看到这些指标表：`cpu`、`mem`、`disk`、`diskio`、`net`、`system`、`processes`、`swap`。

## 示例查询

下面是一些常见的查询示例。

### CPU 使用情况

```sql
SELECT time, host, cpu, usage_user, usage_system, usage_idle
FROM telegraf.cpu
WHERE time > NOW() - INTERVAL '1 hour'
AND cpu = 'cpu-total'
ORDER BY time DESC
LIMIT 100;
```

### 内存使用情况

```sql
SELECT time, host, used_percent, available, used, total
FROM telegraf.mem
WHERE time > NOW() - INTERVAL '1 hour'
ORDER BY time DESC
LIMIT 50;
```

### 按挂载点查看磁盘空间

```sql
SELECT time, host, path, used_percent, free, total
FROM telegraf.disk
WHERE time > NOW() - INTERVAL '1 hour'
ORDER BY time DESC;
```

### 网络吞吐

```sql
SELECT time, host, interface, bytes_sent, bytes_recv, packets_sent, packets_recv
FROM telegraf.net
WHERE time > NOW() - INTERVAL '1 hour'
ORDER BY time DESC;
```

### 系统负载

```sql
SELECT time, host, load1, load5, load15, uptime
FROM telegraf.system
WHERE time > NOW() - INTERVAL '1 hour'
ORDER BY time DESC;
```

## 你还能采集什么

系统指标只是开始。Telegraf 还能采集很多其他类型的数据。

### 数据库

无需自己写埋点，就能监控数据库性能：

```toml
# PostgreSQL
[[inputs.postgresql]]
address = "postgres://user:password@localhost/dbname"

# MySQL
[[inputs.mysql]]
servers = ["user:password@tcp(localhost:3306)/"]

# MongoDB
[[inputs.mongodb]]
servers = ["mongodb://localhost:27017"]

# Redis
[[inputs.redis]]
servers = ["tcp://localhost:6379"]
```

### 容器与编排

```toml
# Docker 容器
[[inputs.docker]]
endpoint = "unix:///var/run/docker.sock"

# Kubernetes
[[inputs.kubernetes]]
url = "http://localhost:10255"
```

### 云服务

```toml
# AWS CloudWatch
[[inputs.cloudwatch]]
region = "us-east-1"
namespace = "AWS/EC2"

# Azure Monitor
[[inputs.azure_monitor]]
subscription_id = "your-subscription-id"
```

### 消息队列

```toml
# Kafka
[[inputs.kafka_consumer]]
brokers = ["localhost:9092"]
topics = ["telegraf"]

# RabbitMQ
[[inputs.rabbitmq]]
url = "http://localhost:15672"
```

### IoT 与工业场景

```toml
# MQTT 传感器
[[inputs.mqtt_consumer]]
servers = ["tcp://localhost:1883"]
topics = ["sensors/#"]

# Modbus 工业设备
[[inputs.modbus]]
name = "device"
slave_id = 1
timeout = "1s"
```

这些插件以及更多扩展，现在都可以直接和 IotEdgeDB 配合使用。

## 为什么“可移植存储”很重要

Telegraf 负责采集，IotEdgeDB 负责存储，而且将数据保存在标准的 Parquet 文件中。这样一来，数据就不再被锁死在某个私有格式里。

Parquet 是开放格式，几乎所有数据工具都能读取：DuckDB、Spark、pandas、Snowflake 都可以直接使用。

这意味着：

+ 你可以把 5 年前的 CPU 指标直接拿到 Jupyter Notebook 里分析
+ 你可以把监控数据和业务数据放到同一个数仓里联查
+ 你也可以随时迁移到其他分析工具，而不用重做数据导出

Telegraf 提供采集灵活性，IotEdgeDB 提供存储可移植性。组合起来，就是一个没有供应商锁定的监控方案。

## 总结

IotEdgeDB 的 Telegraf 输出插件，让监控数据接入变得更简单，也更开放：

+ 300+ 输入插件，覆盖几乎所有常见数据源
+ 使用 MessagePack 和 gzip，高效传输指标
+ 数据以标准 Parquet 格式保存，便于后续分析
+ 可以直接用 SQL 查询时序指标
+ 数据始终可迁移、可访问，没有厂商锁定

如果你已经在用 Telegraf，那么切到 IotEdgeDB 只需要改一下输出配置。如果你正在搭建新的监控系统，Telegraf + IotEdgeDB 能同时给你采集广度和存储灵活性。

现在就可以试试这个插件了。