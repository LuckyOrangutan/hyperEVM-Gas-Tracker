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
        const gasPriceGwei = Number(web3.utils.fromWei(String(gasPrice), 'gwei'));
        
        // Get latest blocks to analyze gas prices (look at last 10 blocks for better sample)
        const latestBlockNumber = await web3.eth.getBlockNumber();
        let gasPrices = [];
        
        // Analyze last 10 blocks to get more transaction samples
        const blocksToAnalyze = 10;
        const blockPromises = [];
        
        for (let i = 0; i < blocksToAnalyze; i++) {
            const blockNumber = latestBlockNumber - BigInt(i);
            blockPromises.push(web3.eth.getBlock(blockNumber, true));
        }
        
        const blocks = await Promise.all(blockPromises);
        
        // Collect gas prices from all blocks
        for (const block of blocks) {
            if (block && block.transactions) {
                for (const tx of block.transactions) {
                    if (tx.gasPrice) {
                        const priceInGwei = Number(web3.utils.fromWei(String(tx.gasPrice), 'gwei'));
                        gasPrices.push(priceInGwei);
                    }
                }
            }
        }
        
        // Sort gas prices
        gasPrices.sort((a, b) => a - b);
        
        let low, average, high;
        
        if (gasPrices.length > 0) {
            // Calculate percentiles
            const p10 = Math.floor(gasPrices.length * 0.1);
            const p50 = Math.floor(gasPrices.length * 0.5);
            const p90 = Math.floor(gasPrices.length * 0.9);
            
            low = gasPrices[p10] || gasPrices[0];
            average = gasPrices[p50] || gasPriceGwei;
            high = gasPrices[p90] || gasPrices[gasPrices.length - 1];
            
            // Ensure minimum variation if all prices are too similar
            const minDiff = 0.01; // Minimum 0.01 Gwei difference
            if (high - low < minDiff * 2) {
                // If prices are too similar, create artificial spread based on average
                low = Math.max(0.01, average - minDiff);
                high = average + minDiff;
            }
        } else {
            // Fallback to standard gas price with variations
            low = Math.max(0.01, gasPriceGwei * 0.8);
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
            blockNumber: Number(latestBlockNumber),
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