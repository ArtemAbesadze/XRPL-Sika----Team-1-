# Sika — XRPL Savings Gateway
## Demo Prototype

A working demo of an XRPL-based savings product for underbanked users in Ghana.

---

## What is real vs mocked

| Feature | Status | Notes |
|---|---|---|
| XRPL Testnet connection | ✅ REAL | Live WebSocket to `s.altnet.rippletest.net` |
| Wallet creation | ✅ REAL | `xrpl.fundWallet()` via testnet faucet |
| XRP payment transaction | ✅ REAL | Submitted to testnet, ledger-confirmed |
| Transaction hash + explorer link | ✅ REAL | Links to `testnet.xrpl.org` |
| RLUSD token | 🟡 MOCKED | Tracked in server memory; testnet RLUSD issuer unstable |
| MoMo on-ramp | 🟡 MOCKED | GHS→RLUSD conversion is simulated |
| Soil/Doppler/Ondo vault | 🟡 MOCKED | Yield % is simulated using real APR math |
| Yield accrual | ✅ REAL MATH | Compound interest calculated server-side in real time |
| KYC tiers | 🟡 MOCKED | Limit logic is real, ID check is simulated |

---

## Quick Start

### 1. Install dependencies
```bash
cd sika
npm install
```

### 2. Start the server
```bash
npm start
```

Or with auto-reload during development:
```bash
npm run dev
```

### 3. Open the app
```
http://localhost:3000
```

### 4. Demo flow
- Click **"Demo: sign in as Abena"** for instant demo with pre-seeded data
- Or click **"Open an account"** to go through the full onboarding
  - This creates a **real XRPL testnet wallet** (takes ~10 seconds)
  - Then deposits will submit **real testnet transactions**

---

## Project structure

```
sika/
├── package.json
├── README.md
│
├── frontend/
│   └── index.html          ← Full mobile app UI
│
└── backend/
    ├── server.js           ← Express entry point
    │
    ├── routes/
    │   └── api.js          ← REST API endpoints
    │
    ├── services/
    │   └── vaultService.js ← Vault accounting + yield engine
    │
    └── xrpl/
        ├── client.js       ← XRPL SDK wrapper (all chain interactions)
        └── fundTestnet.js  ← Standalone wallet funding script
```

---

## API endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Server health check |
| GET | `/api/xrpl/status` | XRPL connection + latest ledger |
| GET | `/api/demo` | Load pre-seeded demo user |
| POST | `/api/onboard` | Create new user + XRPL wallet |
| POST | `/api/login` | Login by phone number |
| GET | `/api/balance/:userId` | Get balance (triggers yield accrual) |
| POST | `/api/deposit` | Deposit GHS → RLUSD (real XRPL TX) |
| POST | `/api/withdraw` | Withdraw RLUSD → GHS (real XRPL TX) |
| GET | `/api/transactions/:userId` | Transaction history |
| GET | `/api/wallet/:userId` | On-chain wallet info |
| POST | `/api/goal` | Set savings goal |

---

## Demo storytelling script

### Opening (30 sec)
> "This is Sika — a savings product built on the XRP Ledger for people in Ghana who don't have bank accounts but do have a phone and MTN MoMo."

### Onboarding (30 sec)
> "Sign up with just a phone number. No bank account, no ID required for small amounts. Under the hood, we're creating a real XRPL wallet — you can see that happening right now."

Point to: the wallet address appearing, the testnet explorer link.

### Deposit (45 sec)
> "Abena receives remittances from her cousin in London. Instead of paying 8–10% to a wire transfer, she deposits here and pays GHS 0.92 — less than a percent. The money goes from her MoMo wallet to her XRPL vault in about 3 seconds."

Point to: the processing steps animating, the XRPL transaction hash, the explorer link.

> "That transaction is real — click the link and you'll see it on the XRPL Testnet blockchain right now."

### Savings vault (30 sec)
> "Her dollars earn 4.85% per year from tokenized US Treasury bonds — not speculative DeFi yield, not a token with made-up returns. Real US government bonds, accessed through protocols called Soil and Doppler that run on XRPL."

> "The interest compounds daily. Watch the balance — it's ticking up in real time."

### Comparison (20 sec)
> "A cedi bank deposit might offer 18–22%, but the cedi lost 90% of its value against the dollar over the last decade. 4.85% in dollars beats 22% in cedi at 60% inflation. That's the whole pitch."

### Closing
> "This is XRPL Testnet today. In production, this connects to real RLUSD — a dollar stablecoin under a NYDFS Trust Charter, stronger regulatory posture than USDT — and real RWA yield sources. We apply to Ghana SEC Sandbox Cohort 2 next month."

---

## Troubleshooting

**"Could not connect to backend"**
→ Make sure `npm start` is running in the `sika/` folder.

**Onboarding takes a long time**
→ The XRPL testnet faucet can be slow (10–30s). Normal.

**Transaction shows "vault recorded — XRPL TX pending"**
→ The demo user's testnet wallet may not have enough XRP. Run:
```bash
npm run fund-wallet
```
Or use the demo sign-in (pre-seeded) instead of creating a new account.

**XRPL connection fails at startup**
→ The server starts in offline mode automatically. All vault logic still works; only the on-chain TX is skipped.
