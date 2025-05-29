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
        
        // Determine scan range
        let startBlock, batchSize;
        if (fullHistory) {
            startBlock = 0; // Scan from genesis
            batchSize = 50; // Smaller batches for full history
        } else {
            startBlock = Math.max(0, Number(latestBlock) - 10000);
            batchSize = 100;
        }
        
        for (let i = startBlock; i <= latestBlock; i += batchSize) {
            const endBlock = Math.min(i + batchSize - 1, Number(latestBlock));
            console.log(`Processing blocks ${i} to ${endBlock}`);
            
            const batchPromises = [];
            for (let blockNum = i; blockNum <= endBlock; blockNum++) {
                batchPromises.push(processBlock(web3, blockNum, address));
            }
            
            const batchResults = await Promise.allSettled(batchPromises);
            
            for (const result of batchResults) {
                if (result.status === 'fulfilled') {
                    totalGas += result.value.gas;
                    transactionCount += result.value.count;
                }
            }
        }
        
        console.log(`Total gas found: ${totalGas}, Transaction count: ${transactionCount}`);
        
        res.json({
            totalGas: totalGas.toString(),
            transactionCount,
            blocksScanned: Number(latestBlock) - startBlock + 1,
            scanType: fullHistory ? 'full' : 'recent',
            latestBlock: Number(latestBlock)
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

async function processBlock(web3, blockNumber, targetAddress) {
    try {
        // Add timeout to block requests
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Block request timeout')), 10000)
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
                        setTimeout(() => reject(new Error('Receipt request timeout')), 5000)
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
        console.error(`Error processing block ${blockNumber}:`, error.message);
        return { gas: 0, count: 0 };
    }
}

function isValidAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}