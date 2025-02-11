const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
require('dotenv').config();

// 币安合约API的基础URL
const BINANCE_FAPI_BASE = 'https://fapi.binance.com';

// 创建axios实例
const axiosInstance = axios.create({
    timeout: 10000
});

// 添加 Telegram 配置
const telegramConfig = {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID
};

// 创建 Telegram 机器人实例
const bot = new TelegramBot(telegramConfig.token);

// 延时函数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 获取所有活跃合约信息
async function getActiveSymbols() {
    try {
        const response = await axiosInstance.get(`${BINANCE_FAPI_BASE}/fapi/v1/exchangeInfo`);
        return response.data.symbols.filter(symbol => 
            symbol.status === 'TRADING' && 
            symbol.contractType === 'PERPETUAL'
        );
    } catch (error) {
        console.error('获取交易对信息失败:', error.message);
        return [];
    }
}

// 获取24小时成交量数据
async function get24hVolume() {
    try {
        const response = await axiosInstance.get(`${BINANCE_FAPI_BASE}/fapi/v1/ticker/24hr`);
        const volumeMap = {};
        response.data.forEach(ticker => {
            volumeMap[ticker.symbol] = parseFloat(ticker.quoteVolume);
        });
        return volumeMap;
    } catch (error) {
        console.error('获取24小时成交量数据失败:', error.message);
        return {};
    }
}

// 获取资金费率信息
async function getFundingRate(symbol) {
    try {
        const response = await axiosInstance.get(`${BINANCE_FAPI_BASE}/fapi/v1/premiumIndex`, {
            params: { symbol }
        });
        return {
            lastFundingRate: parseFloat(response.data.lastFundingRate),
            nextFundingTime: new Date(response.data.nextFundingTime),
            markPrice: parseFloat(response.data.markPrice)
        };
    } catch (error) {
        console.error(`获取${symbol}资金费率失败:`, error.message);
        return null;
    }
}

// 获取未平仓合约信息
async function getOpenInterest(symbol) {
    try {
        const response = await axiosInstance.get(`${BINANCE_FAPI_BASE}/fapi/v1/openInterest`, {
            params: { symbol }
        });
        return parseFloat(response.data.openInterest);
    } catch (error) {
        console.error(`获取${symbol}未平仓合约数据失败:`, error.message);
        return null;
    }
}

// 获取多空持仓人数比
async function getLongShortRatio(symbol) {
    try {
        const response = await axiosInstance.get(`${BINANCE_FAPI_BASE}/futures/data/globalLongShortAccountRatio`, {
            params: { 
                symbol,
                period: '5m',
                limit: 1
            }
        });
        return response.data[0] ? parseFloat(response.data[0].longShortRatio) : null;
    } catch (error) {
        console.error(`获取${symbol}多空比数据失败:`, error.message);
        return null;
    }
}

