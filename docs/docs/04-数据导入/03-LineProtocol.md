将 InfluxDB 行协议文件导入 IEDB 。通过上传 `.lp` 或 `.txt` 文件（纯文本或 gzip 压缩），实现从 InfluxDB 一键迁移。

流式传输与批量传输

本页介绍如何通过**批量文件导入**`POST /api/v1/import/lp`。有关行协议的流式写入（实时写入），请参阅 API 参考 中的 [POST /api/v1/write/line-protocol](../03-API参考.md)

## 接口
```plain
POST /api/v1/import/lp
```

## 请求头
| **Header** | **必填** | **默认** | **描述** |
| --- | --- | --- | --- |
| `Authorization` | 是 | - | `Bearer $TOKEN` |


## 查询参数
| **范围** | **必需的** | **默认** | **描述** |
| --- | --- | --- | --- |
| `db` | 是 | - | 目标数据库 |
| `measurement` | 否 | _（全部）_ | 从行协议文件中筛选出单个测量表 |
| `precision` | 否 | `ns` | 时间戳精度：`ns``us`<br/>`ms``s` |


## 示例1
```bash
curl -X POST "http://localhost:8000/api/v1/import/lp?db=mydb" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@export.lp"
```

## 示例2
```bash
# 导入秒精度时间戳的行协议文件
curl -X POST "http://localhost:8000/api/v1/import/lp?db=mydb&precision=s" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@export_seconds.lp"
```

## 响应
```json
{
  "status": "ok",
  "result": {
    "database": "mydb",
    "measurements": ["cpu", "mem", "disk"],
    "rows_imported": 150000,
    "precision": "ns",
    "duration_ms": 342
  }
}
```

## InfluxDB 迁移
从 InfluxDB 导出并直接导入到 IEDB：

```bash
# 从 InfluxDB 1.x 导入
influx -execute "SELECT * FROM cpu" -database mydb -format lp > export.lp

# 导入 IEDB
curl -X POST "http://localhost:8000/api/v1/import/lp?db=mydb" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@export.lp"
```

## 工作原理
数据流经 IEDB 的高性能列式数据写入管道（ArrowBuffer -> ArrowWriter -> Parquet -> 存储）——与流式行协议数据写入使用的路径相同。这意味着批量导入也能受益于相同的吞吐量、排序优化和按小时分区。

## 提示
+ **多重测量**——一个行协议文件可以包含多个测量表；所有测量表都在一次请求中导入。
+ **精度感知**——时间戳会从指定的精度无损转换为 IEDB 的内部微秒格式。
+ **支持 Gzip**——压缩文件（`.lp.gz`）会自动检测并通过特征字节进行解压缩。
+ **RBAC——**对文件中的每个测量表检查写入权限。
+ 最大文件大小：**500 MB**（解压缩后）。

## 错误响应
| **地位** | **描述** |
| --- | --- |
| `400` | 数据库缺失、精度无效或未上传文件 |
| `403` | 一个或多个测量数据的写入权限不足 |
| `413` | 文件大小超过 500 MB 限制 |
| `500` | 导入执行错误 |


