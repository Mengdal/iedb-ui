# 查询指南
使用 DuckDB 作为其 SQL 引擎，为您提供对存储为 Parquet 文件的数据进行全面分析的 SQL 功能。

## SQL 语法
查询使用以下格式`database.measurement`作为表名：

```sql
SELECT * FROM mydb.cpu LIMIT 10
```

如果你的数据库名称是 `default`，则可以省略它：

```sql
SELECT * FROM default.cpu LIMIT 10
```

## 查询接口
| **接口** | **响应格式** | **适用场景** |
| --- | --- | --- |
| `POST /api/v1/query` | JSON | 小结果集，调试，仪表盘 |
| `POST /api/v1/query/arrow` | Apache Arrow IPC | 结果集巨大 (每秒 600 万行以上) |
| `GET /api/v1/query/:measurement` | JSON | 测量表快速查询 |


### JSON 查询
```bash
curl -X POST "http://localhost:8000/api/v1/query" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT * FROM default.cpu WHERE time > NOW() - INTERVAL '\''1 hour'\'' LIMIT 100"}'
```

### Arrow 查询
对于大型结果集，Arrow IPC 的吞吐量比 JSON 大约 2 倍：

```bash
curl -X POST "http://localhost:8000/api/v1/query/arrow" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT * FROM default.cpu LIMIT 1000000"}' \
  -o results.arrow
```

## 时间查询
IEDB 将时间戳存储在`time`列中。对于时间范围查询，请使用标准 SQL 时间间隔：

```sql
-- 一小时前
SELECT * FROM default.cpu
WHERE time > NOW() - INTERVAL '1 hour';

-- 七天前
SELECT * FROM default.cpu
WHERE time > NOW() - INTERVAL '7 days';

-- 制定时间范围
SELECT * FROM default.cpu
WHERE time BETWEEN '2026-01-01' AND '2026-01-31';
```

注意：

使用时间范围筛选器`time`会自动触发分区修剪，跳过范围之外的 Parquet 文件。为了获得最佳性能，请始终包含时间筛选器。

## 时间聚合
### time_bucket
将数据分组到固定大小的时间间隔内：

```sql
-- 过去七天小时聚合值
SELECT
  time_bucket('1 hour', time) AS bucket,  -- 将时间按 1 小时分组，生成每个小时的起始时间戳
  AVG(cpu_usage) AS avg_cpu,              -- 计算每个小时内的平均 CPU 使用率
  MAX(cpu_usage) AS max_cpu,              -- 计算每个小时内的最大 CPU 使用率
  COUNT(*) AS samples                     -- 统计每个小时内的原始数据点数量
FROM default.cpu                          -- 从 default 数据库的 cpu 表中读取数据
WHERE time > NOW() - INTERVAL '7 days'    -- 筛选最近 7 天的数据
GROUP BY bucket                           -- 按时间桶分组
ORDER BY bucket;                          -- 按时间升序排列结果
```

### date_trunc
将时间戳截断至日历边界（例如按年、月、日、小时等对齐）。

```sql
-- 过去 30 天的每日汇总
SELECT
  date_trunc('day', time) AS day,
  host,
  AVG(cpu_usage) AS avg_cpu,
  AVG(mem_usage) AS avg_mem
FROM default.cpu
WHERE time > NOW() - INTERVAL '30 days'
GROUP BY day, host
ORDER BY day DESC, host;
```

## Window Functions
**计算窗口滚动指标并检测异常**

```sql
-- 10分钟移动平均与异常检测
SELECT
  time,                    -- 原始时间戳
  host,                    -- 主机标识
  cpu_usage,               -- 当前采样点的 CPU 使用率
  AVG(cpu_usage) OVER (    -- 基于最近 10 个点的移动平均
    PARTITION BY host
    ORDER BY time
    ROWS BETWEEN 10 PRECEDING AND CURRENT ROW
  ) AS moving_avg,
  cpu_usage - AVG(cpu_usage) OVER (   -- 当前值与过去 60 个点平均值的差值
    PARTITION BY host
    ORDER BY time
    ROWS BETWEEN 60 PRECEDING AND CURRENT ROW
  ) AS deviation
FROM default.cpu
WHERE time > NOW() - INTERVAL '1 hour';   -- 只取最近一小时数据
```

