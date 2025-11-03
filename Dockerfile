# 第一阶段：构建阶段
FROM node:22-slim AS builder

# 设置工作目录
WORKDIR /app

# 设置淘宝镜像源
RUN npm config set registry https://registry.npmmirror.com

# 复制 package.json 和 package-lock.json（如果存在）
COPY package*.json ./

# 安装依赖
RUN npm ci --only=production=false

# 复制源代码
COPY tsconfig.json ./
COPY src ./src

# 编译 TypeScript
RUN npm run build

# 第二阶段：运行阶段
FROM node:22-slim

# 设置工作目录
WORKDIR /app

# 设置淘宝镜像源
RUN npm config set registry https://registry.npmmirror.com

# 复制 package.json 和 package-lock.json（如果存在）
COPY package*.json ./

# 只安装生产依赖
RUN npm ci --only=production && npm cache clean --force

# 从构建阶段复制编译后的文件
COPY --from=builder /app/dist ./dist

# 复制数据文件
COPY data ./data

# 创建输出目录
RUN mkdir -p output

# 设置环境变量默认值
ENV WS_HOST=172.16.18.16
ENV WS_PORT=8857

# 运行应用
CMD ["node", "dist/ast_client.js"]

