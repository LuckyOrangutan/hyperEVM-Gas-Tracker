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
        // Hyperscan uses Blockscout API format
        while (true) {
            const endpoints = [
                // Primary endpoint - Blockscout format for Hyperscan
                `https://www.hyperscan.com/api?module=account&action=txlist&address=${address}&page=${page}&offset=${limit}&sort=desc`,
                // Alternative without www
                `https://hyperscan.com/api?module=account&action=txlist&address=${address}&page=${page}&offset=${limit}&sort=desc`,
                // Try with different parameters
                `https://www.hyperscan.com/api?module=account&action=txlist&address=${address}&startblock=0&endblock=999999999&page=${page}&offset=${limit}`
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
                
                // Calculate fee from gasUsed * gasPrice (Blockscout format)
                let feeInWei = 0;
                if (tx.gasUsed && tx.gasPrice) {
                    feeInWei = BigInt(tx.gasUsed) * BigInt(tx.gasPrice);
                } else if (tx.fee) {
                    // Direct fee field if available
                    feeInWei = BigInt(tx.fee);
                } else if (tx.txreceipt_status === '1' && tx.gasUsed && tx.gasPrice) {
                    // Blockscout format
                    feeInWei = BigInt(tx.gasUsed) * BigInt(tx.gasPrice);
                }
                
                if (from && from.toLowerCase() === address.toLowerCase() && feeInWei > 0) {
                    const feeHype = Number(feeInWei) / Math.pow(10, 18);
                    totalGasFeesHype += feeHype;
                    transactionCount++;
                    
                    console.log(`TX ${tx.hash}: fee=${feeHype} HYPE`);
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