# Grafana 集成

通过 Grafana + IotEdgeDB 数据源插件，你可以直接查询时序数据并构建监控看板。结合标准 SQL 与 Grafana 时间宏，可以快速完成主机、数据库、网络等指标可视化。

## 概述

Grafana 是常用的可观测性可视化平台，适合做时序监控、告警和运维看板。  
IotEdgeDB 的 Grafana 数据源插件让你可以在 Grafana 中直接连接 IotEdgeDB，并使用 SQL 查询数据。

根据用户反馈，在将后端从 InfluxDB 替换为 IotEdgeDB 后，CPU 和内存占用都出现了明显下降，说明在同类监控场景中可以获得更好的资源效率。

## 使用示例
![Grafana 数据源配置](/img/dashboard.png)


## 快速开始

如果你想快速体验，可以按下面 4 步走：

1. 安装插件：`iotedgedb-grafana-datasource`
2. 在 Grafana 中添加 IotEdgeDB 数据源
3. 使用 SQL + 时间宏写查询
4. 使用 `$__timeFilter()` 做时间范围过滤

## 安装插件

```bash
# 安装Grafana
docker run -d \
  --name=grafana \
  --restart=always \
  -p 3000:3000 \
  -e "GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=iotedgedb-grafana-datasource" \
  -v grafana-storage:/var/lib/grafana \
  grafana/grafana

# 下载最新的发行版本
wget https://github.com/Mengdal/iotedgedb-grafana-datasource/releases/download/<version>/iotedgedb-grafana-datasource-<version>.zip
unzip iotedgedb-grafana-datasource-<version>.zip

# 安装到 Grafana 插件目录
docker cp iotedgedb-grafana-datasource grafana:/var/lib/grafana/plugins/
docker restart grafana

# 详情参阅
git clone https://github.com/Mengdal/iotedgedb-grafana-datasource
```

## 在 Grafana 中添加 IotEdgeDB 数据源
![Grafana 数据源配置](/img/datasource.png)

进入 Grafana：

1. 打开 **Configuration → Data sources**
2. 点击 **Add data source**
3. 搜索并选择 **IotEdgeDB**
4. 配置连接参数
5. 点击 **Save & Test**

### 配置项说明

| 配置项 | 说明 | 是否必填 | 默认值 |
| --- | --- | --- | --- |
| URL | IotEdgeDB API 地址 | 是 | - |
| API Key | 认证令牌 | 是 | - |
| Database | 默认数据库名 | 否 | `default` |
| Timeout | 查询超时（秒） | 否 | `30` |
| Use Arrow | 是否启用 Arrow 协议 | 否 | `true`（推荐） |

## 查询与使用

### 查询编辑器能力
![查询编辑器](/img/query-editor.png)
![查询编辑器](/img/inspect.png)

IotEdgeDB 数据源插件在 Grafana 中提供 SQL 查询编辑器，支持：

- 语法高亮
- 表字段自动补全
- Grafana 时间范围宏

### 示例查询：CPU 使用率

```sql
SELECT
  time_bucket(INTERVAL '$__interval', time) as time,
  AVG(usage_idle) * -1 + 100 AS cpu_usage,
  host
FROM cpu
WHERE cpu = 'cpu-total'
  AND $__timeFilter(time)
GROUP BY time_bucket(INTERVAL '$__interval', time), host
ORDER BY time ASC
```

### 示例查询：内存使用率

```sql
SELECT
  time_bucket(INTERVAL '$__interval', time) as time,
  AVG(used_percent) AS memory_used,
  host
FROM mem
WHERE $__timeFilter(time)
GROUP BY time_bucket(INTERVAL '$__interval', time), host
ORDER BY time ASC
```

### 示例查询：网络流量（字节转比特）

```sql
SELECT
  time_bucket(INTERVAL '$__interval', time) as time,
  AVG(bytes_recv) * 8 AS bits_in,
  host,
  interface
FROM net
WHERE $__timeFilter(time)
GROUP BY time_bucket(INTERVAL '$__interval', time), host, interface
ORDER BY time ASC
```

## 常用宏（Macros）

| 宏 | 说明 | 示例 |
| --- | --- | --- |
| `$__timeFilter(columnName)` | 完整时间范围过滤 | `WHERE $__timeFilter(time)` |
| `$__timeFrom()` | 起始时间 | `time >= $__timeFrom()` |
| `$__timeTo()` | 结束时间 | `time < $__timeTo()` |
| `$__interval` | Grafana 计算出的聚合间隔 | `time_bucket(INTERVAL '$__interval', time)` |

## 变量（Variables）

![变量配置](/img/variables.png)

可以在 Dashboard 里定义变量，让查询动态化。

### Host 变量


```sql
SELECT DISTINCT host FROM cpu ORDER BY host
```

### Interface 变量

```sql
SELECT DISTINCT interface FROM net ORDER BY interface
```

查询中使用变量：

```sql
SELECT
  time_bucket(INTERVAL '$__interval', time) as time,
  AVG(usage_idle) * -1 + 100 AS cpu_usage
FROM cpu
WHERE host = '$server'
  AND cpu = 'cpu-total'
  AND $__timeFilter(time)
GROUP BY time_bucket(INTERVAL '$__interval', time)
ORDER BY time ASC
```

## 性能优化建议

- **保持 Arrow 开启**：相较 JSON，Arrow 传输性能更好。
- **缩小时间范围**：时间窗口越大，查询越慢，尽量按需查看。
- **合理使用 `time_bucket()`**：避免返回过多点位。
- **优先按时间过滤**：时序查询中先过滤时间范围，通常性能更稳定。

## 告警（Alerting）
![告警配置](/img/alerts.png)

IotEdgeDB 数据源支持 Grafana 告警。  
可以先写一个告警查询，再在 Grafana 告警规则里设置阈值条件。

示例（CPU > 80%）：

```sql
SELECT
  time,
  100 - usage_idle AS cpu_usage,
  host
FROM telegraf.cpu
WHERE cpu = 'cpu-total'
  AND time >= NOW() - INTERVAL '5 minutes'
ORDER BY time ASC
```

告警条件示例：

`WHEN avg() OF query(A, 5m, now) IS ABOVE 80`

## 故障排查

### 插件未显示

- 重新启动 Grafana：`docker restart grafana` or `systemctl restart grafana-server`
- 查看 Grafana 日志：`journalctl -u grafana-server -f`

### 连接测试失败

- 确认 IotEdgeDB 服务可访问
- 确认 API Key 有效
- URL 里包含协议头（`http://` 或 `https://`）

### 查询无数据

- 检查时间字段是否为时间戳类型
- 检查当前时间范围内是否存在数据
- 确认查询使用了 `$__timeFilter(time)`

## 参考链接

- [IotEdgeDB + Grafana 数据源插件仓库](https://github.com/Mengdal/iotedgedb-grafana-datasource)
- [Grafana 仓库](https://github.com/grafana/grafana)
- [Telegraf 仓库](https://github.com/influxdata/telegraf)
