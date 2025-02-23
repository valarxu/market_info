# 币安永续合约市场数据查询工具

## 项目简介
这是一个用于查询币安(Binance)永续合约市场数据的Node.js工具。它提供了全面的市场数据监控功能，包括交易量、资金费率、持仓量等关键信息的实时查询和监控。

## 功能特点
- 获取所有正在交易的永续合约信息
- 显示24小时交易量数据（以USDT计价）
- 显示每个合约的最小下单数量
- 支持HTTP代理配置
- 按交易量降序排列显示结果
- 资金费率监控和异常提醒（>0.5% 或 <-0.5%）
- 价格波动监控（4小时K线涨跌幅>10%提醒）
- 合约持仓量查询和历史数据分析
- 支持Telegram机器人通知功能
- 支持定时任务（每2小时自动执行）

## 环境要求
- Node.js (建议版本 >= 12.0.0)
- npm 或 yarn

## 安装依赖
```bash
npm install
# 或
yarn install
```

## 配置说明
1. 创建 `.env` 文件并配置以下环境变量：
```env
# 代理配置（可选）
PROXY_HOST=127.0.0.1
PROXY_PORT=4780

# Telegram机器人配置（可选）
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

## 使用方法
项目包含多个独立的功能模块：

1. 市场概览（包含交易量、资金费率监控）
```bash
node binance-market-info.js
```

2. 查看所有可交易合约
```bash
node binance-symbols.js
```

3. 查看特定合约持仓量
```bash
node binance-position.js
```

4. 查看资金费率详情
```bash
node binance-funding-rate.js
```

## 功能说明

### 市场监控（binance-market-info.js）
- 监控所有交易量超过100M的合约
- 自动检测资金费率异常（>0.5% 或 <-0.5%）
- 监控价格剧烈波动（4小时涨跌幅>10%）
- 通过Telegram发送异常提醒
- 支持定时执行（每2小时自动运行）

### 合约列表（binance-symbols.js）
- 显示所有可交易的永续合约
- 按24小时交易量排序
- 显示每个合约的最小下单数量

### 持仓量分析（binance-position.js）
- 查看主要合约（BTC、ETH、BNB等）的持仓信息
- 显示当前持仓量和持仓价值
- 提供24小时历史持仓数据（4小时间隔）

### 资金费率查询（binance-funding-rate.js）
- 查看当前资金费率
- 显示标记价格和指数价格
- 提供最近5次的历史资金费率记录

## 注意事项
- 使用代理时请确保代理服务器稳定可用
- Telegram通知功能需要正确配置机器人Token和Chat ID
- 建议在服务器上使用PM2等工具来保证程序持续运行 