// 添加获取K线数据的函数
async function getKlineData(symbol) {
    try {
        const response = await axiosInstance.get(`${BINANCE_FAPI_BASE}/fapi/v1/klines`, {
            params: {
                symbol: symbol,
                interval: '4h',
                limit: 1
            }
        });
        
        if (response.data && response.data.length > 0) {
            const kline = response.data[0];
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
        console.error(`获取${symbol} K线数据失败:`, error.message);
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

// 主函数
async function getMarketInfo() {
    try {
        let ratioAlertMessages = [];    // 持仓价值/交易量比率异常
        let fundingAlertMessages = [];   // 资金费率异常
        let longShortAlertMessages = []; // 多空比异常
        let priceAlertMessages = [];     // 价格涨跌幅异常
        console.log('正在获取市场信息...\n');

        // 1. 获取所有活跃合约
        const activeSymbols = await getActiveSymbols();
        console.log(`获取到 ${activeSymbols.length} 个活跃合约\n`);

        // 2. 获取24小时成交量
        const volume24h = await get24hVolume();

        // 3. 筛选交易量大于100M的交易对，忽略USDC交易对
        const highVolumeSymbols = activeSymbols.filter(symbol => 
            (volume24h[symbol.symbol] || 0) > 100000000 && 
            !symbol.symbol.includes('USDC')  // 添加这个条件来忽略USDC交易对
        ).sort((a, b) => (volume24h[b.symbol] || 0) - (volume24h[a.symbol] || 0));

        console.log(`找到 ${highVolumeSymbols.length} 个交易量超过100M的合约\n`);
        console.log('正在获取详细市场数据...\n');

        // 4. 打印表头
        const tableHeader = '交易对         24h成交量    持仓价值      未平仓合约    多空比    费率      下次费率时间';
        const tableDivider = '--------------------------------------------------------------------------------';
        console.log(tableHeader);
        console.log(tableDivider);
        
        let outputText = `${tableHeader}\n${tableDivider}\n`;

        // 5. 分批处理
        const batchSize = 5;
        for (let i = 0; i < highVolumeSymbols.length; i += batchSize) {
            const batch = highVolumeSymbols.slice(i, i + batchSize);
            const promises = batch.map(async (symbol) => {
                const symbolName = symbol.symbol;
                const fundingInfo = await getFundingRate(symbolName);
                const openInterest = await getOpenInterest(symbolName);
                const longShortRatio = await getLongShortRatio(symbolName);
                const klineData = await getKlineData(symbolName);

                if (fundingInfo && openInterest) {
                    const volume = volume24h[symbolName];
                    const marketValue = openInterest * fundingInfo.markPrice;
                    const marketToVolumeRatio = marketValue / volume;
                    const fundingRateValue = fundingInfo.lastFundingRate * 100;

                    // 检查持仓价值/交易量比率异常
                    if (marketToVolumeRatio > 0.5) {
                        ratioAlertMessages.push(
                            `⚠️ ${symbolName} : ${marketToVolumeRatio.toFixed(2)} ` +
                            `(持仓价值: ${formatNumber(marketValue)}，24h成交量: ${formatNumber(volume)})`
                        );
                    }

                    // 检查资金费率异常
                    if (fundingRateValue > 0.1 || fundingRateValue < -0.1) {
                        fundingAlertMessages.push(
                            `💰 ${symbolName} : ${fundingRateValue.toFixed(4)}%`
                        );
                    }

                    // 检查多空比异常
                    if (longShortRatio && (longShortRatio < 0.5 || longShortRatio > 3.5)) {
                        longShortAlertMessages.push(
                            `📊 ${symbolName} : ${longShortRatio.toFixed(2)}`
                        );
                    }

                    // 检查K线涨跌幅异常
                    if (klineData && Math.abs(klineData.priceChange) > 10) {
                        priceAlertMessages.push(
                            `📈 ${symbolName} 4小时k线: ${klineData.priceChange.toFixed(2)}% ` +
                            `(开盘: ${klineData.openPrice.toFixed(4)}, 当前: ${klineData.closePrice.toFixed(4)})`
                        );
                    }

                    const outputLine = `${symbolName.padEnd(14)} ` +
                        `${formatNumber(volume).padEnd(12)} ` +
                        `${formatNumber(marketValue).padEnd(12)} ` +
                        `${formatNumber(openInterest).padEnd(12)} ` +
                        `${(longShortRatio ? longShortRatio.toFixed(2) : 'N/A').padEnd(9)} ` +
                        `${fundingRateValue.toFixed(4).padEnd(9)}% ` +
                        `${fundingInfo.nextFundingTime.toLocaleTimeString()}`;

                    console.log(outputLine);
                    outputText += outputLine + '\n';
                }
            });

            await Promise.all(promises);
            if (i + batchSize < highVolumeSymbols.length) {
                await sleep(500);
            }
        }

        // 发送持仓价值/交易量比率异常
        if (ratioAlertMessages.length > 0) {
            const ratioMessage = `🚨 持仓价值/交易量比率异常提醒 >0.5\n\n${ratioAlertMessages.join('\n')}`;
            console.log('\n检测到以下持仓比率异常：');
            console.log('----------------------------------------');
            console.log(ratioMessage);
            console.log('----------------------------------------\n');
            await sendTelegramMessage(ratioMessage);
        }

        // 发送资金费率异常
        if (fundingAlertMessages.length > 0) {
            const fundingMessage = `💰 资金费率异常提醒 >0.1% <-0.1%\n\n${fundingAlertMessages.join('\n')}`;
            console.log('\n检测到以下资金费率异常：');
            console.log('----------------------------------------');
            console.log(fundingMessage);
            console.log('----------------------------------------\n');
            await sendTelegramMessage(fundingMessage);
        }

        // 发送多空比异常
        if (longShortAlertMessages.length > 0) {
            const longShortMessage = `📊 多空比异常提醒 <0.5 >3.5\n\n${longShortAlertMessages.join('\n')}`;
            console.log('\n检测到以下多空比异常：');
            console.log('----------------------------------------');
            console.log(longShortMessage);
            console.log('----------------------------------------\n');
            await sendTelegramMessage(longShortMessage);
        }

        // 发送价格涨跌幅异常
        if (priceAlertMessages.length > 0) {
            const priceMessage = `📈 价格剧烈波动提醒 >10%\n\n${priceAlertMessages.join('\n')}`;
            console.log('\n检测到以下价格异常：');
            console.log('----------------------------------------');
            console.log(priceMessage);
            console.log('----------------------------------------\n');
            await sendTelegramMessage(priceMessage);
        }

    } catch (error) {
        console.error('程序执行出错:', error.message);
        await sendTelegramMessage(`❌ 程序执行出错: ${error.message}`);
    }
}

// 修改发送Telegram消息的函数
async function sendTelegramMessage(message) {
    try {
        if (message.length > 4000) {
            if (message.includes('🚨 持仓价值/交易量比率异常提醒') || 
                message.includes('💰 资金费率异常提醒') || 
                message.includes('📊 多空比异常提醒') ||
                message.includes('📈 价格剧烈波动提醒')) {
                await bot.sendMessage(telegramConfig.chatId, message.slice(0, 4000));
            } else {
                await bot.sendMessage(telegramConfig.chatId, message.slice(0, 4000));
            }
        } else {
            await bot.sendMessage(telegramConfig.chatId, message);
        }
    } catch (error) {
        console.error('发送Telegram消息失败:', error.message);
    }
}

// 修改定时任务
function setupCronJobs() {
    // 每天的03:50，07:50，11:50，15:50，19:50，23:50执行
    cron.schedule('50 3,7,11,15,19,23 * * *', async () => {
        console.log('开始定时任务...');
        await getMarketInfo();
    });
}

// 修改程序入口
console.log('启动币安合约市场监控程序...\n');
setupCronJobs();
getMarketInfo().then(() => {
    console.log('\n初始化数据获取完成！');
}); 