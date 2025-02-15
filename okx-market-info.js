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

// 获取24小时成交量数据
async function get24hVolume(instId) {
    try {
        const response = await axiosInstance.get('/api/v5/market/ticker', {
            params: { instId }
        });
        return parseFloat(response.data.data[0].volCcy24h);
    } catch (error) {
        console.error(`获取${instId}成交量数据失败:`, error.message);
        return 0;
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

// 获取未平仓合约信息
async function getOpenInterest(instId) {
    try {
        const response = await axiosInstance.get('/api/v5/public/open-interest', {
            params: { instId }
        });
        return parseFloat(response.data.data[0].oi);
    } catch (error) {
        console.error(`获取${instId}未平仓合约数据失败:`, error.message);
        return null;
    }
}

// 获取多空持仓人数比
async function getLongShortRatio(instId) {
    try {
        const response = await axiosInstance.get('/api/v5/public/long-short-ratio', {
            params: { 
                instId,
                period: '5m'
            }
        });
        return parseFloat(response.data.data[0].longShortRatio);
    } catch (error) {
        console.error(`获取${instId}多空比数据失败:`, error.message);
        return null;
    }
}

// 获取K线数据
async function getKlineData(instId) {
    try {
        const response = await axiosInstance.get('/api/v5/market/candles', {
            params: {
                instId,
                bar: '4H',
                limit: 1
            }
        });
        
        if (response.data.data && response.data.data.length > 0) {
            const kline = response.data.data[0];
            const openPrice = parseFloat(kline[1]);
            const closePrice = parseFloat(kline[4]);
            const priceChange = ((closePrice - openPrice) / openPrice) * 100;
            
            return {
                priceChange,
                openPrice,
                closePrice
            };
        }
        return null;
    } catch (error) {
        console.error(`获取${instId} K线数据失败:`, error.message);
        return null;
    }
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
        let ratioAlertMessages = [];
        let fundingAlertMessages = [];
        let longShortAlertMessages = [];
        let priceAlertMessages = [];
        console.log('正在获取OKX市场信息...\n');

        // 1. 获取所有活跃合约
        const activeSymbols = await getActiveSymbols();
        console.log(`获取到 ${activeSymbols.length} 个活跃合约\n`);

        // 2. 获取并筛选高成交量的合约
        const highVolumeSymbols = [];
        for (const symbol of activeSymbols) {
            const volume = await get24hVolume(symbol.instId);
            if (volume > 100000000 && !symbol.instId.includes('USDC')) {
                highVolumeSymbols.push({...symbol, volume});
            }
            await sleep(100); // 添加延迟避免触发频率限制
        }

        // 按成交量排序
        highVolumeSymbols.sort((a, b) => b.volume - a.volume);

        console.log(`找到 ${highVolumeSymbols.length} 个交易量超过100M的合约\n`);
        console.log('正在获取详细市场数据...\n');

        // 3. 打印表头
        const tableHeader = '交易对         24h成交量    持仓价值      未平仓合约    多空比    费率      下次费率时间';
        const tableDivider = '--------------------------------------------------------------------------------';
        console.log(tableHeader);
        console.log(tableDivider);

        // 4. 分批处理
        const batchSize = 5;
        for (let i = 0; i < highVolumeSymbols.length; i += batchSize) {
            const batch = highVolumeSymbols.slice(i, i + batchSize);
            const promises = batch.map(async (symbol) => {
                const fundingInfo = await getFundingRate(symbol.instId);
                const openInterest = await getOpenInterest(symbol.instId);
                const longShortRatio = await getLongShortRatio(symbol.instId);
                const klineData = await getKlineData(symbol.instId);

                if (fundingInfo && openInterest) {
                    const marketValue = openInterest * fundingInfo.markPrice;
                    const marketToVolumeRatio = marketValue / symbol.volume;
                    const fundingRateValue = fundingInfo.lastFundingRate * 100;

                    // 检查各种异常情况并添加到提醒列表
                    if (marketToVolumeRatio > 0.5) {
                        ratioAlertMessages.push(
                            `⚠️ ${symbol.instId} : ${marketToVolumeRatio.toFixed(2)} ` +
                            `(持仓价值: ${formatNumber(marketValue)}，24h成交量: ${formatNumber(symbol.volume)})`
                        );
                    }

                    if (fundingRateValue > 0.1 || fundingRateValue < -0.1) {
                        fundingAlertMessages.push(
                            `💰 ${symbol.instId} : ${fundingRateValue.toFixed(4)}%`
                        );
                    }

                    if (longShortRatio && (longShortRatio < 0.5 || longShortRatio > 3.5)) {
                        longShortAlertMessages.push(
                            `📊 ${symbol.instId} : ${longShortRatio.toFixed(2)}`
                        );
                    }

                    if (klineData && Math.abs(klineData.priceChange) > 10) {
                        priceAlertMessages.push(
                            `📈 ${symbol.instId} 4小时k线: ${klineData.priceChange.toFixed(2)}% ` +
                            `(开盘: ${klineData.openPrice.toFixed(4)}, 当前: ${klineData.closePrice.toFixed(4)})`
                        );
                    }

                    // 打印信息
                    const outputLine = `${symbol.instId.padEnd(14)} ` +
                        `${formatNumber(symbol.volume).padEnd(12)} ` +
                        `${formatNumber(marketValue).padEnd(12)} ` +
                        `${formatNumber(openInterest).padEnd(12)} ` +
                        `${(longShortRatio ? longShortRatio.toFixed(2) : 'N/A').padEnd(9)} ` +
                        `${fundingRateValue.toFixed(4).padEnd(9)}% ` +
                        `${fundingInfo.nextFundingTime.toLocaleTimeString()}`;

                    console.log(outputLine);
                }
            });

            await Promise.all(promises);
            await sleep(500);
        }

        // 5. 发送异常提醒
        if (ratioAlertMessages.length > 0) {
            await sendTelegramMessage(`🚨 OKX持仓价值/交易量比率异常提醒 >0.5\n\n${ratioAlertMessages.join('\n')}`);
        }

        if (fundingAlertMessages.length > 0) {
            await sendTelegramMessage(`💰 OKX资金费率异常提醒 >0.1% <-0.1%\n\n${fundingAlertMessages.join('\n')}`);
        }

        if (longShortAlertMessages.length > 0) {
            await sendTelegramMessage(`📊 OKX多空比异常提醒 <0.5 >3.5\n\n${longShortAlertMessages.join('\n')}`);
        }

        if (priceAlertMessages.length > 0) {
            await sendTelegramMessage(`📈 OKX价格剧烈波动提醒 >10%\n\n${priceAlertMessages.join('\n')}`);
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
        console.log('开始OKX定时任务...');
        await getMarketInfo();
    });
}

// 程序入口
console.log('启动OKX合约市场监控程序...\n');
setupCronJobs();
getMarketInfo().then(() => {
    console.log('\n初始化数据获取完成！');
}); 