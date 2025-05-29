# HyperEVM Gas Tracker

A web application to track total HYPE gas burnt for any HyperEVM address.

## Features

- 🔍 Enter any HyperEVM address to see gas usage
- 📊 View total HYPE gas burnt and transaction count
- 🎨 Clean, responsive UI
- ⚡ Serverless deployment on Vercel

## Usage

1. Visit the deployed app
2. Enter a valid HyperEVM address (starts with 0x)
3. Click "Track Gas" to see results

## Local Development

```bash
npm install
npm run dev
```

Open http://localhost:3000 to view the app.

## Deployment

This app is designed for Vercel deployment:

```bash
vercel
```

## How it Works

The app scans the last 10,000 blocks on the HyperEVM mainnet (Chain ID: 999) to find transactions sent from the specified address, then calculates the total gas used across all those transactions.

## Tech Stack

- Frontend: Vanilla HTML/CSS/JavaScript
- Backend: Vercel serverless functions
- Blockchain: Web3.js connecting to HyperEVM mainnet (rpc.hyperliquid.xyz/evm)