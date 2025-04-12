const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const crypto = require('crypto');
require('dotenv').config();

// OKX API的基础URL
const OKX_API_BASE = 'https://www.okx.com';

// OKX API配置
const okxConfig = {
    apiKey: process.env.OKX_API_KEY,
    secretKey: process.env.OKX_SECRET_KEY,
    passphrase: process.env.OKX_PASSPHRASE
};

// Telegram配置
const telegramConfig = {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID
};

// 创建Telegram机器人实例
const bot = new TelegramBot(telegramConfig.token);

// 创建axios实例
const axiosInstance = axios.create({
    baseURL: OKX_API_BASE,
    timeout: 10000
});

// 生成OKX API所需的签名
function generateSignature(timestamp, method, requestPath, body = '') {
    const message = timestamp + method + requestPath + body;
    return crypto
        .createHmac('sha256', okxConfig.secretKey)
        .update(message)
        .digest('base64');
}

// 添加请求拦截器，注入OKX API所需的头信息
axiosInstance.interceptors.request.use((config) => {
    const timestamp = new Date().toISOString();
    const method = config.method.toUpperCase();
    const requestPath = config.url.replace(OKX_API_BASE, '');
    const body = config.data || '';

    config.headers['OK-ACCESS-KEY'] = okxConfig.apiKey;
    config.headers['OK-ACCESS-TIMESTAMP'] = timestamp;
    config.headers['OK-ACCESS-SIGN'] = generateSignature(timestamp, method, requestPath, body);
    config.headers['OK-ACCESS-PASSPHRASE'] = okxConfig.passphrase;

    return config;
});

// 延时函数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 获取所有永续合约信息
async function getActiveSymbols() {
    try {
        const response = await axiosInstance.get('/api/v5/public/instruments', {
            params: {
                instType: 'SWAP'
            }
        });
        return response.data.data.filter(symbol => symbol.state === 'live');
    } catch (error) {
        console.error('获取交易对信息失败:', error.message);
        return [];
    }
}

// 获取K线数据的函数 - 获取日线数据，limit为241
async function getKlineData(instId) {
    try {
        const response = await axiosInstance.get('/api/v5/market/candles', {
            params: {
                instId: instId,
                bar: '1D',
                limit: 241
            }
        });
        
        if (response.data && response.data.data && response.data.data.length > 0) {
            // 提取所有K线数据，OKX API返回的数据格式：[时间戳, 开盘价, 最高价, 最低价, 收盘价, 交易量, 交易额]
            const klines = response.data.data.map(kline => ({
                openTime: parseInt(kline[0]),
                open: parseFloat(kline[1]),
                high: parseFloat(kline[2]),
                low: parseFloat(kline[3]),
                close: parseFloat(kline[4]),
                volume: parseFloat(kline[5]),
                quoteVolume: parseFloat(kline[6])
            })).reverse(); // OKX返回的是从新到旧，需要反转
            
            // 计算最新K线的涨跌幅
            const latestKline = klines[klines.length - 1];
            const priceChange = ((latestKline.close - latestKline.open) / latestKline.open) * 100;
            
            // 提取收盘价、最高价和最低价数组用于计算指标
            const closePrices = klines.map(k => k.close);
            const highPrices = klines.map(k => k.high);
            const lowPrices = klines.map(k => k.low);
            
            // 计算EMA120和ATR14
            const ema120 = calculateEMA(closePrices, 120);
            const atr14 = calculateATR(highPrices, lowPrices, closePrices, 14);
            
            // 计算收盘价与EMA120的差距与ATR14的比值
            const latestClose = closePrices[closePrices.length - 1];
            const priceDiff = latestClose - ema120; // 保留正负号
            const atrRatio = priceDiff / atr14; // 正值表示价格在EMA120上方，负值表示价格在EMA120下方
            
            return {
                klines,
                priceChange,
                latestClose,
                ema120,
                atr14,
                atrRatio
            };
        }
        return null;
    } catch (error) {
        console.error(`获取${instId} K线数据失败:`, error.message);
        return null;
    }
}

// 计算EMA
function calculateEMA(data, period) {
    if (data.length < period) {
        throw new Error('数据长度不足以计算EMA');
    }
    
    let ema = data.slice(0, period).reduce((sum, price) => sum + price, 0) / period;
    const multiplier = 2 / (period + 1);
    
    for (let i = period; i < data.length; i++) {
        ema = (data[i] - ema) * multiplier + ema;
    }
    
    return ema;
}

// 计算ATR
function calculateATR(highs, lows, closingPrices, period) {
    if (highs.length < period + 1 || lows.length < period + 1 || closingPrices.length < period + 1) {
        throw new Error('数据长度不足以计算ATR');
    }

    const trValues = [];
    for (let i = 1; i < closingPrices.length; i++) {
        const high = highs[i];
        const low = lows[i];
        const prevClose = closingPrices[i - 1];
        
        const tr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
        );
        trValues.push(tr);
    }

    let atr = trValues.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period;
    
    for (let i = period; i < trValues.length; i++) {
        atr = ((period - 1) * atr + trValues[i]) / period;
    }
    
    return atr;
}

// 格式化数字
function formatNumber(num, decimals = 2) {
    if (num >= 1000000000) {
        return (num / 1000000000).toFixed(decimals) + 'B';
    } else if (num >= 1000000) {
        return (num / 1000000).toFixed(decimals) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(decimals) + 'K';
    }
    return num.toFixed(decimals);
}

