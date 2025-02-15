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

// 获取资金费率信息
async function getFundingRate(instId) {
    try {
        const response = await axiosInstance.get('/api/v5/public/funding-rate', {
            params: { instId }
        });
        const data = response.data.data[0];
        return {
            lastFundingRate: parseFloat(data.fundingRate),
            nextFundingTime: new Date(parseInt(data.nextFundingTime)),
            markPrice: parseFloat(data.markPx)
        };
    } catch (error) {
        console.error(`获取${instId}资金费率失败:`, error.message);
        return null;
    }
}

// 发送Telegram消息
async function sendTelegramMessage(message) {
    try {
        if (message.length > 4000) {
            await bot.sendMessage(telegramConfig.chatId, message.slice(0, 4000));
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
        let fundingAlertMessages = [];
        console.log('正在获取OKX资金费率信息...\n');

        // 1. 获取所有活跃合约
        const activeSymbols = await getActiveSymbols();
        console.log(`获取到 ${activeSymbols.length} 个活跃合约\n`);

        // 2. 分批处理
        const batchSize = 5;
        for (let i = 0; i < activeSymbols.length; i += batchSize) {
            const batch = activeSymbols.slice(i, i + batchSize);
            const promises = batch.map(async (symbol) => {
                const fundingInfo = await getFundingRate(symbol.instId);

                if (fundingInfo) {
                    const fundingRateValue = fundingInfo.lastFundingRate * 100;

                    // 检查资金费率异常
                    if (fundingRateValue > 0.1 || fundingRateValue < -0.1) {
                        const message = `💰 ${symbol.instId} : ${fundingRateValue.toFixed(4)}% (下次费率时间: ${fundingInfo.nextFundingTime.toLocaleTimeString()})`;
                        console.log(message);
                        fundingAlertMessages.push(message);
                    }
                }
            });

            await Promise.all(promises);
            await sleep(500); // 添加延迟避免触发频率限制
        }

        // 3. 发送异常提醒
        if (fundingAlertMessages.length > 0) {
            const message = `💰 OKX资金费率异常提醒 >0.1% <-0.1%\n\n${fundingAlertMessages.join('\n')}`;
            console.log('\n检测到以下资金费率异常：');
            console.log('----------------------------------------');
            console.log(message);
            console.log('----------------------------------------\n');
            await sendTelegramMessage(message);
        } else {
            console.log('\n未检测到异常资金费率');
        }

    } catch (error) {
        console.error('程序执行出错:', error.message);
        await sendTelegramMessage(`❌ OKX程序执行出错: ${error.message}`);
    }
}

// 设置定时任务
function setupCronJobs() {
    // 每天的03:55，07:55，11:55，15:55，19:55，23:55执行
    cron.schedule('55 3,7,11,15,19,23 * * *', async () => {
        console.log('开始OKX资金费率监控任务...');
        await getMarketInfo();
    });
}

// 程序入口
console.log('启动OKX资金费率监控程序...\n');
setupCronJobs();
getMarketInfo().then(() => {
    console.log('\n初始化数据获取完成！');
});