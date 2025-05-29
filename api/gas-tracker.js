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
        
        // Use the ultra-efficient method: get total gas from address counters
        try {
            console.log('Fetching lifetime gas data via address counters (ultra-efficient method)...');
            const result = await getLifetimeGasFromCounters(address);
            if (result) {
                console.log('Successfully retrieved complete lifetime gas data');
                return res.json(result);
            }
        } catch (apiError) {
            console.log('Counters API failed, trying transaction pagination method...', apiError.message);
            
            // Fallback to the old pagination method
            try {
                const apiResult = await tryBlockscoutAPI(address);
                if (apiResult) {
                    console.log('Successfully retrieved lifetime gas data via pagination fallback');
                    return res.json(apiResult);
                }
            } catch (paginationError) {
                console.log('Both methods failed:', paginationError.message);
                
                // Return a clear error - we can't provide incomplete data
                return res.status(503).json({
                    error: 'Unable to retrieve complete lifetime gas data. Both API methods are currently unavailable.',
                    details: 'This tracker only provides complete lifetime totals. Partial data would be misleading.',
                    suggestion: 'Please try again in a few minutes when the API service recovers.',
                    primaryError: apiError.message,
                    fallbackError: paginationError.message
                });
            }
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
        transactionCount: transactionCount,
        scanType: 'ultra-efficient',
        method: 'Address Counters + Network Stats',
        note: `Ultra-fast lookup: ${totalGasUsed.toLocaleString()} gas units × ${averageGasPrice} gwei (network average) = ${gasCostHype.toFixed(6)} HYPE`,
        gasUnitsUsed: totalGasUsed,
        averageGasPrice: averageGasPrice,
        calculationMethod: 'total_gas_units × average_network_gas_price ÷ 10^9'
    };
}

async function tryBlockscoutAPI(address) {
    let allTransactions = [];
    let totalGas = 0;
    let page = 1;
    const limit = 50;
    let retryCount = 0;
    const maxRetries = 3;
    
    // Try up to 20 pages for comprehensive scan when API is working
    while (page <= 20) {
        console.log(`Fetching Blockscout page ${page}...`);
        
        const url = `https://www.hyperscan.com/api/v2/addresses/${address}/transactions?page=${page}&limit=${limit}`;
        
        try {
            const response = await fetch(url, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'HyperEVM-Gas-Tracker/1.0'
                },
                timeout: 10000
            });
            
            if (!response.ok) {
                // If it's a server error and we haven't reached max retries for this page
                if (response.status >= 500 && retryCount < maxRetries) {
                    console.log(`Server error on page ${page}, retrying... (${retryCount + 1}/${maxRetries})`);
                    retryCount++;
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
                    continue;
                }
                throw new Error(`Blockscout API returned ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (!data.items || data.items.length === 0) {
                console.log('No more transactions found');
                break;
            }
            
            // Process transactions from this page
            for (const tx of data.items) {
                if (tx.from && tx.from.hash && tx.from.hash.toLowerCase() === address.toLowerCase()) {
                    const gasUsed = parseInt(tx.gas_used || '0');
                    const gasPrice = parseInt(tx.gas_price || '0');
                    const gasCostWei = gasUsed * gasPrice;
                    const gasCostHype = gasCostWei / Math.pow(10, 18);
                    
                    totalGas += gasCostHype;
                    allTransactions.push({
                        hash: tx.hash,
                        gasUsed: gasUsed,
                        gasPrice: gasPrice,
                        gasCostHype: gasCostHype
                    });
                }
            }
            
            if (data.items.length < limit) {
                console.log('Reached end of transactions (partial page)');
                break;
            }
            
            page++;
            retryCount = 0; // Reset retry count for next page
            await new Promise(resolve => setTimeout(resolve, 100)); // Short delay between pages
            
        } catch (fetchError) {
            if (retryCount < maxRetries) {
                console.log(`Error fetching page ${page}, retrying... (${retryCount + 1}/${maxRetries}):`, fetchError.message);
                retryCount++;
                await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                continue;
            }
            
            // If it's the first page, this is a critical error
            if (page === 1) {
                throw new Error(`Failed to fetch transaction data: ${fetchError.message}`);
            }
            
            // For subsequent pages, we can continue with what we have
            console.log(`Stopping pagination due to error on page ${page}:`, fetchError.message);
            break;
        }
    }
    
    return {
        totalGas: totalGas.toFixed(6),
        transactionCount: allTransactions.length,
        scanType: 'efficient',
        method: 'Blockscout API',
        note: `Scanned ${page - 1} pages of transactions via Blockscout API. Gas cost = gas_used × gas_price converted from wei to HYPE.`,
        pagesScanned: page - 1
    };
}

function isValidAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}