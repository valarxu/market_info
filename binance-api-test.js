const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
require('dotenv').config();

// 币安API的基础URL
const BINANCE_API_BASE = 'https://api.binance.com';

// 从环境变量中读取代理配置
const proxyConfig = {
    host: process.env.PROXY_HOST || '127.0.0.1',
    port: process.env.PROXY_PORT || 8080
};

// 创建带有代理的axios实例
const axiosInstance = axios.create({
    httpsAgent: new HttpsProxyAgent(`http://${proxyConfig.host}:${proxyConfig.port}`),
    timeout: 10000 // 设置10秒超时
});

// 测试不同的API端点
async function testBinanceAPI() {
    try {
        // 1. 测试服务器时间
        console.log('测试服务器时间...');
        const timeResponse = await axiosInstance.get(`${BINANCE_API_BASE}/api/v3/time`);
        console.log('服务器时间正常 ✅');

        // 2. 测试行情接口
        console.log('\n测试行情接口...');
        const tickerResponse = await axiosInstance.get(`${BINANCE_API_BASE}/api/v3/ticker/price`, {
            params: {
                symbol: 'BTCUSDT'
            }
        });
        console.log('行情接口正常 ✅');
        console.log('BTC当前价格:', tickerResponse.data.price);

        // 3. 测试深度信息
        console.log('\n测试深度信息...');
        const depthResponse = await axiosInstance.get(`${BINANCE_API_BASE}/api/v3/depth`, {
            params: {
                symbol: 'BTCUSDT',
                limit: 5
            }
        });
        console.log('深度信息接口正常 ✅');

        // 4. 测试24小时价格统计
        console.log('\n测试24小时价格统计...');
        const statsResponse = await axiosInstance.get(`${BINANCE_API_BASE}/api/v3/ticker/24hr`, {
            params: {
                symbol: 'BTCUSDT'
            }
        });
        console.log('24小时价格统计接口正常 ✅');

    } catch (error) {
        console.error('测试过程中发生错误:', error.message);
        if (error.response) {
            console.error('错误状态码:', error.response.status);
            console.error('错误数据:', error.response.data);
        }
    }
}

// 执行测试
console.log('开始测试币安API...\n');
testBinanceAPI().then(() => {
    console.log('\n所有测试完成！');
}); 