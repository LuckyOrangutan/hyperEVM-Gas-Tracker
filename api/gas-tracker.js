const { Web3 } = require('web3');

const HYPEREVM_RPC = 'https://rpc.hyperliquid.xyz/evm';

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { address, fullHistory = false } = req.body;
        
        if (!address || !isValidAddress(address)) {
            return res.status(400).json({ error: 'Invalid address provided' });
        }
        
        console.log(`Tracking gas for address: ${address}`);
        
        const web3 = new Web3(HYPEREVM_RPC);
        
        // Get the latest block number
        const latestBlock = await web3.eth.getBlockNumber();
        console.log(`Latest block: ${latestBlock}`);
        
        let totalGas = 0;
        let transactionCount = 0;
        
        // Determine scan range - disable full history due to rate limiting
        let startBlock, batchSize, sequentialProcessing;
        if (fullHistory) {
            // Full history scanning disabled due to RPC rate limits
            return res.status(400).json({ 
                error: 'Full history scanning is temporarily disabled due to RPC rate limits. Use recent blocks instead.' 
            });
        } else {
            startBlock = Math.max(0, Number(latestBlock) - 5000); // Reduced to 5K blocks
            batchSize = 10; // Much smaller batches
            sequentialProcessing = true; // Process sequentially to avoid rate limits
        }
        
        if (sequentialProcessing) {
            // Process blocks one by one with delays
            for (let blockNum = startBlock; blockNum <= latestBlock; blockNum++) {
                try {
                    const result = await processBlockWithRetry(web3, blockNum, address);
                    totalGas += result.gas;
                    transactionCount += result.count;
                    
                    // Add delay between requests to avoid rate limiting
                    if (blockNum % 10 === 0) {
                        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay every 10 blocks
                    }
                } catch (error) {
                    console.error(`Failed to process block ${blockNum} after retries:`, error.message);
                    // Continue processing other blocks
                }
            }
        } else {
            // Legacy batch processing (kept for fallback)
            for (let i = startBlock; i <= latestBlock; i += batchSize) {
                const endBlock = Math.min(i + batchSize - 1, Number(latestBlock));
                console.log(`Processing blocks ${i} to ${endBlock}`);
                
                const batchPromises = [];
                for (let blockNum = i; blockNum <= endBlock; blockNum++) {
                    batchPromises.push(processBlockWithRetry(web3, blockNum, address));
                }
                
                const batchResults = await Promise.allSettled(batchPromises);
                
                for (const result of batchResults) {
                    if (result.status === 'fulfilled') {
                        totalGas += result.value.gas;
                        transactionCount += result.value.count;
                    }
                }
                
                // Add delay between batches
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
        
        console.log(`Total gas found: ${totalGas}, Transaction count: ${transactionCount}`);
        
        res.json({
            totalGas: totalGas.toString(),
            transactionCount,
            blocksScanned: Number(latestBlock) - startBlock + 1,
            scanType: 'recent',
            latestBlock: Number(latestBlock),
            note: 'Scanned last 5,000 blocks to avoid rate limits'
        });
        
    } catch (error) {
        console.error('Error tracking gas:', error);
        
        // Better error handling for different error types
        let errorMessage = 'Failed to track gas usage';
        if (error.message) {
            errorMessage = error.message;
        }
        if (error.code === 'NETWORK_ERROR') {
            errorMessage = 'Network connection failed. Please try again.';
        }
        if (error.code === 'TIMEOUT') {
            errorMessage = 'Request timed out. Try scanning recent blocks instead of full history.';
        }
        
        return res.status(500).json({ 
            error: errorMessage,
            code: error.code || 'UNKNOWN_ERROR'
        });
    }
}

async function processBlockWithRetry(web3, blockNumber, targetAddress, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Add timeout to block requests
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Block request timeout')), 8000)
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
                            setTimeout(() => reject(new Error('Receipt request timeout')), 4000)
                        );
                        
                        const receipt = await Promise.race([
                            web3.eth.getTransactionReceipt(tx.hash),
                            receiptPromise
                        ]);
                        
                        if (receipt && receipt.gasUsed) {
                            totalGas += Number(receipt.gasUsed);
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
                console.log(`Rate limit detected for block ${blockNumber}, retrying in ${attempt * 500}ms...`);
                await new Promise(resolve => setTimeout(resolve, attempt * 500)); // Exponential backoff
                continue;
            }
            
            // For other errors, don't retry if it's the last attempt
            if (attempt === maxRetries) {
                return { gas: 0, count: 0 };
            }
            
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, attempt * 200));
        }
    }
    
    return { gas: 0, count: 0 };
}

function isValidAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}