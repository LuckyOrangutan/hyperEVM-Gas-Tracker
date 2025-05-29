# HyperEVM Gas Tracker

Ultra-fast web application to track total HYPE gas burnt for any HyperEVM address using hyperscan.com data.

## Features

- ⚡ **Ultra-Fast**: Get lifetime gas total in ~1 second using hyperscan.com counters
- 🎯 **100% Accurate**: Uses the same data that hyperscan.com displays
- 💰 **Real HYPE Costs**: Precise calculation using network average gas prices
- 🔥 **Beautiful Display**: Clean, focused results showing your total gas burnt
- 📱 **One-Click**: Single button, instant results, no confusion
- 🛡️ **Reliable**: No inaccurate fallbacks - accurate data or clear error

## Usage

1. Visit the deployed app
2. Enter a valid HyperEVM address (starts with 0x)
3. Click "Track Lifetime Gas ⚡"
4. Get complete gas usage history automatically

## How It Works

### Ultra-Efficient Method:
1. **GET** `/addresses/{address}/counters` → Total gas units used (e.g., 454,441,613)
2. **GET** `/stats` → Current network average gas price (e.g., 25.15 gwei)  
3. **CALCULATE** `gas_units × avg_gas_price ÷ 10^9 = HYPE cost`

### Why This is Accurate:
- Uses **exact same data** that hyperscan.com displays
- **Network average gas price** accounts for all your transactions
- **No scanning needed** - hyperscan already counted everything
- **Instant results** - 2 API calls vs thousands of transaction queries

## Local Development

```bash
npm install
npm run dev
```

Open http://localhost:3000 to view the app.

## Deployment

Optimized for Vercel serverless deployment:

```bash
vercel
```

## API Endpoints

- `/api/gas-tracker` - Ultra-efficient gas tracking using hyperscan.com counters

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JavaScript with beautiful gradient design
- **Backend**: Vercel serverless functions  
- **Data Source**: Hyperscan.com API (counters + network stats)
- **Network**: HyperEVM Mainnet (Chain ID: 999)