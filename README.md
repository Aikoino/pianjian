# 片笺 (Pianjian)

轻量级 Windows 桌面便签软件 — 四色分类、贴边隐藏、本地持久化。

> **Vibe Coding 项目**：本软件全程由 Claude Code 辅助编码，人工提出需求与反馈，AI 负责实现。

## 技术栈

- **桌面壳**：Electron 22（无边框窗口）
- **前端**：原生 HTML/CSS/JS，零框架，零构建工具
- **本地存储**：JSON 文件（`%APPDATA%/pianjian/data.json`）
- **依赖**：仅 `electron` + `ws`（同步功能预留）

## 快速使用（便携版）

从 [Releases](https://github.com/Aikoino/pianjian/releases) 下载 `pianjian_v1.0.0_portable.zip`，解压后双击 `片笺.exe` 即可运行。

- 体积：**83 MB**（< 100 MB）
- 无需安装，解压即用
- 数据自动保存在 `%APPDATA%/pianjian/data.json`

## 开发运行

```bash
# 1. 克隆仓库
git clone https://github.com/Aikoino/pianjian.git
cd pianjian

# 2. 安装依赖
npm install

# 3. 启动
npm start
```

> **注意**：如果从 VSCode 终端启动遇到 `ELECTRON_RUN_AS_NODE` 错误，请使用 `bash start.sh` 或在外部终端运行 `npm start`。

### 构建便携版

```bash
npm run build
# 输出: dist/片笺_v1.0.0_portable.zip
```

## 功能使用说明

### 便签类型

| 类型 | 颜色 | 用途 |
|------|------|------|
| **今日** | 红色 | 今日待办事项 |
| **周** | 橙色 | 本周待办事项 |
| **便签** | 绿色 | 不限时间的普通便签 |
| **时间轴** | 粉色 | 指定日期的待办，自动归类 |

### 基本操作

1. **添加便签**：点击标题栏 `+` 按钮，选择便签类型
2. **编辑内容**：直接在卡片正文区域输入文字
3. **切换分类**：点击左侧边栏标签切换视图
4. **搜索**：点击标题栏放大镜图标，输入关键词实时过滤

### 时间轴与自动晋升

- 时间轴便签带有 **日期选择器**，可以指定日期
- **今天**的日期 → 自动显示在「今日」标签下
- **本周**的日期 → 自动显示在「周」标签下
- 「时间轴」标签始终显示所有时间轴条目，不会因晋升而消失

### 完成与过期

- 每条便签左侧有 **复选框**：
  - **未勾选**：待处理状态
  - **已勾选**：处理完成，文字划线变灰
  - 再次点击可取消勾选
- 时间轴中 **已过日期且未完成** 的便签自动显示为灰色（过期状态）

### 贴边隐藏

1. 将窗口拖拽到屏幕 **左边缘** 或 **右边缘**（20px 内）
2. 停留 300ms 后窗口自动隐藏，只留下 **四个彩色书签把手**
3. **鼠标悬停** 书签把手 500ms，完整窗口浮出
4. **鼠标移开** 窗口 800ms，窗口再次隐藏
5. **拖拽把手** 即可将窗口从边缘拉出，取消贴边状态

### 窗口缩放

- **系统缩放**：拖拽窗口边框（Windows 原生）
- **右下角手柄**：拖拽右下角的斜纹把手，自由调整窗口大小
- 窗口大小限制：最小 200×300，最大为屏幕的 80%

### 窗口置顶

- 点击标题栏 **图钉图标**，切换窗口始终置顶
- 图钉高亮 = 置顶启用

### 数据存储

所有便签数据自动保存在：
```
C:\Users\<用户名>\AppData\Roaming\pianjian\data.json
```
无需手动保存，内容编辑后 300ms 自动写入文件。

## 项目结构

```
pianjian/
├── main.js              # Electron 主进程（窗口管理、贴边、缩放）
├── preload.js           # IPC 桥接（contextBridge）
├── start.js             # Windows 启动包装脚本
├── start.sh             # Bash 启动脚本
├── package.json
├── server/
│   └── data-store.js    # JSON 文件读写
└── renderer/
    ├── index.html        # 主页面
    ├── css/
    │   ├── base.css      # 全局变量与重置
    │   ├── title-bar.css # 标题栏样式
    │   ├── sidebar.css   # 侧边栏样式
    │   ├── notes.css     # 便签卡片样式
    │   └── snap-handles.css # 贴边书签与缩放手柄
    └── js/
        ├── utils.js      # uuid、debounce、类型晋升
        ├── state.js      # 数据状态管理
        ├── sidebar.js    # 侧边栏逻辑
        ├── notes.js      # 便签渲染逻辑
        ├── title-bar.js  # 标题栏交互
        └── app.js        # 应用入口
```

## 路线图

- [ ] WebSocket 同步服务（端口 9527）
- [ ] HTTP 静态服务 + UDP 广播发现
- [ ] Android PWA 跨端同步
- [ ] 系统托盘图标
- [ ] 启动时自动最小化到托盘

## 许可

MIT License
