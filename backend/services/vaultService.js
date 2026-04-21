// backend/services/vaultService.js
// Vault accounting + yield simulation
// Real: per-user ledger, compound interest math
// Mocked: RWA allocation percentages, external yield source

const { v4: uuidv4 } = require("uuid");

// ─────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────
const ANNUAL_YIELD_RATE = 0.0485;          // 4.85% APR gross
const PLATFORM_TAKE    = 0.20;             // 20% platform fee
const NET_ANNUAL_RATE  = ANNUAL_YIELD_RATE * (1 - PLATFORM_TAKE); // ~3.88%
const DAILY_RATE       = NET_ANNUAL_RATE / 365;
const SECONDS_RATE     = NET_ANNUAL_RATE / (365 * 24 * 3600);

// RWA allocation (displayed in UI, used in yield calculation)
const VAULT_ALLOCATION = [
  { name: "Morpho ETH pool",        pct: 0.60, apy: 0.0490, type: "On-chain yield" },
  { name: "Morpho BTC pool",        pct: 0.25, apy: 0.0482, type: "On-chain yield" },
  { name: "Reserve buffer",         pct: 0.15, apy: 0.0000, type: "Stability buffer" },
];

// ─────────────────────────────────────────
// IN-MEMORY STORE (replace with DB in prod)
// ─────────────────────────────────────────
// users[userId] = {
//   userId, phone, name, kycTier,
//   walletAddress, walletSeed (encrypted in prod),
//   freeBalance,    // RLUSD available to withdraw
//   lockedBalance,  // RLUSD locked in Susu vault
//   totalDeposited, totalWithdrawn, totalYield,
//   lastYieldCalc,  // timestamp of last yield accrual
//   plan: 'flex'|'locked'|'auto',
//   goal: { name, target, unlockDate },
//   transactions: [],
//   createdAt,
// }
const users = new Map();

// ─────────────────────────────────────────
// USER MANAGEMENT
// ─────────────────────────────────────────
function createUser({ phone, name, walletAddress, walletSeed, plan = "flex" }) {
  const userId = uuidv4();
  const now    = Date.now();
  const user   = {
    userId,
    phone,
    name,
    kycTier:        0,
    walletAddress,
    walletSeed,     // In production: encrypted, stored in HSM
    freeBalance:    0,
    lockedBalance:  0,
    totalDeposited: 0,
    totalWithdrawn: 0,
    totalYield:     0,
    lastYieldCalc:  now,
    plan,
    goal:           { name: "", target: 0, unlockDate: null },
    transactions:   [],
    createdAt:      now,
  };
  users.set(userId, user);
  console.log(`👤 User created: ${name} (${userId})`);
  return user;
}

