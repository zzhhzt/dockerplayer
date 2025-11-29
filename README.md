# 扫码听歌 (Scan to Listen)

一个基于 Docker 的全栈音乐播放应用，包含公共播放器和受密码保护的管理后台。

## ✨ 功能特性

*   **🎵 公共播放器**: 简洁美观的 HTML5 播放器，自动扫描播放列表。
*   **� 扫码听歌**: 管理后台生成二维码，扫码即可直接播放指定歌曲。
*   **�🔐 管理后台**: 受密码保护的后台，支持上传和删除音乐文件。
*   **🐳 Docker 部署**: 一键构建和运行，数据持久化存储。
*   **📱 响应式设计**: 完美适配移动端和桌面端。

## 📂 项目结构

```
.
├── admin/          # 管理后台前端代码
├── public/         # 公共播放器前端代码
├── music/          # 音乐文件存储目录 (自动创建)
├── server.js       # Node.js 后端服务
├── Dockerfile      # Docker 构建文件
├── docker-compose.yml # Docker 编排文件
├── .env            # 环境变量配置
└── package.json    # 项目依赖
```

## 🚀 快速开始 (Docker)

这是推荐的部署方式。

1.  **配置密码**
    创建一个 `.env` 文件（如果尚未创建）：
    ```bash
    ADMIN_PASSWORD=your_secret_password
    ```

2.  **启动服务**
    在项目根目录下运行：
    ```bash
    docker-compose up -d --build
    ```

3.  **访问应用**
    *   **播放器**: `http://localhost:8080` (或服务器 IP)
    *   **管理后台**: `http://localhost:8080/admin`
    *   **扫码听歌**: 在管理后台点击歌曲旁的“二维码”按钮。
        *   支持自定义**前景色**、**背景色**。
        *   支持上传 **Logo** 图片嵌入二维码中心。
        *   支持添加**自定义标题**。
        *   使用手机扫描生成的二维码即可直接播放。

## 🛠️ 本地开发 (Node.js)

如果你想在不使用 Docker 的情况下运行：

1.  安装依赖：
    ```bash
    npm install
    ```
2.  设置环境变量 (可选，默认为 'admin')：
    Windows (PowerShell):
    ```powershell
    $env:ADMIN_PASSWORD="your_password"; node server.js
    ```
    Linux/Mac:
    ```bash
    ADMIN_PASSWORD=your_password node server.js
    ```
3.  访问 `http://localhost:3000`。

## 🔌 API 文档

| 方法 | 路径 | 描述 | 权限 |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/playlist` | 获取音乐列表 | 公开 |
| `POST` | `/api/upload` | 上传音乐文件 | 需要密码 |
| `DELETE` | `/api/music/:filename` | 删除音乐文件 | 需要密码 |

**鉴权方式**:
管理接口需要在 Header 中添加 `x-admin-password` 或在 URL 参数中添加 `?password=...`。

## 📝 注意事项

*   音乐文件存储在本地的 `./music` 目录中。
*   默认端口映射为 `8080`，可在 `docker-compose.yml` 中修改。
