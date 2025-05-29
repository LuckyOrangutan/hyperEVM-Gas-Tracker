const { Web3 } = require('web3');

const HYPEREVM_RPC = 'https://rpc.hyperliquid.xyz/evm';

export default async function handler(req, res) {
    console.log('=== LIFETIME SCAN REQUEST ===');
    console.log('Method:', req.method);
    console.log('Body:', req.body);
    console.log('============================');
    
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
        if (!req.body) {
            return res.status(400).json({ error: 'Request body is required' });
        }
        
        const { address, chunk = 0 } = req.body;
        console.log('Parsed request - Address:', address, 'Chunk:', chunk);
        
        if (!address || !isValidAddress(address)) {
            return res.status(400).json({ error: 'Invalid address provided' });
        }
        
        console.log(`Starting lifetime scan for address: ${address} (chunk ${chunk})`);
        
        const web3 = new Web3(HYPEREVM_RPC);
        
        // Get the latest block number
        const latestBlockBigInt = await web3.eth.getBlockNumber();
        const latestBlock = Number(latestBlockBigInt);
        console.log(`Latest block: ${latestBlock}`);
        
        // Chunked scanning strategy
        const CHUNK_SIZE = 2000; // Process 2000 blocks per chunk
        const startBlock = chunk * CHUNK_SIZE;
        const endBlock = Math.min(startBlock + CHUNK_SIZE - 1, latestBlock);
        
        console.log(`Processing chunk ${chunk}: blocks ${startBlock} to ${endBlock}`);
        
        if (startBlock > latestBlock) {
            // This chunk is beyond the latest block
            return res.json({
                totalGas: '0',
                transactionCount: 0,
                blocksScanned: 0,
                chunkNumber: chunk,
                isComplete: true,
                progress: 100,
                latestBlock: latestBlock
            });
        }
        
        let totalGas = 0;
        let transactionCount = 0;
        
        // Process blocks in smaller batches within the chunk
        const batchSize = 50;
        
        for (let i = startBlock; i <= endBlock; i += batchSize) {
            const batchStart = i;
            const batchEnd = Math.min(i + batchSize - 1, endBlock);
            
            console.log(`Processing batch: blocks ${batchStart} to ${batchEnd}`);
            
            const batchPromises = [];
            for (let blockNum = batchStart; blockNum <= batchEnd; blockNum++) {
                batchPromises.push(processBlockOptimized(web3, blockNum, address));
            }
            
            const batchResults = await Promise.allSettled(batchPromises);
            
            for (const result of batchResults) {
                if (result.status === 'fulfilled') {
                    totalGas += result.value.gas;
                    transactionCount += result.value.count;
                }
            }
            
            // Small delay between batches
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        const blocksScanned = endBlock - startBlock + 1;
        const totalBlocks = latestBlock + 1;
        const progress = Math.min(((chunk + 1) * CHUNK_SIZE) / totalBlocks * 100, 100);
        const isComplete = endBlock >= latestBlock;
        
        console.log(`Chunk ${chunk} complete. Gas: ${totalGas}, Transactions: ${transactionCount}, Progress: ${progress.toFixed(1)}%`);
        
        res.json({
            totalGas: totalGas.toString(),
            transactionCount,
            blocksScanned,
            chunkNumber: chunk,
            isComplete,
            progress: Math.round(progress * 10) / 10, // Round to 1 decimal
            latestBlock: latestBlock,
            nextChunk: isComplete ? null : chunk + 1
        });
        
    } catch (error) {
        console.error('=== ERROR IN LIFETIME SCAN ===');
        console.error('Error:', error);
        console.error('===============================');
        
        let errorMessage = 'Failed to scan lifetime gas usage';
        let statusCode = 500;
        
        if (error.message) {
            errorMessage = error.message;
            
            if (error.message.includes('timeout') || error.message.includes('Timeout')) {
                errorMessage = 'Request timed out. The scan will resume from the next chunk.';
                statusCode = 408;
            } else if (error.message.includes('invalid json') || error.message.includes('Unexpected token')) {
                errorMessage = 'RPC server returned invalid response. Will retry next chunk.';
                statusCode = 502;
            }
        }
        
        return res.status(statusCode).json({ 
            error: errorMessage,
            code: error.code || 'UNKNOWN_ERROR'
        });
    }
}

async function processBlockOptimized(web3, blockNumber, targetAddress) {
    try {
        // Shorter timeout for lifetime scanning
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Block request timeout')), 4000)
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
                try {
                    const receiptPromise = new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Receipt request timeout')), 2000)
                    );
                    
                    const receipt = await Promise.race([
                        web3.eth.getTransactionReceipt(tx.hash),
                        receiptPromise
                    ]);
                    
                    if (receipt && receipt.gasUsed) {
                        const gasUsed = typeof receipt.gasUsed === 'bigint' ? Number(receipt.gasUsed) : receipt.gasUsed;
                        totalGas += gasUsed;
                        count++;
                    }
                } catch (receiptError) {
                    // Skip failed receipts in lifetime scan for speed
                    console.error(`Skipping receipt for tx ${tx.hash}: ${receiptError.message}`);
                }
            }
        }
        
        return { gas: totalGas, count };
    } catch (error) {
        console.error(`Error processing block ${blockNumber}:`, error.message);
        return { gas: 0, count: 0 };
    }
}

function isValidAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}