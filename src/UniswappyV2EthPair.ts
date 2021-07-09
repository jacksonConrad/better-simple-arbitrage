import * as _ from "lodash";
import { BigNumber, FixedNumber, Contract, providers } from "ethers";
import { UNISWAP_PAIR_ABI, UNISWAP_QUERY_ABI, ERC20_TOKEN_ABI } from "./abi";
import { UNISWAP_LOOKUP_CONTRACT_ADDRESS, WETH_ADDRESS } from "./addresses";
import { CallDetails, EthMarket, MultipleCallData, TokenBalances } from "./EthMarket";
import { ETHER, bigNumberToDecimal } from "./utils";
import { MarketsByToken } from "./Arbitrage";
import UniswappyV2PairDAO from "./models/UniswappyV2Pair";
import { PairAtBlock, CreatePairAtBlockDTO, PairAtBlockDTO } from "./models/PairAtBlock";
import TokenDAO from "./models/Token";

// batch count limit helpful for testing, loading entire set of uniswap markets takes a long time to load
const BATCH_COUNT_LIMIT = 100;
const UNISWAP_BATCH_SIZE = 1000;

// Not necessary, slightly speeds up loading initialization when we know tokens are bad
// Estimate gas will ensure we aren't submitting bad bundles, but bad tokens waste time
const TOKEN_BLACKLIST = [
  '0x9EA3b5b4EC044b70375236A281986106457b20EF',
  '0x15874d65e649880c2614e7a480cb7c9A55787FF6',
  '0x1A3496C18d558bd9C6C8f609E1B129f67AB08163'
]

interface GroupedMarkets {
  marketsByToken: MarketsByToken;
  allMarketPairs: Array<UniswappyV2EthPair>;
  filteredMarketPairs: Array<UniswappyV2EthPair>;
}

export class UniswappyV2EthPair extends EthMarket {
  static uniswapInterface = new Contract(WETH_ADDRESS, UNISWAP_PAIR_ABI);
  private _tokenBalances: TokenBalances

  constructor(marketAddress: string, tokens: Array<string>, protocol: string) {
    super(marketAddress, tokens, protocol);
    this._tokenBalances = _.zipObject(tokens,[BigNumber.from(0), BigNumber.from(0)])
  }

  receiveDirectly(tokenAddress: string): boolean {
    return tokenAddress in this._tokenBalances
  }

  async prepareReceive(tokenAddress: string, amountIn: BigNumber): Promise<Array<CallDetails>> {
    if (this._tokenBalances[tokenAddress] === undefined) {
      throw new Error(`Market does not operate on token ${tokenAddress}`)
    }
    if (! amountIn.gt(0)) {
      throw new Error(`Invalid amount: ${amountIn.toString()}`)
    }
    // No preparation necessary
    return []
  }

