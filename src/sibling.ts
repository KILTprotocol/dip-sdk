/**
 * Copyright (c) 2024, BOTLabs GmbH.
 *
 * This source code is licensed under the BSD 4-Clause "Original" license
 * found in the LICENSE file in the root directory of this source tree.
 */

import { toChain } from "@kiltprotocol/did"
import { ApiPromise } from "@polkadot/api"
import { u8aToHex } from "@polkadot/util"

import {
  defaultValues,
  generateDipCommitmentProof,
  generateDipDidSignature,
  generateDipIdentityProof,
  generateProviderStateRootProof,
} from "./utils.js"

import type { PalletDidLookupLinkableAccountLinkableAccountId } from "@kiltprotocol/augment-api"
import type {
  DidUri,
  VerificationKeyRelationship,
  SubmittableExtrinsic,
  DidKey,
  SignExtrinsicCallback,
  BN,
} from "@kiltprotocol/types"
import type { KeyringPair } from "@polkadot/keyring/types"
import type { Call, Hash } from "@polkadot/types/interfaces"

/** The DIP proof params. */
export type DipSiblingProofInput = {
  /** The `Call` on the consumer chain that requires a DIP origin. */
  call: Call
  /** The `ApiPromise` instance for the consumer chain. */
  consumerApi: ApiPromise
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
  /** The signing callback to sign the cross-chain transaction. */
  signer: SignExtrinsicCallback
  /** The address of the tx submitter on the consumer chain. */
  submitterAddress: KeyringPair["address"]
  /** The `VerificationKeyRelationship` required for the DIP operation to be authorized on the relay chain. */
  keyRelationship: VerificationKeyRelationship
  /** The block number until which the DID signature is to be considered fresh. If not provided, the latest best block number + an offset of 50 is used. */
  validUntil?: BN
  /** The genesis hash of the consumer chain to use for the DID signature. If not provided, it is retrieved at runtime from the consumer chain. */
  genesisHash?: Hash
  /** The block number of the provider to use for the generation of the DIP proof. If not provided, the latest finalized block number is used. */
  providerBlockHeight?: BN
  /** The runtime type definition for an `AccountId` on the consumer chain. If not provided, the `AccountId` type is used. */
  accountIdRuntimeType?: string
  /** The runtime type definition for a `BlockNumber` on the consumer chain. If not provided, the `u64` type is used. */
  blockNumberRuntimeType?: string
  /** The runtime type definition for the `IdentityDetails` on the consumer chain. If not provided, the `Option<u128>` type, representing a simple nonce, is used. */
  identityDetailsRuntimeType?: string
  /** Flag indicating whether the generated DIP proof should include the web3name of the DID subject. If not provided, the web3name is not revealed. */
  includeWeb3Name?: boolean
  /** The list of linked accounts to reveal in the generated DIP proof. If not provided, no account is revealed. */
  linkedAccounts?: readonly PalletDidLookupLinkableAccountLinkableAccountId[]
}

/**
 * Generate a submittable extrinsic for the provided call which includes a complete DIP proof according to the parameters provided, to be used on a consumer chain of which the provider chain is a sibling.
 *
 * @param params The DIP proof params.
 *
 * @returns The `SubmittableExtrinsic` containing the signed cross-chain operation, that must be submitted by the account specified as the `submitterAddress` parameter.
 */
export async function generateDipAuthorizedTxForSibling({
  call,
  consumerApi,
  didUri,
  keyIds,
  proofVersion,
  providerApi,
  relayApi,
  signer,
  submitterAddress,
  keyRelationship,
  // Optional
  validUntil,
  genesisHash,
  providerBlockHeight,
  // With defaults
  accountIdRuntimeType = defaultValues.accountIdRuntimeType,
  blockNumberRuntimeType = defaultValues.blockNumberRuntimeType,
  identityDetailsRuntimeType = defaultValues.identityDetailsRuntimeType,
  includeWeb3Name = defaultValues.includeWeb3Name,
  linkedAccounts = defaultValues.linkedAccounts,
}: DipSiblingProofInput): Promise<SubmittableExtrinsic> {
  const {
    proof: { proof: providerStateRootProof },
    providerBlockHeight: providerStateRootProofProviderBlockHeight,
    relayBlockHeight: providerStateRootProofRelayBlockHeight,
  } = await generateProviderStateRootProof({
    relayApi,
    providerApi,
    providerBlockHeight,
  })

  const dipRootProofBlockHash = await providerApi.rpc.chain.getBlockHash(
    providerStateRootProofProviderBlockHeight,
  )

  const {
    proof: { proof: dipCommitmentProof },
  } = await generateDipCommitmentProof({
    didUri,
    providerApi,
    providerBlockHash: dipRootProofBlockHash,
    version: proofVersion,
  })

  // TODO: Getting an invalid DID merkle proof now, need to be investigated further.
  const { proof: dipIdentityProof } = await generateDipIdentityProof({
    didUri,
    providerApi,
    keyIds,
    linkedAccounts,
    version: proofVersion,
    includeWeb3Name,
  })

  const {
    validUntil: didSignatureExpirationBlockNumber,
    signature: didSignature,
    type: didSignatureType,
  } = await generateDipDidSignature({
    provider: {
      didUri,
      signer,
      keyRelationship,
    },
    consumer: {
      api: consumerApi,
      call,
      submitterAddress,
      accountIdRuntimeType,
      validUntil,
      blockNumberRuntimeType,
      genesisHash,
      identityDetailsRuntimeType,
    },
  })

  return consumerApi.tx.dipConsumer.dispatchAs(
    toChain(didUri),
    {
      [`V${proofVersion}`]: {
        providerHeadProof: {
          relayBlockNumber: providerStateRootProofRelayBlockHeight,
          proof: providerStateRootProof,
        },
        dipCommitmentProof,
        dipProof: {
          blinded: dipIdentityProof.blinded,
          revealed: dipIdentityProof.revealed,
        },
        signature: {
          signature: {
            [didSignatureType]: u8aToHex(didSignature),
          },
          validUntil: didSignatureExpirationBlockNumber,
        },
      },
    },
    call,
  )
}