// Seed demo user so the UI has data immediately
function seedDemoUser(walletAddress, walletSeed, name, phone) {
  const userId = "demo-user-main";
  if (users.has(userId)) return users.get(userId);
  const now = Date.now();
  // Generate a realistic-looking demo wallet address if none provided
  const addr = walletAddress || ("rDemo" + Array.from({length:30},()=>"123456789ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random()*33)]).join(""));
  const user = {
    userId,
    phone:          phone || "+233241234567",
    name:           name || "Demo User",
    kycTier:        0,
    walletAddress:  addr,
    walletSeed:     walletSeed || "demo-seed",
    freeBalance:    400.00,
    lockedBalance:  847.83,
    totalDeposited: 1209.41,
    totalWithdrawn: 50.00,
    totalYield:     38.42,
    lastYieldCalc:  now - (6 * 3600 * 1000), // last calc 6h ago
    plan:           "locked",
    goal:           { name: "School fees", target: 1000, unlockDate: "2026-09-01" },
    transactions: [
      { id: uuidv4(), type: "deposit",  amount: 100.00, ghs: 1147,  note: "Remittance from UK",  time: now - 86400000 * 2, hash: "A3F9C2...7C2B", ledger: 94821041 },
      { id: uuidv4(), type: "yield",    amount: 0.17,   ghs: null,  note: "Daily interest",      time: now - 21600000,     hash: "B8D1...4F0A",   ledger: 94802310 },
      { id: uuidv4(), type: "deposit",  amount: 20.00,  ghs: 230,   note: "MTN MoMo deposit",    time: now - 7200000,      hash: "C4D2...9F1A",   ledger: 94821041 },
      { id: uuidv4(), type: "withdraw", amount: -50.00, ghs: -574,  note: "MoMo withdrawal",     time: now - 86400000 * 5, hash: "D2E4...9A1C",   ledger: 94711882 },
    ],
    createdAt: now - 86400000 * 90,
  };
  users.set(userId, user);
  return user;
}

function getUser(userId) {
  return users.get(userId) || null;
}

function getUserByPhone(phone) {
  for (const user of users.values()) {
    if (user.phone === phone) return user;
  }
  return null;
}

// ─────────────────────────────────────────
// YIELD ENGINE
// ─────────────────────────────────────────

// Accrue yield since last calculation
// Called on every request that reads balance — "lazy yield"
function accrueYield(user) {
  const now      = Date.now();
  const elapsed  = (now - user.lastYieldCalc) / 1000; // seconds
  const principal = user.freeBalance + user.lockedBalance;

  if (principal <= 0 || elapsed < 1) return user;

  const yieldAmount = parseFloat((principal * SECONDS_RATE * elapsed).toFixed(6));

  if (yieldAmount > 0) {
    // Yield goes to whichever balance is larger
    if (user.lockedBalance >= user.freeBalance) {
      user.lockedBalance  = parseFloat((user.lockedBalance + yieldAmount).toFixed(6));
    } else {
      user.freeBalance    = parseFloat((user.freeBalance + yieldAmount).toFixed(6));
    }
    user.totalYield      += yieldAmount;
    user.lastYieldCalc    = now;

    // Log micro yield entries (batch them every 60s to avoid spam)
    if (elapsed > 60) {
      user.transactions.unshift({
        id:     uuidv4(),
        type:   "yield",
        amount: yieldAmount,
        ghs:    null,
        note:   "Interest from Morpho on-chain yield",
        time:   now,
        hash:   genHash(),
        ledger: null,
      });
    }
  }
  return user;
}

// Get a user's full balance summary (triggers yield accrual)
function getBalance(userId) {
  const user = getUser(userId);
  if (!user) return null;
  accrueYield(user);

  const total      = user.freeBalance + user.lockedBalance;
  const dailyYield = parseFloat((total * DAILY_RATE).toFixed(4));
  const monthlyYield = parseFloat((total * DAILY_RATE * 30).toFixed(2));
  const progressPct  = user.goal.target > 0
    ? Math.min(100, (user.lockedBalance / user.goal.target) * 100)
    : 0;

  return {
    userId:          user.userId,
    name:            user.name,
    walletAddress:   user.walletAddress,
    freeBalance:     parseFloat(user.freeBalance.toFixed(4)),
    lockedBalance:   parseFloat(user.lockedBalance.toFixed(4)),
    totalBalance:    parseFloat(total.toFixed(4)),
    totalDeposited:  user.totalDeposited,
    totalWithdrawn:  user.totalWithdrawn,
    totalYield:      parseFloat(user.totalYield.toFixed(4)),
    dailyYield,
    monthlyYield,
    annualRate:      (NET_ANNUAL_RATE * 100).toFixed(2) + "%",
    grossRate:       (ANNUAL_YIELD_RATE * 100).toFixed(2) + "%",
    plan:            user.plan,
    goal:            user.goal,
    progressPct:     parseFloat(progressPct.toFixed(1)),
    kycTier:         user.kycTier,
    allocation:      VAULT_ALLOCATION,
  };
}

// ─────────────────────────────────────────
// VAULT OPERATIONS
// ─────────────────────────────────────────
function deposit(userId, amountRlusd, { txHash, ledgerIndex, ghsAmount, note }) {
  const user = getUser(userId);
  if (!user) throw new Error("User not found");
  accrueYield(user);

  const amount = parseFloat(amountRlusd);
  if (amount <= 0) throw new Error("Amount must be positive");

  // KYC limit check
  const dailyLimit = user.kycTier === 0 ? 87.27 : 872.7; // GHS 1000/day or 10000/day → USD
  if (amount > dailyLimit) {
    throw new Error(`Daily limit: $${dailyLimit.toFixed(2)} at KYC Tier ${user.kycTier}`);
  }

  // Route to free or locked based on plan
  if (user.plan === "locked") {
    user.lockedBalance  += amount;
  } else {
    user.freeBalance    += amount;
  }
  user.totalDeposited   += amount;

  const tx = {
    id:     uuidv4(),
    type:   "deposit",
    amount,
    ghs:    ghsAmount || null,
    note:   note || "MoMo deposit",
    time:   Date.now(),
    hash:   txHash,
    ledger: ledgerIndex,
  };
  user.transactions.unshift(tx);
  console.log(`💰 Deposit: ${userId} +$${amount} RLUSD | TX: ${txHash}`);
  return { ...getBalance(userId), tx };
}

function withdraw(userId, amountRlusd, { txHash, ledgerIndex }) {
  const user = getUser(userId);
  if (!user) throw new Error("User not found");
  accrueYield(user);

  const amount = parseFloat(amountRlusd);
  if (amount <= 0) throw new Error("Amount must be positive");
  if (amount > user.freeBalance) {
    throw new Error(`Insufficient free balance. Available: $${user.freeBalance.toFixed(2)}`);
  }

  user.freeBalance    -= amount;
  user.totalWithdrawn += amount;

  const tx = {
    id:     uuidv4(),
    type:   "withdraw",
    amount: -amount,
    ghs:    null,
    note:   "MoMo withdrawal",
    time:   Date.now(),
    hash:   txHash,
    ledger: ledgerIndex,
  };
  user.transactions.unshift(tx);
  console.log(`📤 Withdraw: ${userId} -$${amount} RLUSD | TX: ${txHash}`);
  return { ...getBalance(userId), tx };
}

function getTransactions(userId, limit = 20) {
  const user = getUser(userId);
  if (!user) return [];
  return user.transactions.slice(0, limit);
}

function setGoal(userId, { name, target, unlockDate, plan }) {
  const user = getUser(userId);
  if (!user) throw new Error("User not found");
  if (plan) user.plan = plan;
  user.goal = { name, target: parseFloat(target), unlockDate };
  return user.goal;
}

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────
function genHash() {
  return Math.random().toString(36).substring(2,6).toUpperCase() +
         Math.random().toString(36).substring(2,6).toUpperCase() +
         "..." +
         Math.random().toString(36).substring(2,6).toUpperCase();
}

module.exports = {
  createUser,
  seedDemoUser,
  getUser,
  getUserByPhone,
  getBalance,
  deposit,
  withdraw,
  getTransactions,
  setGoal,
  accrueYield,
  VAULT_ALLOCATION,
  NET_ANNUAL_RATE,
  DAILY_RATE,
  GHS_RATE: 11.47,
};
