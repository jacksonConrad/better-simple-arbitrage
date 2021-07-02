import * as _ from "lodash";
import { BigNumber, Contract, Wallet } from "ethers";
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import { WETH_ADDRESS } from "./addresses";
import { EthMarket } from "./EthMarket";
import { ETHER, bigNumberToDecimal } from "./utils";

export interface CrossedMarketDetails {
  profit: number,
  volume: number,
  tokenAddress: string,
  buyFromMarket: EthMarket,
  sellToMarket: EthMarket,
}

export type MarketsByToken = { [tokenAddress: string]: Array<EthMarket> }

// TODO: implement binary search (assuming linear/exponential global maximum profitability)
const TEST_VOLUMES = [
  // ETHER.div(100),
  // ETHER.div(10),
  // ETHER.div(6),
  // ETHER.div(4),
  ETHER.div(2),
  ETHER.div(1),
  ETHER.mul(2),
  ETHER.mul(5),
  ETHER.mul(10),
  ETHER.mul(100),
  ETHER.mul(138)
]

// For each Crossed Market pair...
// 1. Compute the optimal input amount
// 2. Compute the optimal profit
// 3. Compute direction of trade
export function getBestCrossedMarket(crossedMarkets: Array<EthMarket>[], tokenAddress: string): CrossedMarketDetails | undefined {
  let bestCrossedMarket: CrossedMarketDetails | undefined = undefined;
  
  for (const crossedMarket of crossedMarkets) {

    try {
      const buyWETHMarket = crossedMarket[0]
      const sellWETHMarket = crossedMarket[1]
      const buyWETHReserves = bigNumberToDecimal(buyWETHMarket.getBalance(WETH_ADDRESS))
      const buyTokenReserves = bigNumberToDecimal(buyWETHMarket.getBalance(tokenAddress))
      const sellWETHReserves = bigNumberToDecimal(sellWETHMarket.getBalance(WETH_ADDRESS));
      const sellTokenReserves = bigNumberToDecimal(sellWETHMarket.getBalance(tokenAddress));
      const kBuy = buyWETHReserves * buyTokenReserves;
      const kSell = sellWETHReserves * sellTokenReserves;
      const gamma = 0.997;

      // Calculate optimal input, output & profits

      const numeratorA = (kSell ** .5) * buyTokenReserves;
      const numeratorB = (gamma ** -1) * ((kBuy ** .5) * sellTokenReserves)
      const denominator = (kBuy ** .5) + (kSell ** .5)

      const _deltaAlpha = (numeratorA - numeratorB) / denominator;

      const betaDenominator = buyTokenReserves - _deltaAlpha;
      const _deltaBeta = (gamma ** -1) * ((kBuy / betaDenominator) - buyWETHReserves)
      const betaPrimeDenominator = sellTokenReserves + (gamma * _deltaAlpha)
      const _deltaBetaPrime = sellWETHReserves - (kSell / betaPrimeDenominator);

      const profit = _deltaBetaPrime - _deltaBeta;

      // Set as bestCrossedMarket if this is the first market for this token
      // OR
      // if this crossed market is more profitable than a previous one
      if (bestCrossedMarket === undefined || profit > bestCrossedMarket.profit) {
        bestCrossedMarket = {
          volume: _deltaBeta,
          profit: profit,
          tokenAddress,
          buyFromMarket: buyWETHMarket,
          sellToMarket: sellWETHMarket
        }
      }
    } catch (e) {
      console.log('Error computing best markets for token: ' + tokenAddress);
    }
  }
  return bestCrossedMarket;
}

// For each Crossed Market pair...
// 1. Compute the direction of the trade
// 2. Compute the input value which optimizes profit
// export function getBestCrossedMarket(crossedMarkets: Array<EthMarket>[], tokenAddress: string): CrossedMarketDetails | undefined {
//   let bestCrossedMarket: CrossedMarketDetails | undefined = undefined;
//   for (const crossedMarket of crossedMarkets) {
//     const sellToMarket = crossedMarket[0]
//     const buyFromMarket = crossedMarket[1]

