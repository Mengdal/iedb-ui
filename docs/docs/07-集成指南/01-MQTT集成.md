直接从 MQTT 代理服务器数写入数据到 IEDB，无需中间件即可连接到物联网设备、工业传感器和消息代理服务器。

## 概述
IEDB 提供原生 MQTT 订阅功能，并支持动态的 API 驱动配置。无需重启服务器，即可在运行时管理多个 MQTT 代理和订阅。

**主要特点：**

+ **基于 API 的订阅管理**- 通过 REST API 创建、更新、删除、启动/停止订阅
+ **多个并发代理**- 连接到不同的 MQTT 代理以获取不同的数据源
+ **主题通配符**- 使用`+`（单级）和`#`（多级）通配符订阅
+ **自动检测**- 自动检测 JSON 和 MessagePack 消息格式
+ **高性能**——使用 MessagePack 列式格式时约为 600 万条记录/秒
+ **主题映射**- 从主题路径段中提取标签
+ **TLS/SSL 支持**- 客户端证书和 CA 验证
+ **加密凭证**- 使用 AES-256-GCM 加密静态密码
+ **自动重连**- 连接中断时采用指数退避策略
+ **QoS 支持**- QoS 0、1 和 2

## 前提
+ IEDB 服务器正在运行
+ API Token（如果启用身份验证）
+ 可通过 IEDB 服务器访问的 MQTT 代理

## 快速入门
### 1. 在 IEDB 中启用 MQTT
```toml
[mqtt]
enabled = true
```

重启 IEDB 以应用配置。

### 2. 创建订阅
```bash
curl -X POST http://localhost:8000/api/v1/mqtt/subscriptions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "factory-sensors",
    "broker": "tcp://localhost:1883",
    "topics": ["sensors/#"],
    "database": "iot",
    "auto_start": true
  }'
```

**响应：**

```json
{
  "id": "sub_abc123",
  "name": "factory-sensors",
  "broker": "tcp://localhost:1883",
  "topics": ["sensors/#"],
  "database": "iot",
  "status": "running",
  "created_at": "2026-02-13T10:00:00Z"
}
```

### 3. 发送测试数据
向您的 MQTT 服务器发布消息：

```bash
mosquitto_pub -h localhost -t "sensors/temperature" \
  -m '{"time": 1706745600000000, "value": 23.5, "device_id": "sensor-001"}'
```

### 4. 查询数据
```bash
curl -X POST http://localhost:8000/api/v1/query \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "SELECT * FROM iot.temperature ORDER BY time DESC LIMIT 10",
    "format": "json"
  }'
```

## API 参考
### 订阅管理
| **方法** | **端点** | **描述** |
| --- | --- | --- |
| `POST` | `/api/v1/mqtt/subscriptions` | 创建新订阅 |
| `GET` | `/api/v1/mqtt/subscriptions` | 列出所有订阅 |
| `GET` | `/api/v1/mqtt/subscriptions/{id}` | 获取订阅详情 |
| `PUT` | `/api/v1/mqtt/subscriptions/{id}` | 更新订阅 |
| `DELETE` | `/api/v1/mqtt/subscriptions/{id}` | 删除订阅 |


### 生命周期控制
| **方法** | **端点** | **描述** |
| --- | --- | --- |
| `POST` | `/api/v1/mqtt/subscriptions/{id}/start` | 开始订阅 |
| `POST` | `/api/v1/mqtt/subscriptions/{id}/stop` | 停止订阅 |
| `POST` | `/api/v1/mqtt/subscriptions/{id}/restart` | 重新订阅 |


### 监测
| **方法** | **端点** | **描述** |
| --- | --- | --- |
| `GET` | `/api/v1/mqtt/subscriptions/{id}/stats` | 获取订阅统计信息 |
| `GET` | `/api/v1/mqtt/stats` | 汇总统计数据（所有订阅） |
| `GET` | `/api/v1/mqtt/health` | 健康检查 |


