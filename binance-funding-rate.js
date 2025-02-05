const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
require('dotenv').config();

// 币安合约API的基础URL
const BINANCE_FAPI_BASE = 'https://fapi.binance.com';  // 修改为合约API地址

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

// 获取资金费率信息
async function getFundingRateInfo(symbol = 'BTCUSDT') {
    try {
        console.log(`获取 ${symbol} 的资金费率信息...\n`);

        // 1. 获取当前资金费率
        const currentFundingRate = await axiosInstance.get(`${BINANCE_FAPI_BASE}/fapi/v1/premiumIndex`, {
            params: { symbol }
        });
        console.log('当前资金费率信息:');
        console.log('标的对:', currentFundingRate.data.symbol);
        console.log('标记价格:', currentFundingRate.data.markPrice);
        console.log('指数价格:', currentFundingRate.data.indexPrice);
        console.log('当前资金费率:', `${(parseFloat(currentFundingRate.data.lastFundingRate) * 100).toFixed(4)}%`);
        console.log('下次资金费率时间:', new Date(currentFundingRate.data.nextFundingTime).toLocaleString());
        console.log('✅ 当前资金费率获取成功\n');

        // 2. 获取历史资金费率
        const historyFundingRate = await axiosInstance.get(`${BINANCE_FAPI_BASE}/fapi/v1/fundingRate`, {
            params: {
                symbol,
                limit: 5  // 最近5条记录
            }
        });
        console.log('历史资金费率记录（最近5条）:');
        historyFundingRate.data.forEach(rate => {
            console.log('------------------------');
            console.log('时间:', new Date(rate.fundingTime).toLocaleString());
            console.log('费率:', `${(parseFloat(rate.fundingRate) * 100).toFixed(4)}%`);
        });
        console.log('✅ 历史资金费率获取成功\n');

    } catch (error) {
        console.error('获取资金费率信息时发生错误:', error.message);
        if (error.response) {
            console.error('错误状态码:', error.response.status);
            console.error('错误信息:', error.response.data);
        }
    }
}

// 执行测试
console.log('开始测试币安资金费率API...\n');
getFundingRateInfo().then(() => {
    console.log('所有资金费率信息获取完成！');
}); 