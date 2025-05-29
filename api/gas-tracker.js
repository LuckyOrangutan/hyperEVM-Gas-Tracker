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
        
        console.log(`Starting comprehensive gas tracking for address: ${address}`);
        
        // First try the efficient Blockscout API method
        try {
            console.log('Trying Blockscout API first...');
            const apiResult = await tryBlockscoutAPI(address);
            if (apiResult) {
                console.log('Blockscout API successful');
                return res.json(apiResult);
            }
        } catch (apiError) {
            console.log('Blockscout API failed, falling back to RPC scanning:', apiError.message);
        }
        
        // Fallback to RPC scanning
        console.log('Using RPC fallback method...');
        const web3 = new Web3(HYPEREVM_RPC);
        
        // Get the latest block number
        const latestBlockBigInt = await web3.eth.getBlockNumber();
        const latestBlock = Number(latestBlockBigInt);
        console.log(`Latest block: ${latestBlock}`);
        
        let totalGas = 0;
        let transactionCount = 0;
        
        // Scan recent blocks only for fallback
        const startBlock = Math.max(0, latestBlock - 1000);
        const batchSize = 20;
        const sequentialProcessing = false;
        
        if (sequentialProcessing) {
            console.log(`Starting sequential processing from block ${startBlock} to ${latestBlock}`);
            // Process blocks one by one with delays
            for (let blockNum = startBlock; blockNum <= latestBlock; blockNum++) {
                try {
                    if (blockNum % 100 === 0) {
                        console.log(`Processing block ${blockNum} (${((blockNum - startBlock) / (latestBlock - startBlock) * 100).toFixed(1)}% complete)`);
                    }
                    
                    const result = await processBlockWithRetry(web3, blockNum, address);
                    totalGas += result.gas;
                    transactionCount += result.count;
                    
                    // Add delay between requests to avoid rate limiting
                    if (blockNum % 10 === 0) {
                        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay every 10 blocks
                    }
                } catch (error) {
                    console.error(`Failed to process block ${blockNum} after retries:`, error.message);
                    console.error(`Error details:`, error);
                    // Continue processing other blocks
                }
            }
            console.log(`Completed processing. Total gas: ${totalGas}, Transaction count: ${transactionCount}`);
        } else {
            // Optimized batch processing
            console.log(`Starting batch processing from block ${startBlock} to ${latestBlock}`);
            for (let i = startBlock; i <= latestBlock; i += batchSize) {
                const endBlock = Math.min(i + batchSize - 1, latestBlock);
                console.log(`Processing blocks ${i} to ${endBlock} (${((i - startBlock) / (latestBlock - startBlock) * 100).toFixed(1)}% complete)`);
                
                const batchPromises = [];
                for (let blockNum = i; blockNum <= endBlock; blockNum++) {
                    batchPromises.push(processBlockWithRetry(web3, blockNum, address, 2)); // Fewer retries for speed
                }
                
                const batchResults = await Promise.allSettled(batchPromises);
                
                for (const result of batchResults) {
                    if (result.status === 'fulfilled') {
                        totalGas += result.value.gas;
                        transactionCount += result.value.count;
                    }
                }
                
                // Shorter delay between batches
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
        
        console.log(`Total gas found: ${totalGas}, Transaction count: ${transactionCount}`);
        
        res.json({
            totalGas: totalGas.toFixed(6),
            transactionCount,
            blocksScanned: latestBlock - startBlock + 1,
            scanType: 'fallback',
            method: 'RPC Block Scanning',
            latestBlock: latestBlock,
            note: 'Blockscout API unavailable, used RPC fallback to scan last 1,000 blocks. Gas cost = gas_used × gas_price converted from wei to HYPE.'
        });
        
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

async function processBlockWithRetry(web3, blockNumber, targetAddress, maxRetries = 2) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Shorter timeout for faster processing
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Block request timeout')), 5000)
            );
            
            const block = await Promise.race([
                web3.eth.getBlock(blockNumber, true),
                timeoutPromise
            ]);
            
            if (!block || !block.transactions) {
                return { gas: 0, count: 0 };
            }
            
            let totalGas = 0;
            let count = 0;
            
            for (const tx of block.transactions) {
                if (tx.from && tx.from.toLowerCase() === targetAddress.toLowerCase()) {
                    // Get transaction receipt to get actual gas used
                    try {
                        const receiptPromise = new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Receipt request timeout')), 3000)
                        );
                        
                        const receipt = await Promise.race([
                            web3.eth.getTransactionReceipt(tx.hash),
                            receiptPromise
                        ]);
                        
                        if (receipt && receipt.gasUsed) {
                            // Convert BigInt to Number for gas calculation
                            const gasUsed = typeof receipt.gasUsed === 'bigint' ? Number(receipt.gasUsed) : receipt.gasUsed;
                            
                            // Get gas price from transaction
                            const gasPrice = typeof tx.gasPrice === 'bigint' ? Number(tx.gasPrice) : (tx.gasPrice || 0);
                            
                            // Calculate actual gas cost in wei, then convert to HYPE
                            const gasCostWei = gasUsed * gasPrice;
                            const gasCostHype = gasCostWei / Math.pow(10, 18);
                            
                            totalGas += gasCostHype;
                            count++;
                        }
                    } catch (receiptError) {
                        console.error(`Error getting receipt for tx ${tx.hash}:`, receiptError.message);
                        // Continue processing other transactions
                    }
                }
            }
            
            return { gas: totalGas, count };
            
        } catch (error) {
            console.error(`Error processing block ${blockNumber} (attempt ${attempt}):`, error.message);
            
            // Check if it's a rate limit error (HTML response)
            if (error.message.includes('Unexpected token') && error.message.includes('<html>')) {
                console.log(`Rate limit detected for block ${blockNumber}, retrying in ${attempt * 200}ms...`);
                await new Promise(resolve => setTimeout(resolve, attempt * 200)); // Faster backoff
                continue;
            }
            
            // For other errors, don't retry if it's the last attempt
            if (attempt === maxRetries) {
                return { gas: 0, count: 0 };
            }
            
            // Shorter wait before retry
            await new Promise(resolve => setTimeout(resolve, attempt * 100));
        }
    }
    
    return { gas: 0, count: 0 };
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