## 订阅选项
### 创建订阅请求
```json
{
  "name": "factory-sensors",
  "broker": "tcp://localhost:1883",
  "topics": ["sensors/#", "factory/+/metrics"],
  "database": "iot",
  "qos": 1,
  "client_id": "iedb-factory",
  "username": "mqtt_user",
  "password": "mqtt_pass",
  "tls_enabled": false,
  "tls_cert_path": "/path/to/client.crt",
  "tls_key_path": "/path/to/client.key",
  "tls_ca_path": "/path/to/ca.crt",
  "topic_mapping": {},
  "keep_alive_seconds": 60,
  "connect_timeout_seconds": 30,
  "reconnect_min_seconds": 1,
  "reconnect_max_seconds": 60,
  "auto_start": true
}
```

### 字段配置
| **字段** | **类型** | **必选** | **默认值** | **描述** |
| --- | --- | --- | --- | --- |
| `name` | string | Yes | - | 唯一订阅名称 |
| `broker` | string | Yes | - | 代理 URL（tcp://、ssl://、ws://） |
| `topics` | array | Yes | - | 订阅主题 |
| `database` | string | Yes | - | 目标数据库 |
| `qos` | int | No | 1 | 服务质量等级：0、1 或 2 |
| `client_id` | string | No | auto | MQTT客户端ID |
| `username` | string | No | - | MQTT 用户名 |
| `password` | string | No | - | MQTT密码（静态加密） |
| `tls_enabled` | bool | No | false | 启用 TLS/SSL |
| `tls_cert_path` | string | No | - | 客户端证书路径 |
| `tls_key_path` | string | No | - | 客户端密钥路径 |
| `tls_ca_path` | string | No | - | CA证书路径 |
| `topic_mapping` | object | No | | 主题到测量表的映射 |
| `keep_alive_seconds` | int | No | 60 | MQTT保活间隔 |
| `connect_timeout_seconds` | int | No | 30 | 连接超时时间 |
| `reconnect_min_seconds` | int | No | 1 | 最小重连时间 |
| `reconnect_max_seconds` | int | No | 60 | 最大重连时间 |
| `auto_start` | bool | No | true | 自动重启 |


## 消息格式
IEDB  会根据内容自动检测消息格式。

#### 标准格式
```bash
{
    "measurement": "environment",
    "time": 1706248500000,
    "tags": {
        "location": "office",
        "sensor_id": "S001"
    },
    "fields": {
        "temperature": 25.5,
        "humidity": 60.2,
        "status": "active"
    }
}
```

+ measurement或简写为 "m"。不填默认为 "mqtt"
+ time或 "t", "timestamp"。支持秒、毫
+ tags 索引字段 (String)
+ fields 数据字段 (Int, Float, String, Bool)

#### 扁平/IoT 格式
+ 简化格式，适合直接从设备转发的数据。系统会自动将顶层字段识别为 Fields，将 dn 识别为 Tags。
+ dn (Device Name)：会自动被转换为 Tag。
+ 其他字段：自动转换为 Fields。
+ 嵌套对象：例如 properties 下的字段会被自动展平提取到根 Fields 中。
+ (1) 示例 A：直接平铺: 此时 Measurement 默认为 "mqtt"，时间默认为当前接收时间

```bash
{
    "dn": "device_1024",
    "temperature": 23.5,
    "voltage": 3.6
}
```



+ (2) 示例 B：包含属性对象 某些 IoT 平台（如阿里云/腾讯云）常见格式，会自动展平 properties 等嵌套对象。

```bash
{
  "sys_id": "123",
  "properties": {
  "current": 1.2,
  "power": 220
  }
}
```

+ (3) 罗米云默认使用数组对象批量上传格式

```bash
  [{
  "desc": "",
  "dn": "Device1",
  "properties": {
  "E": 3660.25,
  "EQ": 0,
  "Er": 0
  },
  "time": 1769413400
  },
  {
  "desc": "",
  "dn": "Device2",
  "properties": {
  "Ua": 260,
  "Ub": 260,
  "Uc": 260
  },
  "time": 1769413400
  }]
```

### MessagePack 列式（最快）
结构与 JSON 相同，但采用 MessagePack 编码。

```json
{
  "m": "temperature",
  "columns": {
    "time": [1706745600000000, 1706745601000000],
    "value": [23.5, 23.6],
    "device_id": ["sensor-001", "sensor-001"]
  }
}
```

