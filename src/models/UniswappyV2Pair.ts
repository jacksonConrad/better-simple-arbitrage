import { WETH_ADDRESS } from '../addresses';
import mongooseService from '../clients/mongoose';
import { UniswappyV2EthPair } from "../UniswappyV2EthPair";

interface CreatePairDTO {
  marketAddress: string;
  token0: string;
  token1: string;
  factoryAddress: string;
  sym0?: string;
  sym1?: string;
}

interface PairFields {
  _id: string,
  marketAddress?: string;
  token0?: string;
  token1?: string;
  factoryAddress?: string;
  sym0?: string;
  sym1?: string;
}

interface MinPairFields {
  _id: string,
  token0: string;
  token1: string;
}

class UniswappyV2Pair {
  Schema = mongooseService.getMongoose().Schema;

  uniswappyV2PairSchema = new this.Schema({
    _id: String,
    token0: String, // Address of token0
    token1: String, // Address of token1,
    marketAddress: String,
    factoryAddress: String,
    sym0: String,
    sym1: String
  }, { id: false })

  UniswappyV2Pair = mongooseService.getMongoose().model('UniswappyV2Pairs', this.uniswappyV2PairSchema);

  constructor() {
    // console.log('UniswappyV2Pair constructor');
  }

  async addPair(fields: CreatePairDTO) {
    const pair = new this.UniswappyV2Pair({
        _id: fields.marketAddress,
        ...fields
    });
    await pair.save();
    console.log('pair added: ' + fields.marketAddress);
    return fields.marketAddress;
  }

  async getPairByAddress(marketAddress: string) {
    return this.UniswappyV2Pair.findOne({ _id: marketAddress }).populate('UniswappyV2Pair').exec();
  }

  async deletePairByAddress(marketAddress: string) {
    return this.UniswappyV2Pair.findOne({ _id: marketAddress }).remove().exec();
  }

  async getAllPairAddresses() {
    return this.UniswappyV2Pair.find({}, { _id: 1 }).exec().then((arr: Array<PairFields>) => {
      // TODO: use native MongoDB/Mongoose for mapping to array of _id's
      return arr.map((a:PairFields) => a._id);
    });
  }

  async getAllWETHPairAddresses() {
    return this.UniswappyV2Pair.find({ '$or':[ { token0: { '$eq': WETH_ADDRESS }}, { token1: { '$eq': WETH_ADDRESS } }] },
      { _id: 1, token0: 1, token1: 1 }
      )
      .exec()
      .then((pairs: Array<MinPairFields>) => {
        return pairs.map((p:MinPairFields) => {
          return new UniswappyV2EthPair(p._id, [p.token0, p.token1], "");
        });
      });
  }

  // async getAllWETHPairAddressesInMultipleExchanges() {
  //   return this.UniswappyV2Pair.find().group
  // }
}

export default new UniswappyV2Pair();