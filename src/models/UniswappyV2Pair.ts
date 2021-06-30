import mongooseService from '../clients/mongoose';

interface CreatePairDTO {
  marketAddress: string;
  token0: string;
  token1: string;
  factoryAddress: string;
  sym0?: string;
  sym1?: string;
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
}

export default new UniswappyV2Pair();