**性能：**使用 MessagePack 列式格式时约为 600 万条记录/秒。

### 时间戳处理
+ 如果`time`该字段存在：自动检测毫秒/微秒/纳秒
+ 如果`time`该字段缺失：则使用当前 UTC 时间。

## 主题映射
### 自动映射（默认）
默认情况下，主题的最后一个部分将成为测量表名称：

| **Topic** | **Measurement 测量表** |
| --- | --- |
| `sensors/temperature` | `temperature` |
| `factory/line1/metrics` | `metrics` |
| `iot/devices/sensor-001/data` | `data` |


### 使用标签提取进行显式映射
从主题路径段中提取值作为标签：

```json
{
  "name": "factory-sensors",
  "broker": "tcp://localhost:1883",
  "topics": ["sensors/+/+/data"],
  "database": "iot",
  "topic_mapping": {
    "sensors/+/+/data": {
      "database": "iot",
      "measurement": "sensor_data",
      "tags_from_topic": [
        {"position": 1, "tag_name": "location"},
        {"position": 2, "tag_name": "sensor_id"}
      ]
    }
  }
}
```

**示例：**

+ topic：`sensors/factory-1/temp-001/data`
+ database：`iot`
+ measurement：`sensor_data`
+ tags：`location=factory-1`，`sensor_id=temp-001`

## 授权
### 身份验证
```bash
curl -X POST http://localhost:8000/api/v1/mqtt/subscriptions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "authenticated-broker",
    "broker": "tcp://broker.example.com:1883",
    "topics": ["data/#"],
    "database": "production",
    "username": "mqtt_user",
    "password": "mqtt_password"
  }'
```

### 密码加密
密码在存储时使用 AES-256-GCM 加密。请设置加密密钥：

提示：只有当订阅设置了密码时才需要加密密钥。没有验证的订阅无需密钥即可正常工作。

## TLS/SSL 配置
### 服务器证书验证
```bash
curl -X POST http://localhost:8000/api/v1/mqtt/subscriptions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "secure-broker",
    "broker": "ssl://broker.example.com:8883",
    "topics": ["secure/#"],
    "database": "production",
    "tls_enabled": true,
    "tls_ca_path": "/etc/iedb/certs/ca.crt"
  }'
```

### 客户端证书认证（mTLS）
```bash
curl -X POST http://localhost:8000/api/v1/mqtt/subscriptions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "mtls-broker",
    "broker": "ssl://broker.example.com:8883",
    "topics": ["secure/#"],
    "database": "production",
    "tls_enabled": true,
    "tls_cert_path": "/etc/iedb/certs/client.crt",
    "tls_key_path": "/etc/iedb/certs/client.key",
    "tls_ca_path": "/etc/iedb/certs/ca.crt"
  }'
```

## 配置示例
### 物联网-传感器
```bash
curl -X POST http://localhost:8000/api/v1/mqtt/subscriptions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "iot-sensors",
    "broker": "tcp://mosquitto:1883",
    "topics": [
      "sensors/+/temperature",
      "sensors/+/humidity",
      "sensors/+/pressure"
    ],
    "database": "iot",
    "qos": 1,
    "topic_mapping": {
      "sensors/+/temperature": {
        "measurement": "temperature",
        "tags_from_topic": [{"position": 1, "tag_name": "sensor_id"}]
      },
      "sensors/+/humidity": {
        "measurement": "humidity",
        "tags_from_topic": [{"position": 1, "tag_name": "sensor_id"}]
      },
      "sensors/+/pressure": {
        "measurement": "pressure",
        "tags_from_topic": [{"position": 1, "tag_name": "sensor_id"}]
      }
    }
  }'
```

### 工业-工厂
```bash
curl -X POST http://localhost:8000/api/v1/mqtt/subscriptions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "factory-floor",
    "broker": "tcp://factory-mqtt:1883",
    "topics": ["factory/+/+/metrics"],
    "database": "manufacturing",
    "qos": 2,
    "topic_mapping": {
      "factory/+/+/metrics": {
        "measurement": "machine_metrics",
        "tags_from_topic": [
          {"position": 1, "tag_name": "line"},
          {"position": 2, "tag_name": "machine_id"}
        ]
      }
    }
  }'
```

