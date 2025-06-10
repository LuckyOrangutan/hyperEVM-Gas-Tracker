// Dedicated live price endpoint for frontend
let priceCache = {
    price: 30, // Fallback price
    timestamp: 0,
    ttl: 10 * 1000, // 10 seconds cache
    source: 'fallback'
};

// Fast price fetching optimized for live updates
async function getLiveHypePrice() {
    const now = Date.now();
    if (now - priceCache.timestamp < priceCache.ttl && priceCache.price > 0) {
        return {
            price: priceCache.price,
            source: priceCache.source,
            cached: true,
            age: Math.floor((now - priceCache.timestamp) / 1000)
        };
    }
    
    // Ultra-fast price sources
    const fastSources = [
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
            name: 'Hyperliquid',
            url: 'https://api.hyperliquid.xyz/info',
            method: 'POST',
            body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
            headers: { 'Content-Type': 'application/json' },
            parser: (data) => {
                const assets = data?.[1];
                const hypeAsset = assets?.find(asset => asset?.name === 'HYPE');
                return hypeAsset?.markPx ? parseFloat(hypeAsset.markPx) : null;
            }
        }
    ];
    
    for (const source of fastSources) {
        try {
            const fetchOptions = {
                method: source.method || 'GET',
                headers: {
                    'User-Agent': 'HyperEVM-Gas-Tracker/1.0',
                    'Accept': 'application/json',
                    ...source.headers
                },
                timeout: 3000 // Ultra-fast timeout
            };
            
            if (source.body) {
                fetchOptions.body = source.body;
            }
            
            const response = await fetch(source.url, fetchOptions);
            
            if (!response.ok) continue;
            
            const data = await response.json();
            const price = source.parser(data);
            
            if (price && isFinite(price) && price > 0) {
                priceCache = {
                    price: price,
                    timestamp: now,
                    ttl: priceCache.ttl,
                    source: source.name
                };
                
                return {
                    price: price,
                    source: source.name,
                    cached: false,
                    age: 0
                };
            }
            
        } catch (error) {
            continue; // Try next source
        }
    }
    
    // Use cached or fallback
    const fallbackPrice = priceCache.price > 0 ? priceCache.price : 30;
    return {
        price: fallbackPrice,
        source: priceCache.source || 'fallback',
        cached: true,
        age: priceCache.timestamp > 0 ? Math.floor((now - priceCache.timestamp) / 1000) : -1
    };
}

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const priceData = await getLiveHypePrice();
        
        return res.json({
            timestamp: new Date().toISOString(),
            hype: {
                price: priceData.price,
                formatted: `$${priceData.price.toFixed(2)}`,
                source: priceData.source,
                cached: priceData.cached,
                age: priceData.age
            },
            status: 'success'
        });
        
    } catch (error) {
        console.error('Live price error:', error);
        return res.status(500).json({ 
            error: 'Failed to fetch live price',
            fallback: 30
        });
    }
}