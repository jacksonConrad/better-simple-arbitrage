import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import { Contract, providers, Wallet } from "ethers";
import { BUNDLE_EXECUTOR_ABI } from "./abi";
import { UniswappyV2EthPair } from "./UniswappyV2EthPair";
import { FACTORY_ADDRESSES } from "./addresses";
import { Arbitrage, CrossedMarketDetails } from "./Arbitrage";
import { get } from "https"
import { getDefaultRelaySigningKey } from "./utils";
import UniswappyV2PairDAO from "./models/UniswappyV2Pair";

const ETHEREUM_RPC_URL = process.env.ETHEREUM_RPC_URL || "http://127.0.0.1:8545"
const PRIVATE_KEY = process.env.PRIVATE_KEY || ""

// No clue what this address points to.
const BUNDLE_EXECUTOR_ADDRESS = process.env.BUNDLE_EXECUTOR_ADDRESS || "0xc35D77d25d81be78Ad60Ce14FEA7c92D438782E3";

const FLASHBOTS_RELAY_SIGNING_KEY = process.env.FLASHBOTS_RELAY_SIGNING_KEY || getDefaultRelaySigningKey();

const MINER_REWARD_PERCENTAGE = parseInt(process.env.MINER_REWARD_PERCENTAGE || "80")

if (PRIVATE_KEY === "") {
  console.warn("Must provide PRIVATE_KEY environment variable")
  process.exit(1)
}
if (BUNDLE_EXECUTOR_ADDRESS === "") {
  console.warn("Must provide BUNDLE_EXECUTOR_ADDRESS environment variable. Please see README.md")
  process.exit(1)
}

if (FLASHBOTS_RELAY_SIGNING_KEY === "") {
  console.warn("Must provide FLASHBOTS_RELAY_SIGNING_KEY. Please see https://github.com/flashbots/pm/blob/main/guides/searcher-onboarding.md")
  process.exit(1)
}

const HEALTHCHECK_URL = process.env.HEALTHCHECK_URL || ""

const provider = new providers.StaticJsonRpcProvider(ETHEREUM_RPC_URL);

const arbitrageSigningWallet = new Wallet(PRIVATE_KEY);
const flashbotsRelaySigningWallet = new Wallet(FLASHBOTS_RELAY_SIGNING_KEY);

function healthcheck() {
  if (HEALTHCHECK_URL === "") {
    return
  }
  get(HEALTHCHECK_URL).on('error', console.error);
}

async function main() {
  console.log("Searcher Wallet Address: " + await arbitrageSigningWallet.getAddress())
  console.log("Flashbots Relay Signing Wallet Address: " + await flashbotsRelaySigningWallet.getAddress())
  const flashbotsProvider = await FlashbotsBundleProvider.create(provider, flashbotsRelaySigningWallet);
  const arbitrage = new Arbitrage(
    arbitrageSigningWallet,
    flashbotsProvider,
    new Contract(BUNDLE_EXECUTOR_ADDRESS, BUNDLE_EXECUTOR_ABI, provider) )

  /*
   *  UNCOMMENT LINE BELOW on first run to seed database.
   *    This will take a very long time (hours) and if you are using an free Infura node, you will
   *    run out of request before it finishes.
   *  
   *    I recommend using a Moralis SpeedyNode which has no limits and is free.
   */
  
  // const markets = await UniswappyV2EthPair.getUniswapMarketsByToken(provider, FACTORY_ADDRESSES);
  
  // Initialize Our Markets
  const allPairs = await UniswappyV2PairDAO.getAllWETHPairAddresses();
  const markets = await UniswappyV2EthPair.mapReduceUniswapMarketsByToken(provider, allPairs);

  // console.log(markets.allMarketPairs);
  console.log(`Found ${Object.keys(markets.marketsByToken).length} total pairs with sufficient liquidity to Arb.\n\n\n`)

  // Listen for new block
  provider.on('block', async (blockNumber) => {
    console.log(`---------------------------- Block number: ${blockNumber} --------------------------\n\n`)

    // On new block, update reserves of each market pair.
    // TODO: more parallel processing
    await UniswappyV2EthPair.updateReserves(provider, markets.allMarketPairs, blockNumber);
  
    // TODO: re-compute marketsByToken so we don't rule out markets that didnt' have efficient
    // liquidity to be considered when we started the app, but eventually gain sufficient liquidity while
    // app is running.

    // Calculate the best crossed markets
    const bestCrossedMarkets = await arbitrage.evaluateMarkets(markets.marketsByToken);
    if (bestCrossedMarkets.length === 0) {
      console.log("No crossed markets\n")
      return
    }

    // Print all Crossed Markets (optimized for input amount)
    for( const crossedMarket of bestCrossedMarkets) {
      await Arbitrage.printCrossedWETHMarket(crossedMarket);
    }

    // Create and send bundles to FLASHBOTS
    await arbitrage.takeCrossedMarkets(bestCrossedMarkets, blockNumber, MINER_REWARD_PERCENTAGE).then(healthcheck).catch(console.error)

  })
}

main();
