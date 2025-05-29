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
                error: 'Hyperscan API is currently unavailable',
                details: 'This tracker requires access to Hyperscan to calculate exact gas fees for airdrop points.',
                suggestion: 'Hyperscan may be down or have changed their API. Please try again later or contact support.',
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
    let page = 1;
    const limit = 100; // Try smaller limit
    
    try {
        // Let's try the most likely API endpoints for Hyperscan
        while (true) {
            const endpoints = [
                // Try various possible Hyperscan API patterns
                `https://api.hyperscan.xyz/accounts/${address}/transactions?page=${page}&limit=${limit}`,
                `https://hyperscan.xyz/api/v1/accounts/${address}/transactions?page=${page}&limit=${limit}`,
                `https://api.hyperscan.io/v1/address/${address}/txs?page=${page}&limit=${limit}`,
                // Common blockchain explorer API patterns
                `https://hyperscan.xyz/api?module=account&action=txlist&address=${address}&page=${page}&offset=${limit}`,
                `https://api.hyperscan.xyz/v1/txs?address=${address}&page=${page}&limit=${limit}`
            ];
            
            let response;
            let data;
            let success = false;
            
            for (const endpoint of endpoints) {
                try {
                    console.log(`Trying: ${endpoint}`);
                    response = await fetch(endpoint, {
                        headers: {
                            'Accept': 'application/json',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    });
                    
                    if (response.ok) {
                        data = await response.json();
                        console.log('Response structure:', Object.keys(data));
                        success = true;
                        break;
                    }
                } catch (e) {
                    console.log(`Failed: ${e.message}`);
                }
            }
            
            if (!success) {
                throw new Error('Unable to connect to Hyperscan API. Please check if the service is available.');
            }
            
            // Handle different possible response formats
            const transactions = data.items || data.result || data.txs || data.transactions || data.data || [];
            
            if (!Array.isArray(transactions) || transactions.length === 0) {
                console.log('No more transactions found');
                break;
            }
            
            // Process transactions
            for (const tx of transactions) {
                // Check various possible field names for the sender
                const from = tx.from || tx.from_address || tx.sender;
                const fee = tx.fee || tx.txfee || tx.gasUsed || tx.gas_fee;
                
                if (from && from.toLowerCase() === address.toLowerCase() && fee) {
                    const feeHype = typeof fee === 'string' ? parseFloat(fee) : fee;
                    totalGasFeesHype += feeHype;
                    transactionCount++;
                    
                    console.log(`TX: fee=${feeHype} HYPE`);
                }
            }
            
            // Check if we've fetched all transactions
            if (transactions.length < limit) {
                break;
            }
            
            page++;
            await new Promise(resolve => setTimeout(resolve, 200)); // Rate limit
        }
        
        console.log(`Total exact gas fees: ${totalGasFeesHype} HYPE from ${transactionCount} transactions`);
        
        return {
            totalGas: totalGasFeesHype.toFixed(6),
            totalGasDisplay: `${totalGasFeesHype.toFixed(6)} HYPE`,
            transactionCount: transactionCount,
            totalGasWei: (totalGasFeesHype * Math.pow(10, 18)).toString(),
            gasUnitsUsed: 'Exact calculation',
            averageGasPrice: 'Variable',
            calculation: `Exact sum of ${transactionCount.toLocaleString()} transaction fees = ${totalGasFeesHype.toFixed(6)} HYPE`,
            method: 'exact_fee_sum'
        };
        
    } catch (error) {
        console.error('Error scanning transactions:', error);
        throw error;
    }
}

function isValidAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}