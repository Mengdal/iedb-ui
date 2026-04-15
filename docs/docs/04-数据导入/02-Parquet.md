直接将现有的 Parquet 文件导入 IEDB。用于数据湖集成、分析管道输出或从其他列式存储迁移。

## 接口
```plain
POST /api/v1/import/parquet
```

## 请求头
| **Header** | **必填** | **默认** | **描述** |
| --- | --- | --- | --- |
| `Authorization` | 是 | - | `Bearer $TOKEN` |


## 查询参数
| **参数** | **必填** | **默认** | **描述** |
| --- | --- | --- | --- |
| `db` | 是 | **-** | 目标数据库 |
| `measurement` | 是 | - | 测量表 |
| `time_column` | 否 | `time` | Parquet 文件中时间戳列的名称 |


## 实例
```bash
curl -X POST "http://localhost:8000/api/v1/import/parquet?db=production&measurement=metrics" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@data_export.parquet"
```

## 响应
```json
{
  "status": "ok",
  "result": {
    "database": "production",
    "measurement": "metrics",
    "rows_imported": 1200000,
    "partitions_created": 8,
    "time_range_min": "2026-01-01T00:00:00Z",
    "time_range_max": "2026-01-01T07:45:00Z",
    "columns": ["time", "host", "region", "cpu_usage", "mem_usage"],
    "duration_ms": 890
  }
}
```

## 提示
+ **Parquet 文件必须包含时间戳列**（默认列名为 `time`）。如果您的列名不同，请使用 `time_column` 参数指定。
+ 可以直接读取 Parquet 文件，无需转换开销。
+ 无论源文件的结构如何，数据都会按照 IEDB 的小时分区布局重新分区。
+ 系统会自动检测并解压缩 Gzip 压缩的 Parquet 文件。
+ 最大文件大小：**500 MB**（解压缩后）。
+ RBAC：检查目标测量表的写入权限。

## 错误响应
| **地位** | **描述** |
| --- | --- |
| `400` | 数据库、测量数据或文件缺失 |
| `403` | 写入权限不足 |
| `413` | 文件大小超过 500 MB 限制 |
| `500` | 导入执行错误 |