## 通用表表达式 (CTEs)
将复杂查询分解为可读的步骤。

```sql
-- 查找出现 CPU 异常峰值的主机
WITH hourly_stats AS (
  SELECT
    host,
    time_bucket('1 hour', time) AS bucket,  -- 按小时分桶
    AVG(cpu_usage) AS avg_cpu,              -- 平均 CPU 使用率
    STDDEV(cpu_usage) AS std_cpu            -- CPU 使用率的标准差
  FROM default.cpu
  WHERE time > NOW() - INTERVAL '24 hours'  -- 最近 24 小时
  GROUP BY host, bucket
),
anomalies AS (
  SELECT *
  FROM hourly_stats
  WHERE avg_cpu > 80 OR std_cpu > 20        -- 异常阈值：平均 >80% 或标准差 >20
)
SELECT host, bucket, avg_cpu, std_cpu
FROM anomalies
ORDER BY avg_cpu DESC;                      -- 按平均 CPU 使用率降序排列
```

## 跨数据库查询
整合跨数据库和测量表的数据：

```sql
-- 将 CPU 指标与部署事件关联查询
SELECT
  c.time,
  c.host,
  c.cpu_usage,
  d.version
FROM production.cpu c
JOIN production.deployments d
  ON c.host = d.host
  AND c.time BETWEEN d.time AND d.time + INTERVAL '1 hour'
WHERE c.time > NOW() - INTERVAL '24 hours';
```

## 常用函数
支持所有 DuckDB 函数。以下是一些最常用于分析查询的函数：

| 函数 | 作用 | 示例 |
| --- | --- | --- |
| `NOW()` | 当前时间戳 | `WHERE time > NOW() - INTERVAL '1h'` |
| `time_bucket(interval, time)` | 固定大小的时间桶 | `time_bucket('5 minutes', time)` |
| `date_trunc(part, time)` | 按日历边界截断时间 | `date_trunc('day', time)` |
| `epoch(time)` | 将时间戳转换为秒数（Unix时间戳） | `epoch(time)` |
| `PERCENTILE_CONT(p)` | 连续百分位数 | `PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency)` |
| `APPROX_QUANTILE(col, p)` | 近似分位数（速度更快） | `APPROX_QUANTILE(latency, 0.99)` |
| `STDDEV(col)` | 标准差 | `STDDEV(cpu_usage)` |
| `LAG(col) OVER (...)` | 上一行的值 | `LAG(value) OVER (ORDER BY time)` |
| `LEAD(col) OVER (...)` | 下一行的值 | `LEAD(value) OVER (ORDER BY time)` |


## 性能调优
1. **始终使用时间过滤** —— 分区裁剪会直接跳过不在时间范围内的整个 Parquet 文件，查询速度通常可提升 10 到 100 倍。
2. **结果集较大时使用 Arrow 格式** —— 对于超过 10 万行的结果集，Arrow IPC 的吞吐量约为 JSON 的 2 倍。
3. **限制结果集大小** —— 在探索数据时添加 LIMIT 子句。不加限制地扫描数百万行数据开销很大。
4. **在服务端进行聚合计算** —— 在 SQL 中直接计算 AVG、COUNT、SUM 等，而不是将原始数据拉到客户端再聚合。
5. **优先使用 APPROX_QUANTILE 而非 PERCENTILE_CONT** —— 对于大型数据集，近似分位数的计算速度可快 10 到 100 倍。
6. **优先使用 time_bucket 而非 date_trunc** —— `time_bucket` 支持任意时间间隔（如 5 分钟、15 分钟、4 小时），而 `date_trunc` 只能按日历边界（年、月、日、小时）截断。

## 后续步骤
+ [**API 参考**](../03-API参考.md)-- 完整接口文档
+ [**数据保留策略**](../08-数据生命周期/01-保留策略.md)——自动数据过期
+ [**连续查询**](../08-数据生命周期/03-连续查询.md)——实时聚合和降采样