//     // TODO: Simply calculate optimal amount based on reserves & fees of each market.
//     for (const size of TEST_VOLUMES) {
//       const tokensOutFromBuyingSize = buyFromMarket.getTokensOut(WETH_ADDRESS, tokenAddress, size);
//       const proceedsFromSellingTokens = sellToMarket.getTokensOut(tokenAddress, WETH_ADDRESS, tokensOutFromBuyingSize)
//       const profit = proceedsFromSellingTokens.sub(size);
//       if (bestCrossedMarket !== undefined && profit.lt(bestCrossedMarket.profit)) {
//         // If the next size up lost value, meet halfway. TODO: replace with real binary search
//         const trySize = size.add(bestCrossedMarket.volume).div(2)
//         const tryTokensOutFromBuyingSize = buyFromMarket.getTokensOut(WETH_ADDRESS, tokenAddress, trySize);
//         const tryProceedsFromSellingTokens = sellToMarket.getTokensOut(tokenAddress, WETH_ADDRESS, tryTokensOutFromBuyingSize)
//         const tryProfit = tryProceedsFromSellingTokens.sub(trySize);
//         if (tryProfit.gt(bestCrossedMarket.profit)) {
//           bestCrossedMarket = {
//             volume: trySize,
//             profit: tryProfit,
//             tokenAddress,
//             sellToMarket,
//             buyFromMarket
//           }
//         }
//         break;
//       }
//       bestCrossedMarket = {
//         volume: size,
//         profit: profit,
//         tokenAddress,
//         sellToMarket,
//         buyFromMarket
//       }
//     }
//   }
//   return bestCrossedMarket;
// }

export class Arbitrage {
  private flashbotsProvider: FlashbotsBundleProvider;
  private bundleExecutorContract: Contract;
  private executorWallet: Wallet;

  constructor(executorWallet: Wallet, flashbotsProvider: FlashbotsBundleProvider, bundleExecutorContract: Contract) {
    this.executorWallet = executorWallet;
    this.flashbotsProvider = flashbotsProvider;
    this.bundleExecutorContract = bundleExecutorContract;
  }

  static printCrossedMarket(crossedMarket: CrossedMarketDetails): void {
    const buyTokens = crossedMarket.buyFromMarket.tokens
    const sellTokens = crossedMarket.sellToMarket.tokens
    console.log(
      `Profit: ${crossedMarket.profit} Volume: ${crossedMarket.volume}\n` +
      `${crossedMarket.buyFromMarket.protocol} (${crossedMarket.buyFromMarket.marketAddress})\n` +
      `  ${buyTokens[0]} => ${buyTokens[1]}\n` +
      `${crossedMarket.sellToMarket.protocol} (${crossedMarket.sellToMarket.marketAddress})\n` +
      `  ${sellTokens[0]} => ${sellTokens[1]}\n` +
      `\n`
    )
  }


  async evaluateMarkets(marketsByToken: MarketsByToken): Promise<Array<CrossedMarketDetails>> {
    const bestCrossedMarkets = new Array<CrossedMarketDetails>()

    for (const tokenAddress in marketsByToken) {
      const markets = marketsByToken[tokenAddress]
      const pricedMarkets = _.map(markets, (ethMarket: EthMarket) => {

        // Get reserve ratio in terms of WETH to determine arb indexes
        let reserveRatioInWETH: number = ethMarket.getReservesRatioInWETH();
        
        return {
          ethMarket: ethMarket,
          reserveRatioInWETH
        }
      });


      
      // Compute the optimal input amount.
      const crossedMarkets = new Array<Array<EthMarket>>()
      for (const pricedMarket of pricedMarkets) {
        _.forEach(pricedMarkets, pm => {

          // TODO: Use something like FixedNumber to get better decimal precision;
          const arbIndex = pricedMarket.reserveRatioInWETH / pm.reserveRatioInWETH;

          // If arb index > 1.003, there may be an arb opportunity.
          if (arbIndex > 1.003) {
            console.log('Arb Index:' + arbIndex.toFixed(4));
            //                 [ marketToBuyEthFrom,     marketToSellEthTo ]
            crossedMarkets.push([pricedMarket.ethMarket, pm.ethMarket])
          }
        })
      }

      const bestCrossedMarket = getBestCrossedMarket(crossedMarkets, tokenAddress);
      if (bestCrossedMarket !== undefined && bestCrossedMarket.profit > .001)  {
        bestCrossedMarkets.push(bestCrossedMarket)
      }
    }
    bestCrossedMarkets.sort((a, b) => a.profit < b.profit ? 1 : a.profit > b.profit ? -1 : 0)
    return bestCrossedMarkets
  }