## 监测
### 订阅统计
```bash
# 获取指定订阅的统计信息
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/v1/mqtt/subscriptions/{id}/stats

# 获取所有订阅的聚合统计信息
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/v1/mqtt/stats
```

**响应：**

```json
{
  "status": "success",
  "running_count": 2,
  "subscriptions_stats": {
    "sub_abc123": {
      "messages_received": 15420,
      "bytes_received": 2458320,
      "decode_errors": 0,
      "last_message_at": "2026-02-13T10:30:15Z",
      "topics": {
        "sensors/temperature": 8500,
        "sensors/humidity": 6920
      }
    }
  }
}
```

### 健康监测
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/v1/mqtt/health
```

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

### 指标监控
 IEDB 为 Prometheus 公开 MQTT 指标：

| **指标** | **类型** | **描述** |
| --- | --- | --- |
| `arc_mqtt_messages_received_total` | Counter | 收到的消息总数 |
| `arc_mqtt_bytes_received_total` | Counter | 接收到的总字节数 |
| `arc_mqtt_decode_errors_total` | Counter | 消息解码错误 |
| `arc_mqtt_connection_status` | Gauage | 连接状态（1=已连接） |


## 查询 MQTT 数据
### 基本查询
```sql
SELECT * FROM iot.temperature
ORDER BY time DESC
LIMIT 10;
```

### 基于时间的聚合
```sql
SELECT
  time_bucket(INTERVAL '5 minutes', time) as bucket,
  AVG(value) as avg_temp,
  MIN(value) as min_temp,
  MAX(value) as max_temp
FROM iot.temperature
WHERE time > NOW() - INTERVAL '1 hour'
GROUP BY bucket
ORDER BY bucket DESC;
```

### 按标签筛选
```sql
SELECT * FROM iot.sensor_data
WHERE sensor_id = 'temp-001'
  AND time > NOW() - INTERVAL '24 hours'
ORDER BY time DESC;
```

## 故障排除
### 连接失败
查看订阅状态：

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/v1/mqtt/subscriptions/{id}
```

如果状态为“是” `error`，请验证：

+ 代理服务器 URL 正确（tcp://、ssl://、ws://）
+ 代理服务器可从服务器访问。
+ 凭证正确
+ TLS证书有效

### 未显示任何数据
1. 验证订阅是否正在运行（状态应为“已运行`"running"`”）。
2. 查看已接收消息的统计信息
3. 验证主题模式是否与已发布主题匹配
4. 检查 IEDB 日志是否存在解码错误

### 消息无法解码
请确保消息格式为有效的 JSON 或 MessagePack：

```bash
# Test with simple JSON
mosquitto_pub -h localhost -t "test/data" \
  -m '{"time": 1706745600000000, "value": 42}'
```

检查统计信息中的解码错误：

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/v1/mqtt/subscriptions/{id}/stats
```

## 最佳实践
1. **使用描述性的订阅名称**——例如，这样的名称`prod-factory-floor-sensors`比这样的名称更容易管理`sub1`。
2. **按环境划分数据库**——生产环境、测试环境和开发环境使用不同的目标数据库。
3. **合理使用 QoS** ——QoS 0 用于最高吞吐量，QoS 1 用于可靠交付（推荐），QoS 2 用于精确一次（开销最高）。
4. **设置合理的重连间隔**——默认的最小值 1 秒/最大值 60 秒效果不错。避免将最小值设置得太低，以免代理服务器过载。
5. **有效使用主题通配符**— 订阅特定模式（`sensors/+/temperature`）而不是过于宽泛的模式（`#`）。
6. **监控订阅健康状况**—设置提醒`arc_mqtt_connection_status == 0`。`rate(arc_mqtt_decode_errors_total[5m]) > 0`

## 后续步骤
+ [分层存储](../08-数据生命周期/04-分层存储.md)——利用热/冷分层管理MQTT数据生命周期
+ [自动调度](../08-数据生命周期/03-连续查询.md)——自动对MQTT数据进行降采样
+ [审计日志记录](../11-数据安全/02-审计日志.md)— 跟踪 MQTT 订阅变更

