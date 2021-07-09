import { BigNumber, Wallet } from "ethers";

export const ETHER = BigNumber.from(10).pow(18);

export function bigNumberToDecimal(value: BigNumber, base = 18): number {
  const divisor = BigNumber.from(10).pow(base)
  return value.mul(10000).div(divisor).toNumber() / 10000
}

// We dont' need to do the mul/div trick if the number is so big that it exceeds
// javascripts max safe integer value.
export function veryBigNumberToDecimal(value: BigNumber, base = 18): number {
  const divisor = BigNumber.from(10).pow(base)
  return value.div(divisor).toNumber()
}

export function getDefaultRelaySigningKey(): string {
  console.warn("You have not specified an explicity FLASHBOTS_RELAY_SIGNING_KEY environment variable. Creating random signing key, this searcher will not be building a reputation for next run")
  const key = Wallet.createRandom().privateKey;
  console.log(key);
  return key;
}
