const { Web3 } = require('web3');

const HYPEREVM_RPC = 'https://rpc.hyperliquid.xyz/evm';

// Price caching with fast refresh
let priceCache = {
    price: 30, // Fallback price
    timestamp: 0,
    ttl: 10 * 1000 // 10 seconds cache for live updates
};

// Dynamic HYPE price fetching with multiple sources
async function getHypePrice() {
    // Check cache first
    const now = Date.now();
    if (now - priceCache.timestamp < priceCache.ttl && priceCache.price > 0) {
        console.log(`Using cached HYPE price: $${priceCache.price}`);
        return priceCache.price;
    }
    
    console.log('Fetching fresh HYPE price...');
    
    // Price sources in order of preference (fastest first)
    const priceSources = [
        {
            name: 'DexScreener',
            url: 'https://api.dexscreener.com/latest/dex/search/?q=Hyperliquid',
            parser: (data) => {
                const pairs = data?.pairs;
                if (Array.isArray(pairs) && pairs.length > 0) {
                    // Find the Hyperliquid token pair with highest liquidity
                    const hypePairs = pairs.filter(pair => 
                        (pair?.baseToken?.symbol === 'HYPE' || 
                         pair?.baseToken?.name?.toLowerCase().includes('hyperliquid')) &&
                        pair?.priceUsd && 
                        parseFloat(pair.priceUsd) > 10 && // Filter out small tokens
                        parseFloat(pair.priceUsd) < 1000   // Reasonable price range
                    );
                    
                    if (hypePairs.length > 0) {
                        // Sort by liquidity and take the most liquid pair
                        const sortedPairs = hypePairs.sort((a, b) => 
                            parseFloat(b.liquidity?.usd || 0) - parseFloat(a.liquidity?.usd || 0)
                        );
                        return parseFloat(sortedPairs[0].priceUsd);
                    }
                }
                return null;
            }
        },
        {
            name: 'Hyperliquid API',
            url: 'https://api.hyperliquid.xyz/info',
            method: 'POST',
            body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
            headers: { 'Content-Type': 'application/json' },
            parser: (data) => {
                // Parse Hyperliquid's response for HYPE price
                const assets = data?.[1];
                const hypeAsset = assets?.find(asset => asset?.name === 'HYPE');
                return hypeAsset?.markPx ? parseFloat(hypeAsset.markPx) : null;
            }
        },
        {
            name: 'CoinGecko',
            url: 'https://api.coingecko.com/api/v3/simple/price?ids=hyperliquid&vs_currencies=usd',
            parser: (data) => data?.hyperliquid?.usd
        },
        {
            name: 'CoinMarketCap',
            url: 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=HYPE',
            headers: {
                'X-CMC_PRO_API_KEY': process.env.CMC_API_KEY // Optional API key
            },
            parser: (data) => data?.data?.HYPE?.quote?.USD?.price
        }
    ];
    
    for (const source of priceSources) {
        try {
            console.log(`Trying ${source.name}...`);
            
            const fetchOptions = {
                method: source.method || 'GET',
                headers: {
                    'User-Agent': 'HyperEVM-Gas-Tracker/1.0',
                    'Accept': 'application/json',
                    ...source.headers
                },
                timeout: 5000 // Faster timeout for live updates
            };
            
            if (source.body) {
                fetchOptions.body = source.body;
            }
            
            const response = await fetch(source.url, fetchOptions);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            const price = source.parser(data);
            
            if (price && isFinite(price) && price > 0) {
                console.log(`✓ ${source.name}: $${price}`);
                
                // Update cache
                priceCache = {
                    price: price,
                    timestamp: now,
                    ttl: priceCache.ttl
                };
                
                return price;
            } else {
                console.warn(`${source.name} returned invalid price:`, price);
            }
            
        } catch (error) {
            console.warn(`${source.name} failed:`, error.message);
            continue;
        }
    }
    
    // All sources failed, use cached or fallback price
    const fallbackPrice = priceCache.price > 0 ? priceCache.price : 30;
    console.warn(`All price sources failed, using fallback: $${fallbackPrice}`);
    
    return fallbackPrice;
}

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
        
        // Get current gas price with robust error handling
        let gasPrice, gasPriceGwei;
        try {
            gasPrice = await web3.eth.getGasPrice();
            if (!gasPrice || gasPrice <= 0) {
                throw new Error('Invalid gas price returned from RPC');
            }
            
            // Use BigInt for precision in Gwei conversion
            const gasPriceBigInt = typeof gasPrice === 'string' ? BigInt(gasPrice) : BigInt(gasPrice.toString());
            const gweiDivisor = BigInt('1000000000'); // 10^9
            const gweiBigInt = gasPriceBigInt / gweiDivisor;
            const remainder = gasPriceBigInt % gweiDivisor;
            
            // Convert to decimal Gwei with precision
            gasPriceGwei = Number(gweiBigInt) + (Number(remainder) / Number(gweiDivisor));
            
            if (!isFinite(gasPriceGwei) || gasPriceGwei <= 0) {
                throw new Error('Invalid Gwei conversion result');
            }
        } catch (gasPriceError) {
            console.error('Error fetching gas price:', gasPriceError);
            throw new Error(`Failed to get current gas price: ${gasPriceError.message}`);
        }
        
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
                        try {
                            // Robust Gwei conversion with validation
                            const txGasPrice = typeof tx.gasPrice === 'string' ? BigInt(tx.gasPrice) : BigInt(tx.gasPrice.toString());
                            const gweiDivisor = BigInt('1000000000');
                            const gweiBigInt = txGasPrice / gweiDivisor;
                            const remainder = txGasPrice % gweiDivisor;
                            
                            const priceInGwei = Number(gweiBigInt) + (Number(remainder) / Number(gweiDivisor));
                            
                            // Validate the result
                            if (isFinite(priceInGwei) && priceInGwei > 0 && priceInGwei <= 10000) { // Max 10,000 Gwei sanity check
                                gasPrices.push(priceInGwei);
                            }
                        } catch (conversionError) {
                            console.warn(`Skipping invalid gas price ${tx.gasPrice}:`, conversionError.message);
                        }
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
        // Fetch HYPE price dynamically
        const hypePrice = await getHypePrice();
        const standardGasUnits = 21000;
        
        const calculateUSD = (gwei) => {
            try {
                // Robust USD calculation with validation
                if (!isFinite(gwei) || gwei < 0) {
                    throw new Error('Invalid Gwei value for USD calculation');
                }
                
                // Use BigInt for precision in gas cost calculation
                const gweiAsBigInt = BigInt(Math.round(gwei * 1e9)); // Convert to wei
                const gasUnitsAsBigInt = BigInt(standardGasUnits);
                const totalWei = gweiAsBigInt * gasUnitsAsBigInt;
                
                // Convert to HYPE (18 decimal places)
                const hypeAmount = Number(totalWei) / 1e18;
                const usdAmount = hypeAmount * hypePrice;
                
                if (!isFinite(usdAmount) || usdAmount < 0) {
                    throw new Error('Invalid USD calculation result');
                }
                
                return usdAmount;
            } catch (error) {
                console.warn(`USD calculation failed for ${gwei} Gwei:`, error.message);
                return 0;
            }
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
            hypePrice: hypePrice,
            priceSource: priceCache.timestamp > 0 ? 'live_api' : 'fallback',
            priceAge: priceCache.timestamp > 0 ? `${Math.floor((Date.now() - priceCache.timestamp) / 1000)}s` : 'unknown'
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