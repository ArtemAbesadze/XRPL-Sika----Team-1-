// backend/xrpl/fundTestnet.js
// Run this standalone to create and fund a testnet wallet
// Usage: node backend/xrpl/fundTestnet.js

const xrpl = require("../../node_modules/xrpl");

async function main() {
  console.log("🔧 Connecting to XRPL Testnet...");
  const client = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
  await client.connect();

  console.log("💰 Requesting testnet XRP from faucet...");
  const { wallet, balance } = await client.fundWallet();

  console.log("");
  console.log("✅ Wallet created and funded!");
  console.log("   Address:", wallet.address);
  console.log("   Seed:   ", wallet.seed);
  console.log("   Balance:", balance, "XRP (testnet)");
  console.log("");
  console.log("🔗 View on explorer:");
  console.log("   https://testnet.xrpl.org/accounts/" + wallet.address);
  console.log("");

  await client.disconnect();
}

main().catch(console.error);
