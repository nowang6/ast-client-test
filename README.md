# AST Client Test

基于 WebSocket 的语音识别（AST）客户端，将音频文件流式发送至语音识别服务端并实时接收转写结果。

## 工作原理

1. 通过 WebSocket 连接到 AST 服务端（Tuling AST v3）
2. 将 WAV 音频文件分块（每块 4096 字节）以 40ms 间隔发送
3. 实时接收识别结果，支持中间结果（`progressive`）和最终结果（`sentence`）
4. 所有结果保存为 JSON 文件到 `output/` 目录

## 环境要求

- Node.js >= 22
- npm >= 9

## 安装

```bash
npm ci
```

## 配置

通过环境变量配置服务端地址：

| 环境变量 | 说明 | 默认值 |
|----------|------|--------|
| `WS_URL` | 完整的 WebSocket URL（优先级最高） | - |
| `WS_HOST` | 服务端主机地址 | `172.16.18.16` |
| `WS_PORT` | 服务端端口 | `8857` |

默认 WebSocket 路径为 `/tuling/ast/v3`。

## 使用

### 1. 启动 AST 服务端

```bash
docker compose -f tmgenius-docker-800i-a2-ast-v2.yaml up -d
```

### 2. 开发模式

```bash
npm run dev
```

### 3. 编译 & 运行

```bash
npm run build
npm start
```

### 4. 构建 Docker 镜像并导出

```bash
# 构建镜像
docker build -t ast-client-test:v1 .

# 导出镜像为 tar 文件
docker save -o ast-client-test-v1.tar ast-client-test:v1
```

### 5. 加载镜像并运行

```bash
# 加载镜像
docker load -i ast-client-test-v1.tar

# 运行容器（根据实际服务端口调整 WS_PORT）
docker run --rm -e WS_HOST=172.16.18.16 -e WS_PORT=8856 ast-client-test:v1
```

#### 预期输出

```
WebSocket URL: ws://172.16.18.16:8856/tuling/ast/v3
[data/zhangsanfeng.wav]: 收到第1条消息，耗时524ms
[data/zhangsanfeng.wav]: 收到第2条消息，耗时560ms
...
#1: 【中间状态】张三疯(角色0)[时间：0~1200]
#2: 【最终状态】张三疯(角色0)[时间：0~1200]
...
[data/zhangsanfeng.wav]: 张三疯(角色0)[时间：0~1200]
结果已保存到: output/results_2025-11-03T12-00-00-000Z.json
```

## 项目结构

```
.
├── src/
│   └── ast_client.ts    # 主程序
├── data/
│   └── zhangsanfeng.wav # 测试音频文件
├── output/              # 识别结果输出（运行时生成）
├── dist/                # 编译产物
├── Dockerfile
├── tsconfig.json
└── package.json
```

## 输出

识别完成后，结果以 JSON 格式保存到 `output/` 目录，文件名格式为 `results_<时间戳>.json`，包含：

- `audioPath` — 音频文件路径
- `totalResults` — 接收到的消息总数
- `accumulatedText` — 累积的最终识别文本
- `results` — 完整的识别结果列表（含每条消息的序号与原始数据）
