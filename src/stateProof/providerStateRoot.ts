/**
 * Copyright (c) 2024, BOTLabs GmbH.
 *
 * This source code is licensed under the BSD 4-Clause "Original" license
 * found in the LICENSE file in the root directory of this source tree.
 */

import { BN } from "@polkadot/util"

import type { ApiPromise } from "@polkadot/api"
import type { ReadProof } from "@polkadot/types/interfaces"

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
  /** The block number on the provider chain to use for the proof. If not provided, the latest finalized block number for the provider is used. */
  providerBlockHeight: BN
  /** The version of the parachain state proof to generate. */
  proofVersion: number
}
/**
 * The response object containing the provider state proof.
 */
export type ProviderStateRootProofRes = {
  /** The raw state proof for the provider state. */
  proof: ReadProof
  /** The block number of the relaychain which the proof is anchored to. */
  relayBlockHeight: BN
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
  providerBlockHeight,
  // `proofVersion` is not used, for now, but it's added to avoid introducing unnecessary breaking changes
  // proofVersion,
}: ProviderStateRootProofOpts): Promise<ProviderStateRootProofRes> {
  const providerBlockHash = await providerApi.rpc.chain.getBlockHash(providerBlockHeight)
  const providerApiAtBlock = await providerApi.at(providerBlockHash)
  const providerParaId =
    await providerApiAtBlock.query.parachainInfo.parachainId()
  const relayParentBlockNumber =
    await providerApiAtBlock.query.parachainSystem.lastRelayChainBlockNumber()
  // This refers to the previously finalized block, we need the current one.
  const relayParentBlockHash = await relayApi.rpc.chain.getBlockHash(
    relayParentBlockNumber,
  )

  const proof = await relayApi.rpc.state.getReadProof(
    [relayApi.query.paras.heads.key(providerParaId)],
    relayParentBlockHash,
  )

  return {
    proof,
    relayBlockHeight: relayParentBlockNumber.toBn()
  }
}
