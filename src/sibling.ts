/**
 * Copyright (c) 2024, BOTLabs GmbH.
 *
 * This source code is licensed under the BSD 4-Clause "Original" license
 * found in the LICENSE file in the root directory of this source tree.
 */

import { toChain } from "@kiltprotocol/did"
import { ApiPromise } from "@polkadot/api"
import { BN } from "@polkadot/util"

import { generateDipIdentityProof } from "./dipProof/subjectIdentity.js"
import { generateProviderStateRootProof } from "./stateProof/providerStateRoot.js"
import { generateDipCommitmentProof } from "./stateProof/subjectDipCommitment.js"

import type { DipIdentityProofRes } from "./dipProof/subjectIdentity.js"
import type { ProviderStateRootProofRes } from "./stateProof/providerStateRoot.js"
import type { DipCommitmentProofRes } from "./stateProof/subjectDipCommitment.js"
import type { PalletDidLookupLinkableAccountLinkableAccountId } from "@kiltprotocol/augment-api"
import type { DidUri, DidKey, SubmittableExtrinsic } from "@kiltprotocol/types"
import type { Call } from "@polkadot/types/interfaces"

const defaultValues = {
  includeWeb3Name: async () => false,
  linkedAccounts: async () => [],
  relayBlockHeight: async (relayApi: ApiPromise) => {
    return relayApi.derive.chain.bestNumberFinalized().then((n) => n.toBn())
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
  /** The block number of the relay chain to use for the generation of the DIP proof. If not provided, the last finalized block is used. */
  relayBlockHeight?: BN
  /** Flag indicating whether the generated DIP proof should include the web3name of the DID subject. If not provided, the web3name is not revealed. */
  includeWeb3Name?: boolean
  /** The list of linked accounts to reveal in the generated DIP proof. If not provided, no account is revealed. */
  linkedAccounts?: readonly PalletDidLookupLinkableAccountLinkableAccountId[]
}

/** The DIP proof result. */
export type DipSiblingBaseProofRes = {
  providerHeadProof: ProviderStateRootProofRes
  dipCommitmentProof: DipCommitmentProofRes
  dipProof: DipIdentityProofRes
  proofVersion: number
}

/**
 * Generate a base DIP proof according to the parameters provided, to be used on a consumer chain of which the provider chain is a sibling.
 *
 * The generated proof only contains parts of the DID Document of the subject.
 * Any additional components that the consumer chain requires, e.g., a cross-chain DID signature, or the presentation of some claims about the subject, are not part of the generated proof.
 * This SDK contains an `extensions` section in which chain-specific proof formats could be added, if needed.
 * 
 * Because of the way relaychain information is passed down to parachains, it is not possible to generate a DIP proof for a block that is the last finalized one.
 * So, if some state on the provider chain is changed at block N, a DIP proof for it can only be generated once block N+1 is also finalized, as it contains the finalized state of the relaychain parent, which in turn contains the finalized state of the provider parachain at block N.
 *
 * @param params The DIP proof generation parameters.
 *
 * @returns The [[DipSiblingBaseProofRes]] containing the basic DIP proof components revealing parts of a DID Document anchored to a specific state root and block number on the provider chain, without any consumer-specific logic.
 */
export async function generateDipSiblingBaseProof({
  didUri,
  keyIds,
  proofVersion,
  providerApi,
  relayApi,
  relayBlockHeight,
  includeWeb3Name,
  linkedAccounts,
}: DipSiblingBaseProofInput): Promise<DipSiblingBaseProofRes> {
  const actualRelayBlockHeight =
    relayBlockHeight ??
    (await defaultValues.relayBlockHeight(relayApi))

  const providerHeadProof = await generateProviderStateRootProof({
    relayApi,
    providerApi,
    relayBlockHeight: actualRelayBlockHeight,
    proofVersion,
  })
  const dipCommitmentProof = await generateDipCommitmentProof({
    didUri,
    providerApi,
    providerBlockHash: providerHeadProof.providerBlockHash,
    version: proofVersion,
  })
  const dipProof = await generateDipIdentityProof({
    didUri,
    providerApi,
    keyIds,
    linkedAccounts: linkedAccounts || (await defaultValues.linkedAccounts()),
    version: proofVersion,
    includeWeb3Name: includeWeb3Name || (await defaultValues.includeWeb3Name()),
  })

  return {
    providerHeadProof,
    dipCommitmentProof,
    dipProof,
    proofVersion,
  }
}

/** The params to create an extrinsic containing a cross-chain DIP proof and operation. */
export type GenerateDipSubmittableExtrinsicInput = {
  /** Any consumer-specific pieces of information to be included in the DIP proof beyond proof-of-DID. */
  additionalProofElements: Record<any, any>
  /** The [[ApiPromise]] instance of the consumer chain. */
  api: ApiPromise
  /** [[DipSiblingBaseProofRes]] as generated by [[generateDipSiblingBaseProof]]. */
  baseDipProof: DipSiblingBaseProofRes
  /** The [[Call]] on the consumer chain that requires a DIP origin to be authorized. */
  call: Call
  /** The [[DidUri]] of the subject performing the cross-chain operation. */
  didUri: DidUri
}

/**
 * Extend a [[DipSiblingBaseProofRes]] proof with consumer-specific components, and compiles the `dispatchAs` extrinsic following the consumer's type registry.
 *
 * @param params The consumer information.
 *
 * @returns A [[SubmittableExtrinsic]] that refers to a [[Call]] on the consumer chain being dispatched by the specified [[DidUri]].
 */
export function generateDipSubmittableExtrinsic({
  additionalProofElements,
  api,
  baseDipProof,
  call,
  didUri,
}: GenerateDipSubmittableExtrinsicInput): SubmittableExtrinsic {
  const { proofVersion, ...dipProof } = baseDipProof

  return api.tx.dipConsumer.dispatchAs(
    toChain(didUri),
    {
      [`V${proofVersion}`]: {
        providerHeadProof: {
          relayBlockNumber: dipProof.providerHeadProof.relayBlockHeight,
          proof: dipProof.providerHeadProof.proof.proof,
        },
        dipCommitmentProof: dipProof.dipCommitmentProof.proof.proof,
        dipProof: {
          blinded: dipProof.dipProof.proof.blinded,
          revealed: dipProof.dipProof.proof.revealed,
        },
        ...additionalProofElements,
      },
    },
    call,
  )
}
