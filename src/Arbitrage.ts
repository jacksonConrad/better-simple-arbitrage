import * as _ from "lodash";
import { BigNumber, Contract, Wallet, providers } from "ethers";
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import { WETH_ADDRESS } from "./addresses";
import { EthMarket } from "./EthMarket";
import { ETHER, bigNumberToDecimal, veryBigNumberToDecimal } from "./utils";
import Token from "./models/Token";

const TOKEN_BLACKLIST = [
  '0x9EA3b5b4EC044b70375236A281986106457b20EF',
  '0x15874d65e649880c2614e7a480cb7c9A55787FF6',
  '0x1A3496C18d558bd9C6C8f609E1B129f67AB08163'
]

export interface CrossedMarketDetails {
  profit: number,
  volume: number,
  deltaAlpha: number,
  deltaBetaPrime: number,
  tokenAddress: string,
  buyFromMarket: EthMarket,
  sellToMarket: EthMarket,
}

export type MarketsByToken = { [tokenAddress: string]: Array<EthMarket> }

// For each Crossed Market pair...
// 1. Compute the optimal input amount
// 2. Compute the optimal profit
export async function getBestCrossedMarket(crossedMarkets: Array<EthMarket>[], tokenAddress: string): Promise<CrossedMarketDetails | undefined> {
  let bestCrossedMarket: CrossedMarketDetails | undefined = undefined;
  
  for (const crossedMarket of crossedMarkets) {
    const buyWETHMarket = crossedMarket[0]
    const sellWETHMarket = crossedMarket[1]

    let buyTokenReserves, sellTokenReserves;
    const token = await Token.getToken(tokenAddress)

    // Convert reserves from BigNumber to JS native number type
    // This avoids underflow errors/small decimal values being rounded to 0
    // but potentially introduces JS precision issues.

    const buyWETHReserves = bigNumberToDecimal(buyWETHMarket.getBalance(WETH_ADDRESS))
    const sellWETHReserves = bigNumberToDecimal(sellWETHMarket.getBalance(WETH_ADDRESS))

    try {
      buyTokenReserves = bigNumberToDecimal(buyWETHMarket.getBalance(tokenAddress), token.decimals)
      sellTokenReserves = bigNumberToDecimal(sellWETHMarket.getBalance(tokenAddress), token.decimals)
    } catch(e) {
      // try
      // console.log(e);
    }

    if (!buyTokenReserves || !sellTokenReserves) {
      try {
        buyTokenReserves = veryBigNumberToDecimal(buyWETHMarket.getBalance(tokenAddress), token.decimals)
        sellTokenReserves = veryBigNumberToDecimal(sellWETHMarket.getBalance(tokenAddress), token.decimals)
      } catch(e) { 
        console.error('Error computing best markets for token: ' + tokenAddress + ' - Overflow or Underflow error');
        console.error(`
          marketAWETHReserves: ${buyWETHMarket.getBalance(WETH_ADDRESS)}\n
          marketATokenReserves: ${buyWETHMarket.getBalance(tokenAddress)}\n
          marketBWETHReserves: ${sellWETHMarket.getBalance(WETH_ADDRESS)}\n
          marketBTokenReserves: ${sellWETHMarket.getBalance(tokenAddress)}\n   
        `)
        continue;
      }
    }

    try {

      // If we can't get any token from either market, skip.
      if(buyTokenReserves === 0 && sellTokenReserves === 0) {
        continue;
      }

      // Calculate optimal input, output & profits
      const kBuy = buyWETHReserves * buyTokenReserves;
      const kSell = sellWETHReserves * sellTokenReserves;
      const gamma = 0.997;

      const numeratorA = (kSell ** .5) * buyTokenReserves;
      const numeratorB = (gamma ** -1) * ((kBuy ** .5) * sellTokenReserves)
      const denominator = (kBuy ** .5) + (kSell ** .5)

      const _deltaAlpha = (numeratorA - numeratorB) / denominator;

      const betaDenominator = buyTokenReserves - _deltaAlpha;
      const _deltaBeta = (gamma ** -1) * ((kBuy / betaDenominator) - buyWETHReserves)
      const betaPrimeDenominator = sellTokenReserves + (gamma * _deltaAlpha)
      const _deltaBetaPrime = sellWETHReserves - (kSell / betaPrimeDenominator);

      const profit = _deltaBetaPrime - _deltaBeta;

      // Sometimes the arb index gives us a false positive because of JS rounding errors.
      // If this happens, _deltaBeta will be negative, and we should just throw it out.
      // TODO: Check for false negatives (not getting marked as crossed market when they really are)
      if (_deltaBeta < 0) {
        continue;
      }

      // Set as bestCrossedMarket if this is the first market for this token
      // OR
      // if this crossed market is more profitable than a previous one
      if ((bestCrossedMarket === undefined || profit > bestCrossedMarket.profit) && profit && profit > .001) {
        
        
        // console.log(`PARAMS for token: ${tokenAddress}`)
        // console.log(`kSell: ${kSell}`);
        // console.log(`kBuy: ${kBuy}`);
        // console.log(`buyWETHReserves: ${buyWETHReserves}`);
        // console.log(`buyTokenReserves: ${buyTokenReserves}`);
        // console.log(`sellWETHReserves: ${sellWETHReserves}`);
        // console.log(`sellTokenReserves: ${sellTokenReserves}`);
        // console.log(`gamma: ${gamma}`);
        // console.log(`WETH Volume In: ${_deltaBeta}`);
        // console.log(`WETH Profits  : ${profit}`)
        // console.log(`\n\n`)

        bestCrossedMarket = {
          volume: _deltaBeta,
          deltaAlpha: _deltaAlpha,
          deltaBetaPrime: _deltaBetaPrime,
          profit: profit,
          tokenAddress,
          buyFromMarket: buyWETHMarket,
          sellToMarket: sellWETHMarket
        }
      }
      else {
        // console.log(`Skipping token ${tokenAddress} - Volume: ${_deltaBeta}, Profit: ${profit}`);
      }
    } catch (e) {
      console.error('SOME OTHER ERROR COMPUTING OPTIMAL ARBITRAGE PRICE - Token: ' + tokenAddress)
    }
  }
  return bestCrossedMarket;
}

