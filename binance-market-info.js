const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
require('dotenv').config();

// 币安合约API的基础URL
const BINANCE_FAPI_BASE = 'https://fapi.binance.com';

// 从环境变量中读取代理配置
const proxyConfig = {
    host: process.env.PROXY_HOST || '127.0.0.1',
    port: process.env.PROXY_PORT || 4780
};

// 创建带有代理的axios实例
const axiosInstance = axios.create({
    httpsAgent: new HttpsProxyAgent(`http://${proxyConfig.host}:${proxyConfig.port}`),
    timeout: 10000
});

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
        console.log('正在获取市场信息...\n');

        // 1. 获取所有活跃合约
        const activeSymbols = await getActiveSymbols();
        console.log(`获取到 ${activeSymbols.length} 个活跃合约\n`);

        // 2. 获取24小时成交量
        const volume24h = await get24hVolume();

        // 3. 筛选交易量大于100M的交易对
        const highVolumeSymbols = activeSymbols.filter(symbol => 
            (volume24h[symbol.symbol] || 0) > 100000000
        ).sort((a, b) => (volume24h[b.symbol] || 0) - (volume24h[a.symbol] || 0));

        console.log(`找到 ${highVolumeSymbols.length} 个交易量超过100M的合约\n`);
        console.log('正在获取详细市场数据...\n');

        // 4. 打印表头
        console.log('交易对         24h成交量    持仓价值      未平仓合约    多空比    费率      下次费率时间');
        console.log('--------------------------------------------------------------------------------');

        // 5. 分批处理
        const batchSize = 5;
        for (let i = 0; i < highVolumeSymbols.length; i += batchSize) {
            const batch = highVolumeSymbols.slice(i, i + batchSize);
            const promises = batch.map(async (symbol) => {
                const symbolName = symbol.symbol;
                const fundingInfo = await getFundingRate(symbolName);
                const openInterest = await getOpenInterest(symbolName);
                const longShortRatio = await getLongShortRatio(symbolName);

                if (fundingInfo && openInterest) {
                    const volume = formatNumber(volume24h[symbolName]);
                    const marketValue = formatNumber(openInterest * fundingInfo.markPrice);
                    const openInterestFormatted = formatNumber(openInterest);
                    const fundingRate = (fundingInfo.lastFundingRate * 100).toFixed(4);
                    const nextFunding = fundingInfo.nextFundingTime.toLocaleTimeString();
                    const ratio = longShortRatio ? longShortRatio.toFixed(2) : 'N/A';

                    console.log(
                        `${symbolName.padEnd(14)} ` +
                        `${volume.padEnd(12)} ` +
                        `${marketValue.padEnd(12)} ` +
                        `${openInterestFormatted.padEnd(12)} ` +
                        `${ratio.padEnd(9)} ` +
                        `${fundingRate.padEnd(9)}% ` +
                        `${nextFunding}`
                    );
                }
            });

            await Promise.all(promises);
            if (i + batchSize < highVolumeSymbols.length) {
                await sleep(500);
            }
        }

    } catch (error) {
        console.error('程序执行出错:', error.message);
    }
}

// 执行程序
console.log('开始获取币安合约市场数据...\n');
getMarketInfo().then(() => {
    console.log('\n数据获取完成！');
}); 