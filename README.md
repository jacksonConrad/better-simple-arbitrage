🚀 🚀 better-simple-arbitrage 🚀 🚀
==================================

This repository is a fork of the Flashbots' example arbitrage bot, located here: https://github.com/flashbots/simple-arbitrage.

I have just pushed the original idea farther along by fixing some issues, adding some optimizations, and providing what few morsels of alpha I have in this README. You will get more out of this if you have already read through, and understand the original `simple-arbitrage` repo on a high level.  Checkout [this video](https://www.youtube.com/watch?v=QgAi2j43Bwc)

**For Setup instructions, scroll down to the `simple-arbitrage` section.**

# Updates & Optimizations

- Build & run project w/ docker-compose
- Adds ability to seed a MongoDB database with metadata for each ERC-20 token and each "Uniswappy" pool.  This significantly increases startup time after initial seeding, as the bot will just pull all token pairs from the database.
- Parallelizes network requests & expensive computations as much as possible by passing an array of promises to Promise.all(), rather than looping through them syncronously.  Decreases the time to fetch all pairs + tokens and seed the database.  Greatly decreases the time it takes to fetch all the reserves and evaluate arbitrage opportunities.
- The original project was not taking into account the number of decimal places to apply to the reserves of a given ERC-20 token.  While many ERC-20 tokens use 18 decimal places, not all do. Notably, USDC & USDT use 6.  Token metadata is stored in mongo, so we can quickly normalize the reserves for each ERC-20 token.
- When evaluating whether two markets are crossed, this bot no longer naively loops through and array of test inputs to see what the outcome will be.  Now, it uses the pair reserves to directly compute the input amount of WETH that results in maximum profits.

## Data Collection

You can use this bot to save a snapshot of pair reserves at each block into mongo.  While this isn't recommended if you using the bot to execute arbs (it will delay the evaluation phase a bit), it is useful to analyze historical data to find new & profitable arb strategies.

To enable this, uncomment the following lines in `UniswappyV2EthPair.ts`:
```
let pairsAtBlock: CreatePairAtBlockDTO[] = [];
...
pairsAtBlock.push({
  marketAddress: pairAddresses[i],
  blockNumber,
  reserves0: reserve[0].toString(),
  reserves1: reserve[1].toString()
})
...
await PairAtBlock.batchAddPairsAtBlocks(pairsAtBlock);

```
Of course, you could also use an Archive Node to fetch & analyze a more complete history of data across more exchanges.

# Limitations

- The DEX's we look at are Uniswap and forks of Uniswap (Sushiswap, etc).  This is out of convenience, since their smart contracts all have the same interface, and they all work the same (i.e. they are all constant product markets with a swap fee of 0.3%)
- We only consider token pairs containing WETH.  In general, its convenient to start with WETH and end in WETH, since you pay gas in ETH.
- This bot only looks for two-hop cross-DEX arbitrage
  * i.e. Buy LINK for WETH on Uniswap, sell LINK for WETH on SushiSwap.
- This bot, in theory, is risk free (since you don't have to pay for failed transactions when submitting bundles to the Flashbots Relay). You cannot apply this same risk-free strategy on other chains or L2s because there are no Flashbot equivalents (that I know of).
  * It is not risk free if your owner wallet's private key is exposed.
- Doing math with Javascript just.....sucks.  We use the BigNumber library here out of necessity, but its difficult to _math_ with if you are dividing one BigNumber by another BigNumber and end up with a very small number.  I've written some pretty ugly code in this repo attempting to do the necessary calculations to make this strategy work. Sorry.


# Strategy

1. Fetch reserves for all WETH-TOKEN liquidity pools that have sufficient liquidity, and exist on at least 2 DEX's.
2. For a given token we are considering (lets use LINK), compute the reserves ratio of the WETH/LINK pool on each DEX.
   * reservesRatio = WETHReserves / linkReserves
3. Compare the reserves ratio for each WETH-LINK pair with one another to find the "arbitrage index" for the pair-of-pairs.
   * i.e. if the reserve ratio of WETH/LINK is 2.0 on Uniswap and 2.2 on Sushiswap, the arbitrage index would be: 2.2 / 2.0 = 1.1
4. If we find a pair of WETH/LINK pools where their arbitrage index is greater than 1.003^2, we say these pools are "crossed markets". There COULD BE an arbitrage opportunity in a pair of crossed markets.
5. If we have a pair of crossed markets, calculate the amount of WETH to sell to the first exchange to maximize your return on WETH in the second exchange.
   * This computation can be done quickly and efficiently, and is a fun problem to solve.
   * [This paper](https://arxiv.org/pdf/1911.03380.pdf) gets you most of the way there, but you will need to do some extrapolating.
   * I could share the derivation, but I recommend you solve it on your own. Its fun.
6. If the maximized profit is > .001 ETH, build the transaction, simulate the transaction. If simulation suceeds, submit the bundle to Flashbots.
   * Our threshold of .001 ETH is arbitrary, but remember: we need to tip the miner.  And our tip needs to bring our _effective gas price_ high enough for the miner to include it at the head of the block.

# Conclusion

I have not made any money with this bot, and you probably wont either.  These two-hop cross-DEX arbitrage opportunities just don't yield much profit, and are competitive.  It wont help to add flashloans to this implementation (but would be a fun exercise) because the profit-maximizing inputs for most of these opportunities are < 2 WETH, and yield theoretical maximum profits of between .001 - .0025 WETH.  In the short time I've run this bot, I've come across plenty of these opportunities and submitted bundles for them -- but even when paying the miner 90% in profits, the effective gas price of these transactions max out around 10-15 GWEI, which hasn't been high enough for a miner to include it in their bundle.

I do think that with a little more work this bot could be marginally profitable.  But it will probably require a more sophisticated strategy than two-hop, cross-DEX, WETH to WETH arbs.

## Ideas for Improvements

### Add addresses for more "Uniswappy" DEX's

If you are going for the minimal effort play! I don't know how many more of these DEXs exist, but they should work right out of the box.  The problem is alot of these DEX's just don't have much liquidity.  Less liquidity in a pool means more slippage, which means smaller potential profits.

### Look for arb opportunities across 3 or more pools

If you do this, you'll have to injest more than just WETH-TOKEN pairs.  You will also need to update the calculation of the arb index for these longer paths, and figure out how to compute the input amount that maximizes profit.  It is a convex optimization problem, which should come in handy.  [This paper may help.](https://arxiv.org/pdf/2105.02784.pdf)

### Add support for other DEX's

There are plenty of other DEX's out there, but they will require different treatment than these Uniswap forks.  One idea is to deploy your own smart contract, like the UniswapFlashQuery.sol contract, that will let you query the exchange rate for multiple pairs across multiple exchanges with a single smart contract call.

If a DEX doesn't follow the constant-product formula, consider using two test input amounts to get a linear approximation of the bonding curve.

### Submitting multiple arb transactions in the same bundle

Maybe a tiny-arb that produces .001 ETH in profit wont make your effective gas price high enough for a miner to include it, but if you could detect multiple tiny-arb opportunities in the same block, you could chain them together in a single transaction to make your bundle more profitable.  I'm not sure if this would actually be more gas efficient or not, since the computational resources used should just scale linearly with the number of swaps.  Would be an interesting experiment. Maybe the [Yellow Paper](https://ethereum.github.io/yellowpaper/paper.pdf) holds the answer!!! Or someone on twitter might know. Or the flashbots discord.

### Come up with a completely different, specialized strategy

We've seen that these two-hop arbs don't yield much. Why not go for three or four hops?  Well, the problem is that the number of possible combinations of paths grows exponentially the more hops you allow for, which will drive your search time up quickly.  If you are a math whiz, maybe you can find an efficient algorithm to do these computations fast enough to be competitive.

But another strategy is to narrow your search to a small subset of opportunities. Collect & analyze data, do your brute-force analysis on historical (but recent) sets of data to tease out patterns that aren't so obvious, and optimize for those opportunities.  You don't need to win 'em all.

### Don't use Javascript

As I said earlier, doing this math with Javascript is not a great time. Perhaps you could offload the more complicated calculations to a service or script in a language that is better equipped.


**** BELOW IS THE ORIGINAL README FROM THE FLASHBOTS SIMPLE-ARBITRAGE REPO WITH MINOR UPDATES ****

simple-arbitrage
================
This repository contains a simple, mechanical system for discovering, evaluating, rating, and submitting arbitrage opportunities to the Flashbots bundle endpoint. This script is very unlikely to be profitable, as many users have access to it, and it is targeting well-known Ethereum opportunities.

We hope you will use this repository as an example of how to integrate Flashbots into your own Flashbot searcher (bot). For more information, see the [Flashbots Searcher FAQ](https://docs.flashbots.net/flashbots-auction/searchers/faq)

Environment Variables
=====================
- **ETHEREUM_RPC_URL** - Ethereum RPC endpoint. Can use Infura or Moralis SpeedyNode.  I prefer Moralis for development because its free and there are no request limits.
- **PRIVATE_KEY** - Private key for the Ethereum EOA that will be submitting Flashbots Ethereum transactions.  I recommend setting up a MetaMask account and using that private key.
- **FLASHBOTS_RELAY_SIGNING_KEY** _[Optional, default: random]_ - Flashbots submissions require an Ethereum private key to sign transaction payloads. This newly-created account does not need to hold any funds or correlate to any on-chain activity, it just needs to be used across multiple Flashbots RPC requests to identify requests related to same searcher. Please see https://docs.flashbots.net/flashbots-auction/searchers/faq#do-i-need-authentication-to-access-the-flashbots-relay
- **HEALTHCHECK_URL** _[Optional]_ - Health check URL, hit only after successfully submitting a bundle.
- **MINER_REWARD_PERCENTAGE** _[Optional, default 80]_ - 0 -> 100, what percentage of overall profitability to send to miner.

Usage
======================
1. Generate a new bot wallet address (i.e. MetaMask) and extract the private key into a raw 32-byte format.
2. Create a Dockerfile from Dockerfile.sample with your personal env variables. Dockerfile is .gitignored
3. Deploy the included BundleExecutor.sol to Ethereum, from a secured account, with the address of the newly created wallet as the constructor argument
4. Transfer WETH to the newly deployed BundleExecutor

_It is important to keep both the bot wallet private key and bundleExecutor owner private key secure. The bot wallet attempts to not lose WETH inside an arbitrage, but a malicious user would be able to drain the contract._

_Steps 2 & 3 are only necessary if you want to actually submit bundles.  If you just want to run the bot and see the results, just provide any random ethereum address as the bundle executor address, and comment out the line `await arbitrage.takeCrossedMarkets(...)` in `index.ts`._

```
$ npm install
$ docker-compose up --build
```