  static async processPair(pair: Array<string>, factoryAddress: string, provider: providers.JsonRpcProvider) {
    const marketAddress = pair[2];
    let tokenAddress: string;

    if (pair[0] === WETH_ADDRESS) {
      tokenAddress = pair[1]
    } else if (pair[1] === WETH_ADDRESS) {
      tokenAddress = pair[0]
    } else {
      return;
    }
    const onManualBlacklist = TOKEN_BLACKLIST.includes(tokenAddress);

    if(onManualBlacklist) {
      console.log('MANUAL BLACKLIST!!!!! ' + tokenAddress)
      return;
    }

    // Fetch Token data if we've never seen it before
    let blacklistedToken = false;
    for (let k=0; k<2; k++) {
      const _tokenAddr = pair[k];
      const token = await TokenDAO.getToken(_tokenAddr);
      
      if (token && token.blacklisted) {
        blacklistedToken = true;
      }



      if (!token) { 
        console.log('Fetching data for new token: ' + _tokenAddr)

        const contract = new Contract(_tokenAddr, ERC20_TOKEN_ABI, provider);
        
        let decimals = 18;
        let name = '- xxx -';
        let sym = '---';

        // Some ERC20s are whack, apparently.
        try {
          name = await contract.name();
          sym = await contract.symbol();
          decimals = await contract.decimals();

        } catch (e) {
          // Skip over tokens that don't implement standard ERC20 methods. (For now).
          console.error(`Blacklisting token at address ${_tokenAddr}`);
          TokenDAO.addToken({ address: _tokenAddr, blacklisted: true });
          blacklistedToken = true;
          continue;
        }

        console.log(`Adding new token: ${sym} - ${name} - ${decimals}`);
        await TokenDAO.addToken({ address: _tokenAddr, sym, name, decimals, blacklisted: false });

      }
    }

    // If we haven't blacklisted the token & have never seen this address before,
    // Add it to the UniswappyV2Pairs collection
    const existingPair = await UniswappyV2PairDAO.getPairByAddress(marketAddress);

    // Remove pairs that have blacklisted token
    if(blacklistedToken && existingPair) {
      console.log('Deleting pair with blacklisted token...');
      await UniswappyV2PairDAO.deletePairByAddress(marketAddress);
    }

    // Only add pairs w/o blacklisted tokens
    if (!blacklistedToken && !existingPair) {
      // Save Pair to Collection
      await UniswappyV2PairDAO.addPair({
        marketAddress,
        token0: pair[0],
        token1: pair[1],
        factoryAddress
      });

      // const uniswappyV2EthPair = new UniswappyV2EthPair(marketAddress, [pair[0], pair[1]], "");
      // marketPairs.push(uniswappyV2EthPair);
    }
  }

  // Get all pools for specified Uniswappy DEX
  // 1. Fetch batch of pairs in DEX
  // 2. For each pair in batch, store the token address (the other token must be WETH) and order of pair (WETH, LINK) vs (LINK, WETH)
  static async getUniswappyMarkets(provider: providers.JsonRpcProvider, factoryAddress: string): Promise<Array<UniswappyV2EthPair>> {
    console.log(`GET MARKETS FOR FACTORY ${factoryAddress}`)
    const uniswapQuery = new Contract(UNISWAP_LOOKUP_CONTRACT_ADDRESS, UNISWAP_QUERY_ABI, provider);

    const marketPairs = new Array<UniswappyV2EthPair>()
    const  startingIndex = 46000;
    const promises = [];
    for (let i = startingIndex; i < BATCH_COUNT_LIMIT * UNISWAP_BATCH_SIZE; i += UNISWAP_BATCH_SIZE) {
      console.log(`${factoryAddress} - ${i} - ${i + UNISWAP_BATCH_SIZE}`);
      let pairs: Array<Array<string>>;
      try {
        pairs = (await uniswapQuery.functions.getPairsByIndexRange(factoryAddress, i, i + UNISWAP_BATCH_SIZE))[0];
      } catch (e) {
        continue;
      }
      

      console.log(`${factoryAddress} - BATCH ${i}`);
      
      for (let j = 0; j < pairs.length; j++) {
        // console.log(`Processing Pair ${j+1}/${pairs.length} in batch ${i}`)
        const pair = pairs[j];
        promises.push(this.processPair(pair, factoryAddress, provider));
      }
      if (pairs.length < UNISWAP_BATCH_SIZE) {
        break
      }
    }

    console.log(`\n\n------------- Kicking off monster of a Promise.all()!!!! -----------------\n\n`);
    await Promise.all(promises);
    console.log(`\n\n------------- Promise.all() Finished!!!!!!!!! -----------------\n\n`);
    return marketPairs
  }

