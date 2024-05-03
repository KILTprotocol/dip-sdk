/**
 * Copyright (c) 2024, BOTLabs GmbH.
 *
 * This source code is licensed under the BSD 4-Clause "Original" license
 * found in the LICENSE file in the root directory of this source tree.
 */

import { BN } from "@polkadot/util"

import type { ApiPromise } from "@polkadot/api"
import type { ReadProof, Hash } from "@polkadot/types/interfaces"
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
}
/**
 * The response object containing the provider state proof.
 */
export type ProviderStateRootProofRes = {
  /** The raw state proof for the provider state. */
  proof: ReadProof
  /** The hash of the relay block which the proof is anchored to. */
  relayBlockHash: Hash
  /** The number of the relay block which the proof is anchored to. */
  relayBlockHeight: BN,
  /** The hash of the parachain block which the proof is calculated from. */
  providerBlockHash: Hash
  /** The number of the parachain block which the proof is calculated from. */
  providerBlockHeight: BN
}
/**
 * Generate a proof for the state root of the provider.
 *
 * Given the relay block height, its `paras::heads` storage is queried to fetch information about the provider parent block.
 * Then, the next provider block is fetched and use as the basis of the proof, since its state (root) is finalized in the specified relay block.
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
}: ProviderStateRootProofOpts): Promise<ProviderStateRootProofRes> {
  const providerParaId = await providerApi.query.parachainInfo.parachainId()

  const relayBlockHash = await (async () => {
    const { block: { header } } = await relayApi.derive.chain.getBlockByNumber(relayBlockHeight)
    return header.hash
  })()
  // This uses the `paras::heads` storage entry to fetch info about the finalized parent header, and then adds 1 to fetch the next provider block, whose state root is included in the fetched `paras::heads` entry.
  const providerStoredHeader = await (async () => {
    const relayApiAtBlock = await relayApi.at(relayBlockHash)
    // Contains (provider_parent, provider_current_extrinsic_root, provider_current_state_root)
    const providerHeadData = await relayApiAtBlock.query.paras.heads<Option<Bytes>>(providerParaId)
    const providerBlockNumber = await (async () => {
      // First 32 bytes of the `HeadData` is the parent block hash on which the current state is built.
      const providerParentBlockHash = providerHeadData.unwrap().slice(0, 32)
      // Since we need to prove the state of the current block, we add +1 to the retrieved block number of the parent block.
      const { block: { header: { number } } } = await providerApi.rpc.chain.getBlock(providerParentBlockHash)
      return number.toBn().addn(1)
    })()
    const { block: { header: providerHeader } } = await providerApi.derive.chain.getBlockByNumber(providerBlockNumber)
    return providerHeader
  })()

  const proof = await relayApi.rpc.state.getReadProof(
    [relayApi.query.paras.heads.key(providerParaId)],
    relayBlockHash,
  )

  return {
    proof,
    relayBlockHash,
    relayBlockHeight,
    providerBlockHash: providerStoredHeader.hash,
    providerBlockHeight: providerStoredHeader.number.toBn()
  }
}
