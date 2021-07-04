import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import { Contract, providers, Wallet } from "ethers";
import { BUNDLE_EXECUTOR_ABI } from "./abi";
import { UniswappyV2EthPair } from "./UniswappyV2EthPair";
import { FACTORY_ADDRESSES } from "./addresses";
import { Arbitrage, CrossedMarketDetails } from "./Arbitrage";
import { get } from "https"
import { getDefaultRelaySigningKey } from "./utils";
import UniswappyV2PairDAO from "./models/UniswappyV2Pair";

const ETHEREUM_RPC_URL = process.env.ETHEREUM_GOERLI_RPC_URL || "http://127.0.0.1:8545"
const PRIVATE_KEY_GOERLI = process.env.PRIVATE_KEY_GOERLI || ""

// No clue what this address points to.
const BUNDLE_EXECUTOR_ADDRESS = process.env.BUNDLE_EXECUTOR_ADDRESS_GOERLI || "0xc35D77d25d81be78Ad60Ce14FEA7c92D438782E3";

const FLASHBOTS_RELAY_SIGNING_KEY = process.env.FLASHBOTS_RELAY_SIGNING_KEY || getDefaultRelaySigningKey();

const MINER_REWARD_PERCENTAGE = parseInt(process.env.MINER_REWARD_PERCENTAGE || "20")

if (PRIVATE_KEY_GOERLI === "") {
  console.warn("Must provide PRIVATE_KEY_GOERLI environment variable")
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

const arbitrageSigningWallet = new Wallet(PRIVATE_KEY_GOERLI);
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
  const flashbotsProvider = await FlashbotsBundleProvider.create(
    provider,
    flashbotsRelaySigningWallet,
    "https://relay-goerli.flashbots.net",
    "goerli"
  );
  const arbitrage = new Arbitrage(
    arbitrageSigningWallet,
    flashbotsProvider,
    provider,
    new Contract(BUNDLE_EXECUTOR_ADDRESS, BUNDLE_EXECUTOR_ABI, provider) )

  /*
   *  UNCOMMENT LINE BELOW on first run to seed database.
   *    This will take a very long time (hours) and if you are using an free Infura node, you will
   *    run out of request before it finishes.
   *  
   *    I recommend using a Moralis SpeedyNode which has no limits and is free.
   */

  // await UniswappyV2EthPair.getUniswapMarketsByToken(provider, FACTORY_ADDRESSES);
  
  // Initialize Our Markets
  const allPairs = await UniswappyV2PairDAO.getAllWETHPairAddresses();
  const markets = await UniswappyV2EthPair.mapReduceUniswapMarketsByToken(provider, allPairs);

  // console.log(markets.allMarketPairs);
  console.log(`Found ${Object.keys(markets.marketsByToken).length} token across ${markets.filteredMarketPairs.length} pools with sufficient liquidity to Arb.\n\n\n`)

  // Listen for new block
  provider.on('block', async (blockNumber) => {
    const now = new Date();
    console.log(`---------------------------- Block number: ${blockNumber}, ${now.getTime()} --------------------------\n\n`)

    // On new block, update reserves of each market pair.
    // TODO: more parallel processing
    await UniswappyV2EthPair.updateReserves(provider, markets.filteredMarketPairs, blockNumber);
    console.log(`Block number: ${blockNumber}, Reserves updated: ${((new Date()).getTime() - now.getTime())/1000}`)
  
    // TODO: re-compute marketsByToken so we don't rule out markets that didnt' have efficient
    // liquidity to be considered when we started the app, but eventually gain sufficient liquidity while
    // app is running.

    // Calculate the best crossed markets
    const bestCrossedMarkets = await arbitrage.evaluateMarkets(markets.marketsByToken);
    if (bestCrossedMarkets.length === 0) {
      console.log("No crossed markets\n")
      return
    }
    console.log(`Block number: ${blockNumber}, Markets Evaluated ${((new Date()).getTime() - now.getTime())/1000}`)

    // Print all Crossed Markets (optimized for input amount)
    for( const crossedMarket of bestCrossedMarkets) {
      await Arbitrage.printCrossedWETHMarket(crossedMarket);
    }

    // Create and send bundles to FLASHBOTS
    return await arbitrage.takeCrossedMarkets(bestCrossedMarkets, blockNumber, MINER_REWARD_PERCENTAGE).then(() => {
      healthcheck();
      console.log(`Block number: ${blockNumber}, Took crossed markets: ${((new Date()).getTime() - now.getTime())/1000}`)
      return;
    }).catch(console.error)
  })
}

main();
