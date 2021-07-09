🚀 🚀 better-simple-arbitrage 🚀 🚀
==================================

This repository is a fork of the Flashbots' example arbitrage bot, located here: https://github.com/flashbots/simple-arbitrage.

I have merely iterated on it to make it a better Proof of Concept, by fixing some issues and adding some optimizations.  It is less naive, but it is still naive.

# Limitations

- The DEX's we look at are Uniswap and forks of Uniswap (Sushiswap, etc).  This is out of convenience, since their smart contracts all have the same interface, and they all work the same (i.e. they are all constant product markets with a swap fee of .3%)
- We only consider token pairs containing WETH.  In general, its convenient to start with WETH and end in WETH, since you pay gas in ETH.
- This bot only looks for single-hop cross-DEX arbitrage
  * i.e. Buy LINK for WETH on Uniswap, sell LINK for WETH on SushiSwap.
- This bot assumes that each DEX is a Constant Product Market with swap fee of .3%
- This bot, in theory, is risk free (since you don't have to pay for failed transactions when submitting bundles to the Flashbots Relay). You cannot apply this same risk-free strategy on other chains or L2s because there are no Flashbot equivalents (that I know of).
  * It is not risk free if your owner wallet's private key is exposed.
- Doing math with Javascript just.....sucks.  We use the BigNumber library here out of necessity, but its difficult to math with if you are dividing one BigNumber by another BigNumber and end up with a very small number.  I've committed some pretty ugly code to this repo attempting to do the necessary calculations to make this strategy work. Sorry.


# The Strategy

1. Fetch reserves for all WETH-TOKEN liquidity pools that have sufficient liquidity, and exist on at least 2 DEX's.
2. For a given token we are considering (lets use LINK), compute the reserves ratio of the WETH/LINK pool on each DEX.
   * reservesRatio = WETHReserves / linkReserves
3. Compare the reserves ratio for each WETH-LINK pair with one another to find the "arbitrage index" for the pair-of-pairs.
   * i.e. if the reserve ratio of WETH/LINK is 2.0 on Uniswap and 2.2 on Sushiswap, the arbitrage index would be: 2.2 / 2.0 = 1.1
4. If we find a pair of WETH/LINK pools where their arbitrage index is greater than 1.003^2, we say these pools are "crossed markets". There COULD BE an arbitrage opportunity in a pair of crossed markets.
5. If we have a pair of crossed markets, calculate the amount of WETH to sell to the first exchange to maximize your return on WETH in the second exchange.
   * This computation can be done quickly and efficiently, and is a fun problem to solve.
   * This paper gets you most of the way there, but you will need to do some extrapolating.
   * I could share the derivation, but I recommend you solve it on your own. Its fun.
6. If the maximized profit is > .001 ETH, build the transaction, simulate the transaction. If simulation suceeds, submit the bundle to Flashbots.
   * Our threshold of .001 ETH is arbitrary, but remember: we need to tip the miner.  And our tip needs to bring our _effective gas price_ high enough for the miner to include it at the head of the block.

# Conclusion

I have not made any money with this bot, and you probably wont either.  The fact is that profits that can be made by a single-hop cross-DEX arbitrage opportunity simply aren't high enough.  It wont help to add flashloans to this implementation, because the profit-maximizing inputs for most of these opportunities are < 2 WETH, and yield theoretical maximum profits of between .001 - .0025 WETH.  In the short time I've run this bot, I've come across plenty of these opportunities and submitted bundles for them -- but even when paying the miner 90% in profits, the effective gas price of these transactions max out around 10-15 GWEI which simply isn't high enough for a miner to include it in their bundle.

I do think that with a little more work, this bot could be marginally profitable.  But it will probably require a more sophisticated strategy than single-hop, cross-DEX, WETH to WETH arbs.

## Ideas for Improvements

I encourage you to build upon this. Here are some good things to try, in order of difficulty

### Add addresses for more "Uniswappy" DEX's

If you are going for the minimal effort play! I don't know how many more of these exist, but they should work right out of the box.  The problem is alot of these DEX's just don't have much liquidity.  Less liquidity in a pool means more slippage, which means smaller potential profits.

### Add support for other Constant Product Market DEX's

### Add support for other types of DEX's

### Submitting multiple arb transactions in the same bundle

### Multi-hop WETH-WETH paths

### Come up with a completely different, specialized strategy




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
2. Deploy the included BundleExecutor.sol to Ethereum, from a secured account, with the address of the newly created wallet as the constructor argument
3. Transfer WETH to the newly deployed BundleExecutor

_It is important to keep both the bot wallet private key and bundleExecutor owner private key secure. The bot wallet attempts to not lose WETH inside an arbitrage, but a malicious user would be able to drain the contract._

```
$ npm install
$ PRIVATE_KEY=__PRIVATE_KEY_FROM_ABOVE__ \
    BUNDLE_EXECUTOR_ADDRESS=__DEPLOYED_ADDRESS_FROM_ABOVE__ \
    FLASHBOTS_RELAY_SIGNING_KEY=__RANDOM_ETHEREUM_PRIVATE_KEY__ \
      npm run start
```

Docker Usage
======================

Create a Dockerfile from Dockerfile.sample with your personal env variables. Dockerfile is .gitignored
Bundle Executor adddress can be any random string if you don't plan on actually submitting bundles.
```
docker-compose up --build
```