  // TODO: take more than 1
  async takeCrossedMarkets(bestCrossedMarkets: CrossedMarketDetails[], blockNumber: number, minerRewardPercentage: number): Promise<void> {
    for (const bestCrossedMarket of bestCrossedMarkets) {

      // console.log("Send this much WETH", bigNumberToDecimal(bestCrossedMarket.volume), "get this much profit", bigNumberToDecimal(bestCrossedMarket.profit))
      // For now, don't submit bundle
      continue;
      /* 
      const buyCalls = await bestCrossedMarket.buyFromMarket.sellTokensToNextMarket(WETH_ADDRESS, bestCrossedMarket.volume, bestCrossedMarket.sellToMarket);
      const inter = bestCrossedMarket.buyFromMarket.getTokensOut(WETH_ADDRESS, bestCrossedMarket.tokenAddress, bestCrossedMarket.volume)
      const sellCallData = await bestCrossedMarket.sellToMarket.sellTokens(bestCrossedMarket.tokenAddress, inter, this.bundleExecutorContract.address);

      const targets: Array<string> = [...buyCalls.targets, bestCrossedMarket.sellToMarket.marketAddress]
      const payloads: Array<string> = [...buyCalls.data, sellCallData]
      console.log({targets, payloads})
      const minerReward = bestCrossedMarket.profit.mul(minerRewardPercentage).div(100);
      const transaction = await this.bundleExecutorContract.populateTransaction.uniswapWeth(bestCrossedMarket.volume, minerReward, targets, payloads, {
        gasPrice: BigNumber.from(0),
        gasLimit: BigNumber.from(1000000),
      });



      try {
        const estimateGas = await this.bundleExecutorContract.provider.estimateGas(
          {
            ...transaction,
            from: this.executorWallet.address
          })
        if (estimateGas.gt(1400000)) {
          console.log("EstimateGas succeeded, but suspiciously large: " + estimateGas.toString())
          continue
        }
        transaction.gasLimit = estimateGas.mul(2)
      } catch (e) {
        console.warn(`Estimate gas failure for ${JSON.stringify(bestCrossedMarket)}`)
        console.error(e);
        console.log('DONE; \n');
        continue
      }

      const bundledTransactions = [
        {
          signer: this.executorWallet,
          transaction: transaction
        }
      ];
      console.log(bundledTransactions)
      const signedBundle = await this.flashbotsProvider.signBundle(bundledTransactions)
      //
      const simulation = await this.flashbotsProvider.simulate(signedBundle, blockNumber + 1 )
      if ("error" in simulation || simulation.firstRevert !== undefined) {
        console.log(`Simulation Error on token ${bestCrossedMarket.tokenAddress}, skipping`)
        continue
      }
      console.log(`Submitting bundle, profit sent to miner: ${bigNumberToDecimal(simulation.coinbaseDiff)}, effective gas price: ${bigNumberToDecimal(simulation.coinbaseDiff.div(simulation.totalGasUsed), 9)} GWEI`)
      const bundlePromises =  _.map([blockNumber + 1, blockNumber + 2], targetBlockNumber =>
        this.flashbotsProvider.sendRawBundle(
          signedBundle,
          targetBlockNumber
        ))
      await Promise.all(bundlePromises)
      return
      */

    }
    console.log("\n--- No arbitrage submitted to relay. ---\n")
    // throw new Error("No arbitrage submitted to relay")
  }
}