async function _evaluateMarketsForToken(tokenAddress: string, markets: Array<EthMarket>): Promise<CrossedMarketDetails | undefined> {
  // console.log(`Evaluating ${markets.length} pools for token: ${tokenAddress}`);
  const pricedMarkets = await Promise.all(
    _.map(markets, async (ethMarket: EthMarket) => {

      // Get reserve ratio in terms of WETH to determine arb indexes
      const reserveRatioInWETH: number = await ethMarket.getReservesRatioInWETH();
      
      return {
        ethMarket: ethMarket,
        reserveRatioInWETH
      }
    })
  );
  
  // Compute the optimal input amount.
  const crossedMarkets = new Array<Array<EthMarket>>()
  for (const pricedMarket of pricedMarkets) {
    _.forEach(pricedMarkets, pm => {

      // TODO: Use something like FixedNumber to get better decimal precision;
      const arbIndex = pricedMarket.reserveRatioInWETH / pm.reserveRatioInWETH;

      // If arb index > 1.003 ** 2, there may be an arb opportunity.
      // Threshold for arbitrage opportunities across constant product markets
      // generally is 1.003^n, where n is the number of swaps performed.
      // This assumes an exchange fee of 0.3%
      if (arbIndex > 1.003**2) {
        //                 [ marketToBuyEthFrom,     marketToSellEthTo ]
        crossedMarkets.push([pm.ethMarket, pricedMarket.ethMarket])
      }
    })
  }

  const bestCrossedMarket = await getBestCrossedMarket(crossedMarkets, tokenAddress);
  if (bestCrossedMarket !== undefined && bestCrossedMarket.profit > .001)  {
    return bestCrossedMarket;
  }
}

export class Arbitrage {
  private flashbotsProvider: FlashbotsBundleProvider;
  private bundleExecutorContract: Contract;
  private executorWallet: Wallet;
  private provider: providers.JsonRpcProvider;

  constructor(executorWallet: Wallet, flashbotsProvider: FlashbotsBundleProvider, provider: providers.JsonRpcProvider, bundleExecutorContract: Contract) {
    this.executorWallet = executorWallet;
    this.flashbotsProvider = flashbotsProvider;
    this.bundleExecutorContract = bundleExecutorContract;
    this.provider = provider;
  }

