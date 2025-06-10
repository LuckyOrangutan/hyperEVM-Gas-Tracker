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
        
        // Use only Hyperscan API for accurate data
        try {
            console.log('Fetching transaction data from Hyperscan API...');
            const result = await scanAllTransactions(address);
            console.log('Successfully calculated lifetime gas fees');
            return res.json(result);
        } catch (apiError) {
            console.log('Hyperscan API failed:', apiError.message);
            
            return res.status(503).json({
                error: 'Transaction data service temporarily unavailable',
                details: 'The Hyperscan API is currently not responding. This ensures you get accurate lifetime gas data.',
                suggestion: 'Please try again in a few minutes.',
                retryAfter: 60
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
    let totalGasUnitsUsed = 0;
    let transactionCount = 0;
    let page = 1;
    const limit = 100;
    const processedTxs = new Set(); // Track processed transaction hashes to prevent duplicates
    
    try {
        // Use consistent primary endpoint for all pages to avoid pagination issues
        const primaryEndpoint = `https://www.hyperscan.com/api?module=account&action=txlist&address=${address}&sort=desc`;
        
        while (true) {
            const url = `${primaryEndpoint}&page=${page}&offset=${limit}`;
            console.log(`Fetching page ${page}: ${url}`);
            
            let response;
            let data;
            
            try {
                response = await fetch(url, {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                data = await response.json();
                console.log(`Page ${page} - Response status: ${data.status}, message: ${data.message}`);
                
            } catch (error) {
                console.error(`Failed to fetch page ${page}:`, error.message);
                throw new Error(`Unable to fetch page ${page} from Hyperscan API: ${error.message}`);
            }
            
            // Handle different possible response formats
            const transactions = data.items || data.result || data.txs || data.transactions || data.data || [];
            
            if (!Array.isArray(transactions) || transactions.length === 0) {
                console.log('No more transactions found');
                break;
            }
            
            // Process transactions
            for (const tx of transactions) {
                // Skip if we've already processed this transaction
                if (processedTxs.has(tx.hash)) {
                    console.log(`TX ${tx.hash}: Already processed, skipping duplicate`);
                    continue;
                }
                
                // Check various possible field names for the sender
                const from = tx.from || tx.from_address || tx.sender;
                
                // Only process transactions from the target address
                if (!from || from.toLowerCase() !== address.toLowerCase()) {
                    continue;
                }
                
                // Calculate HYPE fee from Hyperscan's gasUsed and gasPrice
                let feeHype = 0;
                
                if (tx.gasUsed && tx.gasPrice) {
                    // Calculate fee in Wei, then convert to HYPE
                    const feeInWei = BigInt(tx.gasUsed) * BigInt(tx.gasPrice);
                    feeHype = Number(feeInWei) / Math.pow(10, 18);
                } else {
                    // Skip transaction if missing gas data
                    console.log(`TX ${tx.hash}: Missing gasUsed or gasPrice, skipping`);
                    continue;
                }
                
                // Add to our totals
                processedTxs.add(tx.hash);
                totalGasFeesHype += feeHype;
                
                // Track gas units used (separate from fees)
                if (tx.gasUsed) {
                    totalGasUnitsUsed += Number(tx.gasUsed);
                }
                
                transactionCount++;
                
                console.log(`TX ${tx.hash}: Added ${feeHype.toFixed(6)} HYPE (${tx.gasUsed} gas × ${tx.gasPrice} Wei)`);
            }
            
            // Check if we've fetched all transactions
            if (transactions.length < limit) {
                break;
            }
            
            page++;
            await new Promise(resolve => setTimeout(resolve, 200)); // Rate limit
        }
        
        console.log(`Total gas fees: ${totalGasFeesHype} HYPE, Total gas units: ${totalGasUnitsUsed.toLocaleString()} from ${transactionCount} transactions`);
        
        return {
            totalGas: totalGasFeesHype.toFixed(6),
            totalGasDisplay: `${totalGasFeesHype.toFixed(6)} HYPE`,
            transactionCount: transactionCount,
            totalGasWei: (totalGasFeesHype * Math.pow(10, 18)).toString(),
            gasUnitsUsed: totalGasUnitsUsed.toLocaleString(),
            totalGasUnits: totalGasUnitsUsed,
            averageGasPrice: totalGasUnitsUsed > 0 ? ((totalGasFeesHype * Math.pow(10, 18)) / totalGasUnitsUsed / Math.pow(10, 9)).toFixed(4) + ' Gwei' : 'N/A',
            calculation: `${transactionCount.toLocaleString()} transactions: ${totalGasUnitsUsed.toLocaleString()} gas units = ${totalGasFeesHype.toFixed(6)} HYPE fees`,
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