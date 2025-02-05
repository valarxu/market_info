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

// 获取合约持仓量信息
async function getOpenInterest(symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT']) {
    try {
        console.log('获取合约总持仓量信息...\n');

        for (const symbol of symbols) {
            // 1. 获取当前持仓量
            const openInterestResponse = await axiosInstance.get(`${BINANCE_FAPI_BASE}/fapi/v1/openInterest`, {
                params: { symbol }
            });

            // 2. 获取标记价格
            const priceResponse = await axiosInstance.get(`${BINANCE_FAPI_BASE}/fapi/v1/premiumIndex`, {
                params: { symbol }
            });

            // 3. 获取持仓量历史数据（4小时间隔）
            const historyResponse = await axiosInstance.get(`${BINANCE_FAPI_BASE}/futures/data/openInterestHist`, {
                params: {
                    symbol,
                    period: '4h',
                    limit: 6
                }
            });

            const price = parseFloat(priceResponse.data.markPrice);
            const openInterest = parseFloat(openInterestResponse.data.openInterest);
            const openInterestValue = openInterest * price;

            console.log(`${symbol} 持仓信息:`);
            console.log('------------------------');
            console.log('当前持仓量:', openInterest.toFixed(2), symbol.replace('USDT', ''));
            console.log('当前价格:', price.toFixed(2), 'USDT');
            console.log('持仓价值:', (openInterestValue / 1000000).toFixed(2), '百万USDT');

            if (historyResponse.data.length > 0) {
                console.log('\n持仓量历史数据（最近24小时，4小时间隔）:');
                historyResponse.data.reverse().forEach(item => {
                    const timestamp = new Date(item.timestamp).toLocaleString();
                    const historyOpenInterest = parseFloat(item.sumOpenInterest);
                    const historyOpenInterestValue = parseFloat(item.sumOpenInterestValue);
                    
                    console.log('------------------------');
                    console.log('时间:', timestamp);
                    console.log('持仓量:', historyOpenInterest.toFixed(2), symbol.replace('USDT', ''));
                    console.log('持仓价值:', (historyOpenInterestValue / 1000000).toFixed(2), '百万USDT');
                });
            }

            console.log('\n');
        }

    } catch (error) {
        console.error('获取持仓量信息时发生错误:', error.message);
        if (error.response) {
            console.error('错误状态码:', error.response.status);
            console.error('错误信息:', error.response.data);
        }
    }
}

// 执行程序
console.log('开始获取币安合约市场持仓量信息...\n');
getOpenInterest().then(() => {
    console.log('获取完成！');
}); 