  static async mapReduceUniswapMarketsByToken(provider: providers.JsonRpcProvider, allPairs: Array<UniswappyV2EthPair>): Promise<GroupedMarkets> {
    
    const marketsByTokenAll = _.chain(allPairs)
      .filter(pair => {
        return !TOKEN_BLACKLIST.includes(pair.tokens[0]) && !TOKEN_BLACKLIST.includes(pair.tokens[1])
      })
      .groupBy(pair => pair.tokens[0] === WETH_ADDRESS ? pair.tokens[1] : pair.tokens[0])
      .value();

    // Convert to a form that we can pass to updateReserves
    const allMarketPairs = _.chain(
      // Only get token pairs that exist in multiple markets
      _.pickBy(marketsByTokenAll, a => a.length > 1) // weird TS bug, chain'd pickBy is Partial<>
    )
      .values()
      .flatten()
      .value()

    
    await UniswappyV2EthPair.updateReserves(provider, allMarketPairs, -1);

    const marketsByToken = _.chain(allMarketPairs)
      // Filter out pairs that have more than 5 WETH in reserves
      .filter(pair => {
        return pair.getBalance(WETH_ADDRESS).gt(ETHER.mul(3))
      })
      // Group by the non-WETH token
      .groupBy(pair => pair.tokens[0] === WETH_ADDRESS ? pair.tokens[1] : pair.tokens[0])
      // .filter(group => group.length > 1)
      .value()

    const filteredMarketPairs = _.chain(allMarketPairs)
      .filter(pair => {
        return pair.getBalance(WETH_ADDRESS).gt(ETHER.mul(3))
      })
      .value()
    
    return {
      allMarketPairs,
      filteredMarketPairs,
      marketsByToken
    };
  }

  // Fetch each pool for each factoryy
  static async getUniswapMarketsByToken(provider: providers.JsonRpcProvider, factoryAddresses: Array<string>): Promise<void> {
    console.log('getting UniswapMarkets by TOKEN');
    await Promise.all(
      _.map(factoryAddresses, factoryAddress => UniswappyV2EthPair.getUniswappyMarkets(provider, factoryAddress))
    )

    console.log(`\n\n------ DONE GETTING ALL PAIRS ------\n\n`);
    return;
  }

  static async updateReserves(
    provider: providers.JsonRpcProvider,
    allMarketPairs: Array<UniswappyV2EthPair>,
    blockNumber: number
    ): Promise<void> {
    const uniswapQuery = new Contract(UNISWAP_LOOKUP_CONTRACT_ADDRESS, UNISWAP_QUERY_ABI, provider);

    const pairAddresses = allMarketPairs.map(marketPair => marketPair.marketAddress);
    // console.log("Updating market reserves, count:", pairAddresses.length)

    const reserves: Array<Array<BigNumber>> = (await uniswapQuery.functions.getReservesByPairs(pairAddresses))[0];
    // let pairsAtBlock: CreatePairAtBlockDTO[] = [];
    for (let i = 0; i < allMarketPairs.length; i++) {
      const marketPair = allMarketPairs[i];
      const reserve = reserves[i]

      marketPair.setReservesViaOrderedBalances([reserve[0], reserve[1]])

      if (blockNumber > 0) {
        // pairsAtBlock.push({
        //   marketAddress: pairAddresses[i],
        //   blockNumber,
        //   reserves0: reserve[0].toString(),
        //   reserves1: reserve[1].toString()
        // })
      }
    }

    // TODO: Add config flag to skip saving, to speed up search time.
    // await PairAtBlock.batchAddPairsAtBlocks(pairsAtBlock);
    // console.log('Reserves updated.');
  }

  getBalance(tokenAddress: string): BigNumber {
    const balance = this._tokenBalances[tokenAddress]
    if (balance === undefined) throw new Error("bad token")
    return balance;
  }

  setReservesViaOrderedBalances(balances: Array<BigNumber>): void {
    this.setReservesViaMatchingArray(this._tokens, balances)
  }

  setReservesViaMatchingArray(tokens: Array<string>, balances: Array<BigNumber>): void {
    const tokenBalances = _.zipObject(tokens, balances)
    if (!_.isEqual(this._tokenBalances, tokenBalances)) {
      this._tokenBalances = tokenBalances
    }
  }

