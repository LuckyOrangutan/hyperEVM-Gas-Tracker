const { Web3 } = require('web3');

const HYPEREVM_RPC = 'https://rpc.hyperliquid.xyz/evm';

export default async function handler(req, res) {
    console.log('=== GAS TRACKER REQUEST ===');
    console.log('Method:', req.method);
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    console.log('========================');
    
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        console.error('Invalid method:', req.method);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Validate request body
        if (!req.body) {
            console.error('No request body provided');
            return res.status(400).json({ error: 'Request body is required' });
        }
        
        const { address } = req.body;
        console.log('Parsed request - Address:', address);
        
        if (!address || !isValidAddress(address)) {
            return res.status(400).json({ error: 'Invalid address provided' });
        }
        
        console.log(`Starting lifetime gas tracking for address: ${address}`);
        
        // Use the ultra-efficient counters method (only accurate method)
        try {
            console.log('Fetching lifetime gas data via hyperscan counters...');
            const result = await getLifetimeGasFromCounters(address);
            console.log('Successfully retrieved lifetime gas data');
            return res.json(result);
        } catch (apiError) {
            console.log('Hyperscan API failed:', apiError.message);
            
            // Return clear error - no inaccurate fallbacks
            return res.status(503).json({
                error: 'Unable to retrieve lifetime gas data from hyperscan.com',
                details: 'The gas tracker uses hyperscan.com counters for accurate lifetime totals.',
                suggestion: 'Please try again in a few minutes when hyperscan.com API recovers.',
                apiError: apiError.message
            });
        }
        
    } catch (error) {
        console.error('=== ERROR TRACKING GAS ===');
        console.error('Error object:', error);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        console.error('Error code:', error.code);
        console.error('Error name:', error.name);
        console.error('========================');
        
        // Better error handling for different error types
        let errorMessage = 'Failed to track gas usage';
        let statusCode = 500;
        
        if (error.message) {
            errorMessage = error.message;
            
            // Handle specific error types
            if (error.message.includes('timeout') || error.message.includes('Timeout')) {
                errorMessage = 'Request timed out. The RPC server is responding slowly.';
                statusCode = 408;
            } else if (error.message.includes('rate limit') || error.message.includes('Rate limit')) {
                errorMessage = 'Rate limited by RPC server. Please wait and try again.';
                statusCode = 429;
            } else if (error.message.includes('network') || error.message.includes('Network')) {
                errorMessage = 'Network connection failed. Please check your connection and try again.';
                statusCode = 503;
            } else if (error.message.includes('invalid json') || error.message.includes('Unexpected token')) {
                errorMessage = 'RPC server returned invalid response. This usually indicates rate limiting.';
                statusCode = 502;
            }
        }
        
        if (error.code === 'NETWORK_ERROR') {
            errorMessage = 'Network connection failed. Please try again.';
            statusCode = 503;
        }
        if (error.code === 'TIMEOUT') {
            errorMessage = 'Request timed out. The RPC server is overloaded.';
            statusCode = 408;
        }
        
        return res.status(statusCode).json({ 
            error: errorMessage,
            code: error.code || 'UNKNOWN_ERROR',
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}

async function getLifetimeGasFromCounters(address) {
    console.log('Fetching address counters...');
    
    // Get address counters (gas usage total)
    const countersResponse = await fetch(`https://www.hyperscan.com/api/v2/addresses/${address}/counters`, {
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'HyperEVM-Gas-Tracker/1.0'
        },
        timeout: 10000
    });
    
    if (!countersResponse.ok) {
        throw new Error(`Counters API returned ${countersResponse.status}: ${countersResponse.statusText}`);
    }
    
    const countersData = await countersResponse.json();
    console.log('Counters data:', countersData);
    
    if (!countersData.gas_usage_count) {
        throw new Error('No gas usage data found in counters');
    }
    
    // Get current network gas price stats
    console.log('Fetching network gas price stats...');
    const statsResponse = await fetch('https://www.hyperscan.com/api/v2/stats', {
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'HyperEVM-Gas-Tracker/1.0'
        },
        timeout: 10000
    });
    
    if (!statsResponse.ok) {
        throw new Error(`Stats API returned ${statsResponse.status}: ${statsResponse.statusText}`);
    }
    
    const statsData = await statsResponse.json();
    console.log('Network stats:', statsData);
    
    // Extract data
    const totalGasUsed = parseInt(countersData.gas_usage_count);
    const transactionCount = parseInt(countersData.transactions_count || '0');
    const averageGasPrice = parseFloat(statsData.average_gas_price || '25'); // Default 25 gwei if not available
    
    // Calculate total gas cost
    // gas_used (units) × average_gas_price (gwei) = cost in gwei
    // gwei ÷ 10^9 = ETH/HYPE
    const gasCostGwei = totalGasUsed * averageGasPrice;
    const gasCostHype = gasCostGwei / Math.pow(10, 9);
    
    console.log(`Calculated: ${totalGasUsed} gas units × ${averageGasPrice} gwei = ${gasCostHype} HYPE`);
    
    return {
        totalGas: gasCostHype.toFixed(6),
        totalGasDisplay: `${gasCostHype.toFixed(6)} HYPE`,
        transactionCount: transactionCount,
        gasUnitsUsed: totalGasUsed.toLocaleString(),
        averageGasPrice: `${averageGasPrice} gwei`,
        calculation: `${totalGasUsed.toLocaleString()} gas units × ${averageGasPrice} gwei = ${gasCostHype.toFixed(6)} HYPE`
    };
}

function isValidAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}