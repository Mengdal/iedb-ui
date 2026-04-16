# IotEdgeDB 前端与文档站

本仓库包含两部分：

- `./`：IotEdgeDB 的前端页面（Vite + React）
- `./docs/`：IotEdgeDB 文档站（Docusaurus），文档内容主要在 `docs/docs/`

## 目录结构

- `docs/`：Docusaurus 站点工程
  - `docs/docs/`：文档正文（Markdown/MDX）
  - `docs/blog/`：博客
  - `docs/static/`：静态资源（图片、favicon、robots.txt 等）
- `.github/workflows/docs-deploy-server.yml`：文档站构建并部署到服务器的 CI

## 本地开发

### 前端页面（仓库根目录）

```bash
npm install
npm run dev
```

### 文档站（`docs/` 目录）

```bash
cd docs
npm install
npm start
```

## 构建

### 前端页面

```bash
npm run build
```

### 文档站

```bash
cd docs
npm run build
```

构建产物在 `docs/build/`。

## 部署（文档站）

仓库内已配置 GitHub Actions 工作流：` .github/workflows/docs-deploy-server.yml `。
当 `main` 分支下 `docs/**` 发生变更时，会构建 `docs/build/` 并通过 `rsync` 同步到服务器的 `${DEPLOY_PATH}`。

