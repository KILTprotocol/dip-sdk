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
  providerBlockHeight, // `proofVersion` is not used, for now, but it's added to avoid introducing unnecessary breaking changes
  // proofVersion,
}: ProviderStateRootProofOpts): Promise<ProviderStateRootProofRes> {
  const [latestProviderFinalizedBlockNumber, nextProviderBlock] = await Promise.all([
    providerApi.derive.chain.bestNumberFinalized(),
    providerApi.derive.chain.getBlockByNumber(providerBlockHeight.addn(1))
  ])
  const isProviderBlockProvable = (() => {
    const blockDelta = latestProviderFinalizedBlockNumber.toBn().sub(providerBlockHeight)
    // Fail if delta is -1 (`providerBlockHeight` is > than `latestProviderFinalizedBlockNumber`, i.e., not yet finalized) or 0 (`providerBlockHeight` === `latestProviderFinalizedBlockNumber`)
    return blockDelta.cmpn(0) > 0
  })()
  // If the provided block number is not followed by at least another finalized block (which contains relaychain info with the state of the specified provider block state), fail.
  if (!isProviderBlockProvable) {
    throw new Error(`Specified provider block number "${providerBlockHeight}" cannot be included in a DIP proof, because not finalized and not followed by another finalized block. Current latest finalized block number = "${latestProviderFinalizedBlockNumber}".`)
  }
  const providerParaId =
    await providerApi.query.parachainInfo.parachainId()
  // Relay parent to use for the proof is retrieved from the block finalized after the one specified as argument, as it contains the finalized relay state, which in turn contains the finalized state of the specified block.
  const relayParentBlockNumber = await (async () => {
    const providerApiAtNextBlock = await providerApi.at(nextProviderBlock.block.header.hash)
    return providerApiAtNextBlock.query.parachainSystem.lastRelayChainBlockNumber()
  })()
  const relayParentBlockHash = await relayApi.rpc.chain.getBlockHash(
    relayParentBlockNumber,
  )

  const proof = await relayApi.rpc.state.getReadProof(
    [relayApi.query.paras.heads.key(providerParaId)],
    relayParentBlockHash,
  )

  return {
    proof,
    relayBlockHeight: relayParentBlockNumber.toBn(),
  }
}
