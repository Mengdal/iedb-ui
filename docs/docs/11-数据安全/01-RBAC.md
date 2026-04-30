通过组织、团队和细粒度权限（细化到表级别）来管理对 IEDB 部署的访问权限。

## 概述
基于Token的身份验证基础上构建，增加了组织结构和细粒度权限：

```plain
组织（例如："某某公司"）
└── 团队（例如："数据工程部"）
└── 角色（例如："生产环境读写权限"）
└── 数据库："production" → [读, 写, 删除]
└── 数据库："analytics" → [读]
└── 测量表：["metrics_", "events_"]
```

**主要能力：**

+ **组织机构 **— 公司或部门的最高级别分组
+ **团队**— 按职能（工程、分析、运营）对用户进行分组
+ **角色**— 为每个数据库定义权限，并可选择设置度量限制
+ **表级权限**— 使用通配符模式限制对特定表的访问

## 前提条件
+ 必须启用身份验证（`IEDB_AUTH_ENABLED=true`）
+ 企业许可证（含基于角色的访问控制功能）

## 权限模型
权限是在角色级别定义的，并应用于特定的数据库：

| **权限** | **描述** |
| --- | --- |
| `read` | 从数据库中查询数据 |
| `write` | 将数据写入数据库 |
| `delete` | 从数据库中删除数据 |
| `admin` | 完全管理权限 |


`metrics_*`角色可以选择性地使用通配符模式（例如，匹配`metrics_cpu``metrics_memory`等）来限制对数据库中特定测量值的访问。

+ **RBAC allow** → 通过（来源 `rbac`）
+ **RBAC deny + token allow** → 仍通过（来源 `token`）
+ **RBAC deny + token deny** → 拒绝

## API 参考
所有基于角色的访问控制 (RBAC) 接口都需要管理员身份验证。

### 组织
#### 创建组织
```bash
curl -X POST http://localhost:8000/api/v1/rbac/organizations \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "371562656",
    "description": "Main organization"
  }'
```

**响应：**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "371562656",
    "description": "Main organization",
    "created_at": "2026-02-13T10:00:00Z",
    "updated_at": "2026-02-13T10:00:00Z"
  }
}
```

#### 组织列表
```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:8000/api/v1/rbac/organizations
```

#### 组织详情
```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:8000/api/v1/rbac/organizations/1
```

#### 更新组织
```bash
curl -X PATCH http://localhost:8000/api/v1/rbac/organizations/1 \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description": "Updated description"}'
```

#### 删除组织
```bash
curl -X DELETE http://localhost:8000/api/v1/rbac/organizations/1 \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### 团队
#### 创建团队
```bash
curl -X POST http://localhost:8000/api/v1/rbac/organizations/1/teams \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Data Engineering",
    "description": "Data engineering team"
  }'
```

**响应：**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "organization_id": 1,
    "name": "Data Engineering",
    "description": "Data engineering team",
    "created_at": "2026-02-13T10:00:00Z",
    "updated_at": "2026-02-13T10:00:00Z"
  }
}
```

#### 团队列表
```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:8000/api/v1/rbac/organizations/1/teams
```

#### 团队详情
```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:8000/api/v1/rbac/teams/1
```

#### 更新团队
```bash
curl -X PATCH http://localhost:8000/api/v1/rbac/teams/1 \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description": "Updated team description"}'
```

#### 删除团队
```bash
curl -X DELETE http://localhost:8000/api/v1/rbac/teams/1 \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### 角色
#### 创建角色
```bash
curl -X POST http://localhost:8000/api/v1/rbac/teams/1/roles \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "production-readwrite",
    "database_pattern": "production",
    "permissions": ["read", "write"]
  }'
```

**响应：**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "team_id": 1,
    "name": "production-readwrite",
    "database_pattern": "production",
    "permissions": ["read", "write"],
    "created_at": "2026-02-13T10:00:00Z",
    "updated_at": "2026-02-13T10:00:00Z"
  }
}
```

数据库通配符

使用`*`此数据库模式可以授予所有数据库的权限。例如，`"database_pattern": "*"`授予`"permissions": ["read"]`对所有数据库的读取权限。

#### 角色列表
```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:8000/api/v1/rbac/teams/1/roles
```

#### 角色详情
```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:8000/api/v1/rbac/roles/1
```

#### 更新角色
```bash
curl -X PATCH http://localhost:8000/api/v1/rbac/roles/1 \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"permissions": ["read", "write", "delete"]}'
```

#### 删除角色
```bash
curl -X DELETE http://localhost:8000/api/v1/rbac/roles/1 \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### 表级权限
将角色限制在其数据库模式中的特定表级范围内。

#### 添加表级权限
```bash
curl -X POST http://localhost:8000/api/v1/rbac/roles/1/measurements \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "measurement_pattern": "metrics_*"
  }'
```

#### 表级权限列表
```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:8000/api/v1/rbac/roles/1/measurements
```

#### 移除表级权限
```bash
curl -X DELETE http://localhost:8000/api/v1/rbac/roles/1/measurements/1 \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

## 操作指南：设置基于角色的访问控制
本示例设置了一个典型的组织，其中包含两个团队和不同的访问权限级别。

### 步骤 1：创建组织
```bash
curl -X POST http://localhost:8000/api/v1/rbac/organizations \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "LM Gateway"}'
```

### 步骤 2：创建团队
```bash
# 数据工程团队 — 完全访问权限
curl -X POST http://localhost:8000/api/v1/rbac/organizations/1/teams \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Data Engineering"}'

# 分析团队 — 只读权限
curl -X POST http://localhost:8000/api/v1/rbac/organizations/1/teams \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Analytics"}'
```

### 步骤 3：创建角色
```bash
# 数据工程团队：对生产数据库拥有读/写/删除权限
curl -X POST http://localhost:8000/api/v1/rbac/teams/1/roles \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "production-full",
    "database_pattern": "production",
    "permissions": ["read", "write", "delete"]
  }'

# 分析团队：对生产数据库只读权限，且仅限于特定测量表
curl -X POST http://localhost:8000/api/v1/rbac/teams/2/roles \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "production-readonly",
    "database_pattern": "production",
    "permissions": ["read"]
  }'
```

### 步骤 4：限制表级范围（可选）
```bash
# 分析团队只能访问 metrics_* 和 events_* 测量表
curl -X POST http://localhost:8000/api/v1/rbac/roles/2/measurements \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"measurement_pattern": "metrics_*"}'

curl -X POST http://localhost:8000/api/v1/rbac/roles/2/measurements \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"measurement_pattern": "events_*"}'
```

## 最佳实践
1. **最小权限原则**——从最小权限开始，根据需要逐步扩展。普通用户默认使用只读角色。
2. **使用表级限制**——当团队只需要访问特定数据时，应按表级权限进行限制，而不是授予完整的数据库访问权限。
3. **谨慎使用通配符模式**——数据库模式`*`会授予对所有数据库的访问权限。尽可能使用表级限制。
4. **配合审计日志记录**——启用审计日志以跟踪基于角色的访问控制 (RBAC) 变更和访问管理。
5. **规划层级结构**——在实施之前设计好组织和团队结构。典型的模式是每个公司一个组织，每个部门或职能部门一个团队。

## 后续步骤
+ [审计日志记录](./02-审计日志.md)— 跟踪所有访问和更改，以确保合规性
+ [查询治理](../10-查询/02-查询治理.md)— 添加每个Token的速率限制和配额

