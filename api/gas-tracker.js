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
        
        // Go back to transaction scanning for accuracy
        try {
            console.log('Scanning all transactions to calculate exact gas fees...');
            const result = await scanAllTransactions(address);
            console.log('Successfully calculated lifetime gas fees');
            return res.json(result);
        } catch (apiError) {
            console.log('Transaction scanning failed:', apiError.message);
            
            return res.status(503).json({
                error: 'Unable to retrieve transaction data from hyperscan.com',
                details: 'This tracker calculates exact gas fees by scanning every transaction where this address paid gas.',
                suggestion: 'Please try again in a few minutes when the API recovers.',
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


async function scanAllTransactions(address) {
    console.log(`Starting transaction scan for address: ${address}`);
    
    let totalGasFeesHype = 0;
    let transactionCount = 0;
    let offset = 0;
    const limit = 10000; // Max limit per request
    
    try {
        while (true) {
            console.log(`Fetching transactions: offset=${offset}, limit=${limit}`);
            
            // Try different API endpoints
            const endpoints = [
                `https://api.hyperscan.xyz/v1/addresses/${address}/transactions?limit=${limit}&offset=${offset}`,
                `https://www.hyperscan.xyz/api/v1/addresses/${address}/transactions?limit=${limit}&offset=${offset}`,
                `https://hyperscan.xyz/api/v1/addresses/${address}/transactions?limit=${limit}&offset=${offset}`
            ];
            
            let response;
            let lastError;
            
            for (const endpoint of endpoints) {
                try {
                    console.log(`Trying endpoint: ${endpoint}`);
                    response = await fetch(endpoint, {
                        headers: {
                            'Accept': 'application/json',
                            'User-Agent': 'HyperEVM-Gas-Tracker/1.0'
                        }
                    });
                    
                    if (response.ok) {
                        console.log(`Success with endpoint: ${endpoint}`);
                        break;
                    }
                    lastError = `${response.status}: ${response.statusText}`;
                } catch (e) {
                    lastError = e.message;
                    console.log(`Failed with ${endpoint}: ${e.message}`);
                }
            }
            
            if (!response || !response.ok) {
                throw new Error(`All Hyperscan API endpoints failed. Last error: ${lastError}`);
            }
            
            console.log(`Response status: ${response.status}`);
            
            const data = await response.json();
            console.log(`Received ${data.items ? data.items.length : 0} transactions`);
            
            if (!data.items || !Array.isArray(data.items)) {
                console.log('No more transactions found');
                break;
            }
            
            // Process each transaction
            for (const tx of data.items) {
                // Check if transaction was sent FROM this address (they paid the gas)
                // The fee field contains the gas fee in HYPE
                if (tx.from && tx.from.toLowerCase() === address.toLowerCase() && tx.fee) {
                    const feeHype = parseFloat(tx.fee);
                    totalGasFeesHype += feeHype;
                    transactionCount++;
                    
                    console.log(`TX ${tx.hash}: fee=${feeHype} HYPE`);
                }
            }
            
            // Check if we've fetched all transactions
            if (data.items.length < limit) {
                console.log(`Fetched all transactions. Total: ${transactionCount}`);
                break;
            }
            
            offset += limit;
            
            // Add a small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.log(`Total gas fees: ${totalGasFeesHype} HYPE from ${transactionCount} transactions`);
        
        return {
            totalGas: totalGasFeesHype.toFixed(6),
            totalGasDisplay: `${totalGasFeesHype.toFixed(6)} HYPE`,
            transactionCount: transactionCount,
            totalGasWei: (totalGasFeesHype * Math.pow(10, 18)).toString(),
            gasUnitsUsed: 'Direct fee aggregation',
            averageGasPrice: 'N/A',
            calculation: `Sum of fees from ${transactionCount.toLocaleString()} transactions = ${totalGasFeesHype.toFixed(6)} HYPE`,
            method: 'exact_fee_aggregation'
        };
        
    } catch (error) {
        console.error('Error scanning transactions:', error);
        throw error;
    }
}

function isValidAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}