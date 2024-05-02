/**
 * Copyright (c) 2024, BOTLabs GmbH.
 *
 * This source code is licensed under the BSD 4-Clause "Original" license
 * found in the LICENSE file in the root directory of this source tree.
 */

import { BN } from "@polkadot/util"

import type { ApiPromise } from "@polkadot/api"
import type { ReadProof } from "@polkadot/types/interfaces"
import type { Option, Bytes } from "@polkadot/types-codec"

/**
 * The options object provided when generating a proof for the provider state.
 *
 * Proof generation logic depends on the value of `proofVersion`.
 * For more details about what each `proofVersion` provides, please refer to our docs.
 */
export type ProviderStateRootProofOpts = {
  /** The `ApiPromise` instance for the provider chain. */
  providerApi: ApiPromise
  /** The `ApiPromise` instance for the relay chain. */
  relayApi: ApiPromise
  /** The block number on the relaychain to use for the proof. */
  relayBlockHeight: BN
  /** The version of the parachain state proof to generate. */
  proofVersion: number
  /** The para ID of the provider chain. */
  providerParaId: number
}
/**
 * The response object containing the provider state proof.
 */
export type ProviderStateRootProofRes = {
  /** The raw state proof for the provider state. */
  proof: ReadProof
  /** The block number of the provider which the proof is calculated from. */
  providerBlockHeight: BN
}
/**
 * Generate a proof for the state root of the provider.
 *
 * The value and type of the proof depends on the version specified.
 * For more details about what each `proofVersion` provides, please refer to our docs.
 *
 * @param params The state proof params.
 *
 * @returns The generated state proof.
 */
export async function generateProviderStateRootProof({
  providerApi,
  relayApi,
  relayBlockHeight, // `proofVersion` is not used, for now, but it's added to avoid introducing unnecessary breaking changes
  // proofVersion,
  providerParaId,
}: ProviderStateRootProofOpts): Promise<ProviderStateRootProofRes> {
  const relayBlockHash = await (async () => {
    const relayBlock = await relayApi.derive.chain.getBlockByNumber(relayBlockHeight)
    return relayBlock.block.header.hash
  })()
  const providerStoredBlockNumber = await (async () => {
    const relayApiAtBlock = await relayApi.at(relayBlockHash)
    const providerHeadData = await relayApiAtBlock.query.paras.heads<Option<Bytes>>(providerParaId)
    const providerBlockHash = providerHeadData.unwrap().slice(0, 32)
    return providerApi.rpc.chain.getBlock(providerBlockHash).then((block) => block.block.header.number.toBn())
  })()

  const proof = await relayApi.rpc.state.getReadProof(
    [relayApi.query.paras.heads.key()],
    relayBlockHash,
  )

  return {
    proof,
    providerBlockHeight: providerStoredBlockNumber
  }
}
