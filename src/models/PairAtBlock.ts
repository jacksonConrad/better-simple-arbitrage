import mongooseService from '../clients/mongoose';
import { BigNumber } from 'ethers';

export interface CreatePairAtBlockDTO {
  marketAddress: string;
  blockNumber: number;
  reserves0: string;
  reserves1: string;
}

export interface PairAtBlockDTO {
  _id: string;
  marketAddress: string;
  blockNumber: number;
  reserves0: string;
  reserves1: string;
}

class PairAtBlockModel {
  Schema = mongooseService.getMongoose().Schema;

  pairAtBlockSchema = new this.Schema({
    _id: String,
    marketAddress: String,
    blockNumber: Number,
    reserves0: String,
    reserves1: String
  }, { id: false })

  PairAtBlock = mongooseService.getMongoose().model('PairsAtBlocks', this.pairAtBlockSchema);

  constructor() {
    // console.log('PairAtBlock constructor');
  }

  async batchAddPairsAtBlocks(docs: Array<CreatePairAtBlockDTO>) {
    await this.PairAtBlock.insertMany(docs);
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

export const PairAtBlock = new PairAtBlockModel()
// export PairAtBlock;