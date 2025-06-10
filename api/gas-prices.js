const { Web3 } = require('web3');

const HYPEREVM_RPC = 'https://rpc.hyperliquid.xyz/evm';

export default async function handler(req, res) {
    console.log('=== GAS PRICES REQUEST ===');
    
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const web3 = new Web3(HYPEREVM_RPC);
        
        // Get current gas price
        const gasPrice = await web3.eth.getGasPrice();
        const gasPriceGwei = Number(web3.utils.fromWei(gasPrice, 'gwei'));
        
        // Get latest block to analyze gas prices
        const latestBlock = await web3.eth.getBlock('latest', true);
        const transactions = latestBlock.transactions || [];
        
        let gasPrices = [];
        
        // Analyze recent transactions for gas price distribution
        for (const tx of transactions) {
            if (tx.gasPrice) {
                const priceInGwei = Number(web3.utils.fromWei(tx.gasPrice, 'gwei'));
                gasPrices.push(priceInGwei);
            }
        }
        
        // Sort gas prices
        gasPrices.sort((a, b) => a - b);
        
        let low, average, high;
        
        if (gasPrices.length > 0) {
            // Calculate percentiles
            low = gasPrices[Math.floor(gasPrices.length * 0.1)] || gasPrices[0];
            average = gasPrices[Math.floor(gasPrices.length * 0.5)] || gasPriceGwei;
            high = gasPrices[Math.floor(gasPrices.length * 0.9)] || gasPrices[gasPrices.length - 1];
        } else {
            // Fallback to standard gas price with variations
            low = gasPriceGwei * 0.8;
            average = gasPriceGwei;
            high = gasPriceGwei * 1.5;
        }
        
        // Estimate USD costs for a standard transaction (21000 gas units)
        // Assuming HYPE price (you might want to fetch this from an API)
        const hypePrice = 30; // $30 per HYPE - update this dynamically if needed
        const standardGasUnits = 21000;
        
        const calculateUSD = (gwei) => {
            const hypeAmount = (gwei * standardGasUnits) / 1e9;
            return hypeAmount * hypePrice;
        };
        
        const response = {
            timestamp: new Date().toISOString(),
            blockNumber: latestBlock.number,
            baseFee: gasPriceGwei,
            prices: {
                low: {
                    gwei: low.toFixed(2),
                    usd: calculateUSD(low).toFixed(4)
                },
                average: {
                    gwei: average.toFixed(2),
                    usd: calculateUSD(average).toFixed(4)
                },
                high: {
                    gwei: high.toFixed(2),
                    usd: calculateUSD(high).toFixed(4)
                }
            },
            sampleSize: gasPrices.length,
            hypePrice: hypePrice
        };
        
        console.log('Gas prices response:', response);
        return res.json(response);
        
    } catch (error) {
        console.error('Error fetching gas prices:', error);
        return res.status(500).json({ 
            error: 'Failed to fetch gas prices',
            details: error.message
        });
    }
}