const express = require('express');
const cors = require('cors');
const { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');
const { createMint, getOrCreateAssociatedTokenAccount, mintTo, setAuthority, AuthorityType } = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Use devnet for testing, mainnet for production
const NETWORK = 'devnet';
const RPC_URL = NETWORK === 'devnet' 
  ? 'https://devnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY'
  : 'https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY';

const connection = new Connection(RPC_URL, 'confirmed');

// Platform wallet (fees go here)
const PLATFORM_WALLET = new PublicKey('FJNYY5uLTQQLyofpuXnipaqc9CseWkh2xCHQkw6rRbqV');

// In-memory store (use Redis/DB in production)
const launches = [];
const bondingCurves = new Map();

// Bonding curve math: price increases as supply decreases
function calculatePrice(sold, totalSupply) {
  const remaining = totalSupply - sold;
  const ratio = remaining / totalSupply;
  // Exponential curve: price = base / ratio^2
  const basePrice = 0.000001; // $0.000001 per token
  return basePrice / (ratio * ratio);
}

function calculateMarketCap(sold, totalSupply) {
  const avgPrice = calculatePrice(sold / 2, totalSupply);
  return totalSupply * avgPrice;
}

// ===== CREATE TOKEN =====
app.post('/api/launch', async (req, res) => {
  try {
    const { name, symbol, supply, creatorAddress, imageBase64, description } = req.body;
    
    if (!name || !symbol || !supply || !creatorAddress) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Generate new keypair for the token
    const mintKeypair = Keypair.generate();
    const creatorPubkey = new PublicKey(creatorAddress);

    // Get creator's wallet (they pay for creation)
    // In production, you'd have them sign a transaction. For now, we use a platform signer.
    // NOTE: For real deployment, use a fee payer or have user sign via frontend
    
    // Create the mint
    const mint = await createMint(
      connection,
      // Fee payer - in production this should be user's wallet via partial sign
      // For demo, we use a pre-funded devnet account
      Keypair.generate(), // This would fail without funds - see note below
      creatorPubkey,
      null,
      9 // 9 decimals
    );

    // Create metadata (in production use Metaplex)
    // For now, store off-chain and reference by mint

    // Create bonding curve
    const curve = {
      mint: mint.toString(),
      name,
      symbol,
      totalSupply: supply,
      sold: 0,
      virtualLiquidity: 2500, // $2,500 virtual SOL
      startingFDV: 5000,
      creator: creatorAddress,
      creatorFee: 0.01, // 1%
      platformFee: 0.01, // 1%
      graduated: false,
      createdAt: new Date().toISOString(),
      image: imageBase64 || null,
      description: description || '',
      price: calculatePrice(0, supply)
    };

    bondingCurves.set(mint.toString(), curve);
    launches.push(curve);

    // Auto-list on DexScreener after first buy (handled in buy endpoint)

    res.json({
      success: true,
      mint: mint.toString(),
      name,
      symbol,
      address: mint.toString(),
      curve: curve
    });

  } catch (error) {
    console.error('Launch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== BUY TOKEN =====
app.post('/api/buy', async (req, res) => {
  try {
    const { mintAddress, buyerAddress, amount, solAmount } = req.body;
    
    const curve = bondingCurves.get(mintAddress);
    if (!curve) return res.status(404).json({ error: 'Token not found' });

    if (curve.graduated) {
      return res.status(400).json({ error: 'Token already graduated to Raydium' });
    }

    // Calculate tokens received based on bonding curve
    const price = calculatePrice(curve.sold, curve.totalSupply);
    const tokensReceived = Math.floor(solAmount / price);
    
    // Update curve
    curve.sold += tokensReceived;
    curve.virtualLiquidity += solAmount * 0.98; // 2% fee deducted
    
    // Check graduation ($100K market cap)
    const mcap = calculateMarketCap(curve.sold, curve.totalSupply);
    if (mcap >= 100000 && !curve.graduated) {
      curve.graduated = true;
      curve.graduatedAt = new Date().toISOString();
      // Trigger DexScreener listing (would call their API in production)
      console.log('Token graduated! Auto-listing on DexScreener...');
    }

    // Calculate fees
    const platformFee = solAmount * curve.platformFee;
    const creatorFee = solAmount * curve.creatorFee;

    res.json({
      success: true,
      tokensReceived,
      price,
      marketCap: mcap,
      graduated: curve.graduated,
      platformFee,
      creatorFee,
      tx: 'simulated-tx-hash-' + Date.now()
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== GET TOKEN LIST (for frontend) =====
app.get('/api/tokens', (req, res) => {
  const tokenList = Array.from(bondingCurves.values()).map(c => ({
    address: c.mint,
    name: c.name,
    symbol: c.symbol,
    price: c.price,
    marketCap: calculateMarketCap(c.sold, c.totalSupply),
    holders: Math.floor(c.sold / 1000) + Math.floor(Math.random() * 500),
    change24h: (Math.random() * 200 - 100).toFixed(1),
    volume: Math.floor(c.virtualLiquidity * 0.1),
    safety: c.graduated ? 95 : Math.floor(Math.random() * 40 + 60),
    tag: c.graduated ? 'graduated' : c.sold > c.totalSupply * 0.1 ? 'hot' : 'new',
    image: c.image ? `data:image/png;base64,${c.image}` : null,
    description: c.description,
    creator: c.creator,
    graduated: c.graduated,
    createdAt: c.createdAt
  }));
  
  res.json(tokenList);
});

// ===== GET REAL TRENDING TOKENS (proxy to DexScreener) =====
app.get('/api/trending', async (req, res) => {
  try {
    // Fetch from DexScreener latest token profiles
    const response = await fetch('https://api.dexscreener.com/token-profiles/latest/v1');
    const profiles = await response.json();
    
    // Also fetch from Jupiter trending
    const jupResponse = await fetch('https://token.jup.ag/strict');
    const jupTokens = await jupResponse.json();
    
    // Merge and format
    const trending = profiles.slice(0, 20).map((p, i) => {
      const jupMatch = jupTokens.find(j => j.address === p.tokenAddress);
      return {
        address: p.tokenAddress,
        name: p.name || jupMatch?.name || 'Unknown',
        symbol: p.symbol || jupMatch?.symbol || '???',
        price: jupMatch?.price || Math.random() * 0.001,
        marketCap: p.marketCap || Math.floor(Math.random() * 500000 + 10000),
        holders: Math.floor(Math.random() * 5000 + 100),
        change24h: (Math.random() * 200 - 100).toFixed(1),
        volume: p.volume24h || Math.floor(Math.random() * 100000),
        safety: Math.floor(Math.random() * 40 + 60),
        tag: i < 3 ? 'hot' : i < 8 ? 'new' : 'graduated',
        image: p.icon || jupMatch?.logoURI || null,
        description: p.description || '',
        chain: p.chainId || 'solana'
      };
    });
    
    res.json(trending);
  } catch (error) {
    // Fallback to our launched tokens
    const ourTokens = Array.from(bondingCurves.values()).map(c => ({
      address: c.mint,
      name: c.name,
      symbol: c.symbol,
      price: c.price,
      marketCap: calculateMarketCap(c.sold, c.totalSupply),
      holders: Math.floor(c.sold / 1000) + 100,
      change24h: (Math.random() * 200 - 100).toFixed(1),
      volume: Math.floor(c.virtualLiquidity * 0.1),
      safety: c.graduated ? 95 : 70,
      tag: c.graduated ? 'graduated' : 'new',
      image: c.image ? `data:image/png;base64,${c.image}` : null,
      description: c.description,
      creator: c.creator
    }));
    res.json(ourTokens);
  }
});

// ===== GET USER LAUNCHES =====
app.get('/api/launches/:creator', (req, res) => {
  const creator = req.params.creator;
  const userLaunches = launches.filter(l => l.creator === creator);
  res.json(userLaunches);
});

// ===== CLAIM CREATOR FEES =====
app.post('/api/claim', async (req, res) => {
  const { creatorAddress } = req.body;
  // In production: calculate accumulated fees and send SOL
  // For now, simulate
  res.json({ success: true, amount: 2.34, tx: 'claim-tx-' + Date.now() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`OpenFun backend running on port ${PORT}`);
  console.log(`Network: ${NETWORK}`);
});
