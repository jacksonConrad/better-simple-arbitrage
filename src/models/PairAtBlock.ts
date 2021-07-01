import mongooseService from '../clients/mongoose';

interface CreatePairAtBlockDTO {
  marketAddress: string;
  blockNumber: number;
  reserves0: number;
  reserves1: number;
}

class PairAtBlock {
  Schema = mongooseService.getMongoose().Schema;

  pairAtBlockSchema = new this.Schema({
    _id: String,
    marketAddress: String,
    blockNumber: Number,
    reserves0: Number,
    reserves1: Number
  }, { id: false })

  PairAtBlock = mongooseService.getMongoose().model('PairsAtBlocks', this.pairAtBlockSchema);

  constructor() {
    // console.log('PairAtBlock constructor');
  }

  async addPairAtBlock(fields: CreatePairAtBlockDTO) {
    const pairAtBlock = new this.PairAtBlock({
        _id: `${fields.blockNumber}-${fields.marketAddress}`,
        ...fields
    });
    await pairAtBlock.save();
    return fields.marketAddress;
  }

  async getPairAtBlock(marketAddress: string, blockNumber: number) {
    return this.PairAtBlock.findOne({ _id: `${blockNumber}-${marketAddress}` }).populate('PairAtBlock').exec();
  }
}

export default new PairAtBlock();