  static async printCrossedWETHMarket(crossedMarket: CrossedMarketDetails): Promise<void> {
    // const buyTokens = crossedMarket.buyFromMarket.tokens
    // const sellTokens = crossedMarket.sellToMarket.tokens
    const tokenAddress = crossedMarket.buyFromMarket.tokens[0] === WETH_ADDRESS ? crossedMarket.buyFromMarket.tokens[1] : crossedMarket.buyFromMarket.tokens[0]
    const WETH = await Token.getToken(WETH_ADDRESS);
    const token = await Token.getToken(tokenAddress);

    const transaction1 = {
      Market: crossedMarket.buyFromMarket.marketAddress,
      InputToken: WETH.sym,
      OutputToken: token.sym,
      AmountIn: crossedMarket.volume.toFixed(6),
      AmountOut: crossedMarket.deltaAlpha.toFixed(6)
    }

    const transaction2 = {
      Market: crossedMarket.sellToMarket.marketAddress,
      InputToken: token.sym,
      OutputToken: WETH.sym,
      AmountIn: crossedMarket.deltaAlpha.toFixed(6),
      AmountOut: crossedMarket.deltaBetaPrime.toFixed(6)
    }

    console.table([transaction1, transaction2]);
    console.log(`Volume: ${crossedMarket.volume.toFixed(6)} WETH`)
    console.log(`Profit: ${crossedMarket.profit.toFixed(6)} WETH\n\n`)
  }


  async evaluateMarkets(marketsByToken: MarketsByToken): Promise<Array<CrossedMarketDetails>> {
    // const bestCrossedMarkets = new Array<CrossedMarketDetails>()

    const _bestCrossedMarkets = await Promise.all(
      _.map(Object.keys(marketsByToken), function(tokenAddress) {
        if (TOKEN_BLACKLIST.includes(tokenAddress)) { return; }
        const markets = marketsByToken[tokenAddress]
        if (markets.length < 2) { return; }
        else {
          return _evaluateMarketsForToken(tokenAddress, markets);
        }
      })
    )
    
    // Remove empty values
    const bestCrossedMarkets: Array<CrossedMarketDetails> = _.compact(_bestCrossedMarkets);
    // Sort by profit
    bestCrossedMarkets.sort((a, b) => a.profit < b.profit ? 1 : a.profit > b.profit ? -1 : 0)
    return bestCrossedMarkets
  }

  // TODO: take more than 1
  async takeCrossedMarkets(bestCrossedMarkets: CrossedMarketDetails[], blockNumber: number, minerRewardPercentage: number): Promise<void> {
    for (const bestCrossedMarket of bestCrossedMarkets) {

      // TODO: this seems like a really stupid way to convert a decimal to big number
      const bigNumberVolume = BigNumber.from(Math.round(bestCrossedMarket.volume * 10000000000)).mul(BigNumber.from(10).pow(8));
      const bigNumberProfit = BigNumber.from(Math.round(bestCrossedMarket.profit * 10000000000)).mul(BigNumber.from(10).pow(8));
      

      const buyCalls = await bestCrossedMarket.buyFromMarket.sellTokensToNextMarket(WETH_ADDRESS, bigNumberVolume, bestCrossedMarket.sellToMarket);
      const inter = bestCrossedMarket.buyFromMarket.getTokensOut(WETH_ADDRESS, bestCrossedMarket.tokenAddress, bigNumberVolume)
      const sellCallData = await bestCrossedMarket.sellToMarket.sellTokens(bestCrossedMarket.tokenAddress, inter, this.bundleExecutorContract.address);

      const targets: Array<string> = [...buyCalls.targets, bestCrossedMarket.sellToMarket.marketAddress]
      const payloads: Array<string> = [...buyCalls.data, sellCallData]
      console.log({targets, payloads})
      const minerReward = bigNumberProfit.mul(minerRewardPercentage).div(100);
      const transaction = await this.bundleExecutorContract.populateTransaction.uniswapWeth(bigNumberVolume, minerReward, targets, payloads, {
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
        console.warn(`Estimate gas failure for token ${bestCrossedMarket.tokenAddress}`)
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
      
      const _blockNumber = await this.provider.getBlockNumber();
      const simulation = await this.flashbotsProvider.simulate(signedBundle, _blockNumber + 1 )
      if ("error" in simulation || simulation.firstRevert !== undefined) {
        console.log(`Simulation Error on token ${bestCrossedMarket.tokenAddress}, skipping`)
        console.error(simulation);
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

    }
    console.log("\n--- No arbitrage submitted to relay. ---\n")
    return;
    // throw new Error("No arbitrage submitted to relay")
  }
}
