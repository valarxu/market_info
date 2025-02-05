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

// 获取所有合约交易对信息
async function getAllSymbols() {
    try {
        console.log('获取币安合约交易对信息...\n');

        // 获取交易所信息
        const response = await axiosInstance.get(`${BINANCE_FAPI_BASE}/fapi/v1/exchangeInfo`);
        const symbols = response.data.symbols;

        // 过滤出正在交易的合约
        const activeSymbols = symbols.filter(symbol => 
            symbol.status === 'TRADING' && 
            symbol.contractType === 'PERPETUAL' // 只获取永续合约
        );

        console.log(`当前可交易的永续合约数量: ${activeSymbols.length}\n`);

        // 按交易量排序
        const volume24h = await get24hVolume();
        activeSymbols.sort((a, b) => {
            const volumeA = volume24h[a.symbol] || 0;
            const volumeB = volume24h[b.symbol] || 0;
            return volumeB - volumeA;
        });

        console.log('按24小时交易量排序的合约列表:');
        console.log('symbol\t\t24h成交量(USDT)\t\t最小下单数量');
        console.log('------------------------------------------------');
        
        for (const symbol of activeSymbols) {
            const volume = volume24h[symbol.symbol] 
                ? (volume24h[symbol.symbol] / 1000000).toFixed(2) + 'M' 
                : 'N/A';
            
            // 找到数量精度的过滤器
            const lotSizeFilter = symbol.filters.find(f => f.filterType === 'LOT_SIZE');
            const minQty = lotSizeFilter ? lotSizeFilter.minQty : 'N/A';

            // 对齐输出
            console.log(
                `${symbol.symbol.padEnd(15)} ${volume.padEnd(20)} ${minQty}`
            );
        }

    } catch (error) {
        console.error('获取交易对信息时发生错误:', error.message);
        if (error.response) {
            console.error('错误状态码:', error.response.status);
            console.error('错误信息:', error.response.data);
        }
    }
}

// 获取24小时成交量数据
async function get24hVolume() {
    try {
        const response = await axiosInstance.get(`${BINANCE_FAPI_BASE}/fapi/v1/ticker/24hr`);
        const volumeMap = {};
        response.data.forEach(ticker => {
            volumeMap[ticker.symbol] = parseFloat(ticker.quoteVolume); // 使用USDT计价的成交量
        });
        return volumeMap;
    } catch (error) {
        console.error('获取24小时成交量数据失败:', error.message);
        return {};
    }
}

// 执行程序
console.log('开始获取币安合约市场信息...\n');
getAllSymbols().then(() => {
    console.log('\n获取完成！');
}); 