  getTokensIn(tokenIn: string, tokenOut: string, amountOut: BigNumber): BigNumber {
    const reserveIn = this._tokenBalances[tokenIn]
    const reserveOut = this._tokenBalances[tokenOut]
    return this.getAmountIn(reserveIn, reserveOut, amountOut);
  }

  getTokensOut(tokenIn: string, tokenOut: string, amountIn: BigNumber): BigNumber {
    const reserveIn = this._tokenBalances[tokenIn]
    const reserveOut = this._tokenBalances[tokenOut]
    return this.getAmountOut(reserveIn, reserveOut, amountIn);
  }

  getAmountIn(reserveIn: BigNumber, reserveOut: BigNumber, amountOut: BigNumber): BigNumber {
    const numerator: BigNumber = reserveIn.mul(amountOut).mul(1000);
    const denominator: BigNumber = reserveOut.sub(amountOut).mul(997);
    return numerator.div(denominator).add(1);
  }

  getAmountOut(reserveIn: BigNumber, reserveOut: BigNumber, amountIn: BigNumber): BigNumber {
    const amountInWithFee: BigNumber = amountIn.mul(997);
    const numerator = amountInWithFee.mul(reserveOut);
    const denominator = reserveIn.mul(1000).add(amountInWithFee);
    return numerator.div(denominator);
  }

  async getReservesRatioInWETH(): Promise<number> {
    const tokenAddress = this.tokens[0] === WETH_ADDRESS ? this.tokens[1] : this.tokens[0];

    const token = await TokenDAO.getToken(tokenAddress);
    const tokenDecimals = token.decimals;

    const _wethReserves = this._tokenBalances[WETH_ADDRESS];
    const _tokenReserves = this._tokenBalances[tokenAddress];

    // Normalize reserves w/ decimals
    // Multiply by 10,000 to keep number big, in case reserves are small. We only care about ratio.
    const wethReserves = (_wethReserves.mul(10000)).div(BigNumber.from(10).pow(18))
    const tokenReserves = (_tokenReserves.mul(10000)).div(BigNumber.from(10).pow(tokenDecimals))


    const _ratio = wethReserves.div(tokenReserves);
    let ratio: number;
    if (_ratio.isZero()) {
      // console.log('inverting ratio for token ' + tokenAddress);
      ratio = tokenReserves.div(wethReserves).toNumber();
      ratio = (1/ratio);
    }
    else {
      ratio = _ratio.toNumber();
    }
    // TODO :Get decimals for token.  WETH has 18 decimals
    return ratio;
  }

  async sellTokensToNextMarket(tokenIn: string, amountIn: BigNumber, ethMarket: EthMarket): Promise<MultipleCallData> {
    if (ethMarket.receiveDirectly(tokenIn) === true) {
      const exchangeCall = await this.sellTokens(tokenIn, amountIn, ethMarket.marketAddress)
      return {
        data: [exchangeCall],
        targets: [this.marketAddress]
      }
    }

    const exchangeCall = await this.sellTokens(tokenIn, amountIn, ethMarket.marketAddress)
    return {
      data: [exchangeCall],
      targets: [this.marketAddress]
    }
  }

  async sellTokens(tokenIn: string, amountIn: BigNumber, recipient: string): Promise<string> {
    // function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external lock {
    let amount0Out = BigNumber.from(0)
    let amount1Out = BigNumber.from(0)
    let tokenOut: string;
    if (tokenIn === this.tokens[0]) {
      tokenOut = this.tokens[1]
      amount1Out = this.getTokensOut(tokenIn, tokenOut, amountIn)
    } else if (tokenIn === this.tokens[1]) {
      tokenOut = this.tokens[0]
      amount0Out = this.getTokensOut(tokenIn, tokenOut, amountIn)
    } else {
      throw new Error("Bad token input address")
    }
    const populatedTransaction = await UniswappyV2EthPair.uniswapInterface.populateTransaction.swap(amount0Out, amount1Out, recipient, []);
    if (populatedTransaction === undefined || populatedTransaction.data === undefined) throw new Error("HI")
    return populatedTransaction.data;
  }
}
