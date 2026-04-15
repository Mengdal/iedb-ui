通过 REST API 将 CSV 文件导入 IEDB。分析引擎读取文件，自动检测列类型，按小时对数据进行分区，并将优化的 Parquet 文件写入存储。

## 接口
```plain
POST /api/v1/import/csv
```

## 请求头
| **Header** | **必填** | **默认** | **描述** |
| --- | --- | --- | --- |
| `Authorization` | 是 | - | `Bearer $TOKEN` |


## 查询参数
| 参数 | 必填 | 默认值 | 描述 |
| --- | --- | --- | --- |
| `db` | 是 | - | 目标数据库 |
| `measurement` | 是 | - | 目标测量表 |
| `time_column` | 否 | `time` | CSV 中时间戳列的名称 |
| `time_format` | 否 | `auto-detect` | 时间戳格式：`epoch_s`、`epoch_ms`、`epoch_us`、`epoch_ns`，或留空以自动检测 |
| `delimiter` | 否 | `,` | 列分隔符字符 |
| `skip_rows` | 否 | `0` | 在 CSV 表头之前需要跳过的行数（如标题行、元数据行） |


## 示例1
```bash
curl -X POST "http://localhost:8000/api/v1/import/csv?db=iot&measurement=sensors" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@sensor_data.csv"
```

## 示例2
```bash
# TSV 文件，使用秒级 epoch 时间戳，并跳过前 2 行元数据
curl -X POST "http://localhost:8000/api/v1/import/csv?db=satellites&measurement=telemetry&time_column=ts&time_format=epoch_s&delimiter=%09&skip_rows=2" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@telemetry_export.tsv"
```

## 响应
```json
{
  "status": "ok",
  "result": {
    "database": "iot",
    "measurement": "sensors",
    "rows_imported": 50000,
    "partitions_created": 3,
    "time_range_min": "2026-01-15T00:00:00Z",
    "time_range_max": "2026-01-15T02:30:00Z",
    "columns": ["time", "temperature", "humidity", "device_id"],
    "duration_ms": 245
  }
}
```

## 提示
+ **与行协议（Line Protocol）导入不同，在 CSV 导入时，测量表（measurement）参数是必需的**。
+ **时间列**在输出的 Parquet 文件中会被重命名为 `time`。
+ 为了获得最佳查询性能，数据将按小时自动分区。
+ Gzip 压缩的 CSV 文件（`.csv.gz`）会自动检测并解压缩。
+ 最大文件大小：**500 MB**（解压缩后）。
+ RBAC：检查目标测量表的写入权限。
+ 分析引擎会自动检测列类型。数值列 numberic 会变成`DOUBLE` ，文本列 text 会变成 `VARCHAR`。

## 错误响应
| **地位** | **描述** |
| --- | --- |
| `400` | 数据库、测量表或文件缺失 |
| `403` | 写入权限不足 |
| `413` | 文件大小超过 500 MB 限制 |
| `500` | 导入执行错误 |


