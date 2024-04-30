/**
 * Copyright (c) 2024, BOTLabs GmbH.
 *
 * This source code is licensed under the BSD 4-Clause "Original" license
 * found in the LICENSE file in the root directory of this source tree.
 */

import { toChain } from "@kiltprotocol/did"
import { ApiPromise } from "@polkadot/api"
import { BN } from "@polkadot/util"

import { generateDipIdentityProof } from './dipProof/subjectIdentity.js'
import { generateProviderStateRootProof } from './stateProof/providerStateRoot.js'
import { generateDipCommitmentProof } from './stateProof/subjectDipCommitment.js'

import type { DipIdentityProofRes } from './dipProof/subjectIdentity.js'
import type { ProviderStateRootProofRes } from './stateProof/providerStateRoot.js'
import type { DipCommitmentProofRes } from './stateProof/subjectDipCommitment.js'
import type { PalletDidLookupLinkableAccountLinkableAccountId } from "@kiltprotocol/augment-api"
import type {
  DidUri,
  DidKey,
  SubmittableExtrinsic,
} from "@kiltprotocol/types"
import type { Call } from "@polkadot/types/interfaces"
import type { Codec } from "@polkadot/types-codec/types"

const defaultValues = {
  includeWeb3Name: async () => false,
  linkedAccounts: async () => [],
  providerBlockHeight: async (providerApi: ApiPromise) => {
    const providerLastFinalizedBlockHash =
      await providerApi.rpc.chain.getFinalizedHead()
    return providerApi.rpc.chain
      .getHeader(providerLastFinalizedBlockHash)
      .then((h) => h.number.toBn())
  }
}

/** The DIP proof params. */
export type DipSiblingBaseProofInput = {
  /** The DID URI of the DIP subject that is performing the cross-chain operation. */
  didUri: DidUri
  /** The verification method IDs of the DID to be revealed in the cross-chain operation. */
  keyIds: Array<DidKey["id"]>
  /** The version of the DIP proof to generate. */
  proofVersion: number
  /** The `ApiPromise` instance for the provider chain. */
  providerApi: ApiPromise
  /** The `ApiPromise` instance for the parent relay chain. */
  relayApi: ApiPromise
  /** The block number of the provider to use for the generation of the DIP proof. If not provided, the latest finalized block number is used. */
  providerBlockHeight?: BN
  /** Flag indicating whether the generated DIP proof should include the web3name of the DID subject. If not provided, the web3name is not revealed. */
  includeWeb3Name?: boolean
  /** The list of linked accounts to reveal in the generated DIP proof. If not provided, no account is revealed. */
  linkedAccounts?: readonly PalletDidLookupLinkableAccountLinkableAccountId[]
}

/** The DIP proof result. */
export type DipSiblingBaseProofRes = {
  providerHeadProof: ProviderStateRootProofRes,
  dipCommitmentProof: DipCommitmentProofRes,
  dipProof: DipIdentityProofRes,
  proofVersion: number,
}

/**
 * Generate a base DIP proof according to the parameters provided, to be used on a consumer chain of which the provider chain is a sibling.
 *
 * @param params The DIP proof params.
 *
 * @returns The `DipSiblingBaseProofRes` containing the basic DIP proof components, without any consumer-specific logic.
 */
export async function generateDipSiblingBaseProof({
  didUri,
  keyIds,
  proofVersion,
  providerApi,
  relayApi,
  providerBlockHeight,
  includeWeb3Name,
  linkedAccounts
}: DipSiblingBaseProofInput): Promise<DipSiblingBaseProofRes> {
  const actualProviderBlockHeight = providerBlockHeight ?? await defaultValues.providerBlockHeight(providerApi)
  const providerHeadProof = await generateProviderStateRootProof({
    relayApi,
    providerApi,
    providerBlockHeight: actualProviderBlockHeight,
  })

  // Proof of commitment must be generated with the state root at the block before the last one finalized.
  const dipRootProofBlockHash = await providerApi.rpc.chain.getBlockHash(
    actualProviderBlockHeight.subn(1),
  )
  const dipCommitmentProof = await generateDipCommitmentProof({
    didUri,
    providerApi,
    providerBlockHash: dipRootProofBlockHash,
    version: proofVersion,
  })

  const dipProof = await generateDipIdentityProof({
    didUri,
    providerApi,
    keyIds,
    linkedAccounts: linkedAccounts || await defaultValues.linkedAccounts(),
    version: proofVersion,
    includeWeb3Name: includeWeb3Name || await defaultValues.includeWeb3Name(),
  })

  return {
    providerHeadProof,
    dipCommitmentProof,
    dipProof,
    proofVersion,
  }
}

export type GenerateDipSubmittableExtrinsicInput = {
  additionalProofElements: Record<string, Codec>,
  api: ApiPromise,
  baseDipProof: DipSiblingBaseProofRes,
  call: Call
  didUri: DidUri,
}

export function generateDipSubmittableExtrinsic({ additionalProofElements, api, baseDipProof, call, didUri }: GenerateDipSubmittableExtrinsicInput): SubmittableExtrinsic {
  const { proofVersion, ...dipProof } = baseDipProof

  return api.tx.dipConsumer.dispatchAs(
    toChain(didUri),
    {
      [`V${proofVersion}`]: {
        ...dipProof,
        ...additionalProofElements
      }
    },
    call
  )
}