// 发送Telegram消息
async function sendTelegramMessage(message) {
    try {
        // 如果消息长度超过3000字符，分割成多个消息发送
        if (message.length > 3000) {
            const messageChunks = [];
            // 将消息分割成多个小于3000字符的块
            for (let i = 0; i < message.length; i += 3000) {
                messageChunks.push(message.slice(i, i + 3000));
            }
            
            // 依次发送每个消息块
            for (const chunk of messageChunks) {
                await bot.sendMessage(telegramConfig.chatId, chunk);
                // 添加短暂延迟，避免发送过快触发Telegram API限制
                await sleep(100);
            }
        } else {
            await bot.sendMessage(telegramConfig.chatId, message);
        }
    } catch (error) {
        console.error('发送Telegram消息失败:', error.message);
    }
}

// 主函数
async function getMarketInfo() {
    try {
        let technicalAlertMessages = [];   // 技术指标监控消息
        console.log('正在获取OKX市场信息...\n');

        // 1. 获取所有活跃合约
        const activeSymbols = await getActiveSymbols();
        console.log(`获取到 ${activeSymbols.length} 个活跃合约\n`);

        // 2. 筛选USDT永续合约，忽略USDC交易对
        const usdtSwapSymbols = activeSymbols.filter(symbol => 
            symbol.instId.endsWith('-USDT-SWAP') && 
            !symbol.instId.includes('USDC')
        );

        // 3. 获取24小时成交量数据
        console.log('正在获取详细市场数据...\n');

        // 4. 打印表头
        const tableHeader = '交易对         24h成交量    收盘价    EMA120    ATR14    ATR倍数(±)';
        const tableDivider = '----------------------------------------------------------------';
        console.log(tableHeader);
        console.log(tableDivider);
        
        let outputText = `${tableHeader}\n${tableDivider}\n`;

        // 5. 分批处理
        const batchSize = 5;
        for (let i = 0; i < usdtSwapSymbols.length; i += batchSize) {
            const batch = usdtSwapSymbols.slice(i, i + batchSize);
            const promises = batch.map(async (symbol) => {
                const instId = symbol.instId;
                const klineData = await getKlineData(instId);

                if (klineData) {
                    // 提取币种名称，移除 -USDT-SWAP 后缀
                    const coinName = instId.replace(/-USDT-SWAP$/, '');
                    
                    // 计算收盘价与EMA120的差距与ATR14的比值
                    const atrRatioFormatted = klineData.atrRatio.toFixed(2);
                    
                    // 添加到监控消息
                    // 根据涨跌幅添加不同的emoji
                    let priceChangeEmoji = '';
                    const priceChangeValue = klineData.priceChange;
                    
                    // 根据涨跌幅正负添加基础emoji
                    if (priceChangeValue > 0) {
                        priceChangeEmoji = '🟢'; // 绿色emoji表示正涨幅
                    } else {
                        priceChangeEmoji = '🔴'; // 红色emoji表示负涨幅
                    }
                    
                    // 根据涨跌幅大小添加额外emoji
                    if (Math.abs(priceChangeValue) > 20) {
                        priceChangeEmoji += '🔥🔥'; // 超过20%添加火焰emoji
                    } else if (Math.abs(priceChangeValue) > 10) {
                        priceChangeEmoji += '🔥'; // 超过10%添加警告emoji
                    }
                    
                    // 添加方向指示，正值表示价格在EMA120上方，负值表示价格在EMA120下方
                    const directionEmoji = klineData.atrRatio > 0 ? '👆' : '👇';
                    
                    technicalAlertMessages.push(
                        `${priceChangeEmoji} ${coinName}:  ${klineData.priceChange.toFixed(2)}%, ` +
                        `${directionEmoji} 偏离 ${(klineData.atrRatio).toFixed(2)} 倍`
                    );

                    // 添加方向符号到控制台输出
                    const directionSign = klineData.atrRatio > 0 ? '+' : '-';
                    const outputLine = `${instId.padEnd(14)} ` +
                        `${formatNumber(klineData.klines[klineData.klines.length - 1].quoteVolume).padEnd(12)} ` +
                        `${klineData.latestClose.toFixed(4).padEnd(9)} ` +
                        `${klineData.ema120.toFixed(4).padEnd(9)} ` +
                        `${klineData.atr14.toFixed(4).padEnd(8)} ` +
                        `${directionSign}${Math.abs(klineData.atrRatio).toFixed(2)}`;

                    console.log(outputLine);
                    outputText += outputLine + '\n';
                }
            });

            await Promise.all(promises);
            if (i + batchSize < usdtSwapSymbols.length) {
                await sleep(500);
            }
        }

        // 发送技术指标监控消息
        if (technicalAlertMessages.length > 0) {
            const technicalMessage = `📊 OKX技术指标监控 - ${new Date().toLocaleDateString()}\n\n${technicalAlertMessages.join('\n')}`;
            console.log('\n技术指标监控结果：');
            console.log('----------------------------------------');
            console.log(technicalMessage);
            console.log('----------------------------------------\n');
            await sendTelegramMessage(technicalMessage);
        }

    } catch (error) {
        console.error('程序执行出错:', error.message);
        await sendTelegramMessage(`❌ OKX程序执行出错: ${error.message}`);
    }
}

// 设置定时任务
function setupCronJobs() {
    // 每天的07:50执行一次
    cron.schedule('50 7 * * *', async () => {
        console.log('开始OKX技术指标监控任务...');
        await getMarketInfo();
    });
}

// 程序入口
console.log('启动OKX市场监控程序...\n');
setupCronJobs();
getMarketInfo().then(() => {
    console.log('\n初始化数据获取完成！');
});