/**
 * Copyright (c) 2023, Built on KILT
 * All rights reserved. Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met: 
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution. 
 * 3. All advertising materials mentioning features or use of this software must display the following acknowledgement: Built on KILT. 
 * 4. Neither the name of KILT nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission. 
 * THIS SOFTWARE IS PROVIDED BY BOTLABS GMBH  ''AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL BOTLABS GMBH BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
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

export type DipSiblingProofInput = {
  call: Call
  consumerApi: ApiPromise
  didUri: DidUri
  keyIds: Array<DidKey["id"]>
  proofVersion: number
  providerApi: ApiPromise
  relayApi: ApiPromise
  signer: SignExtrinsicCallback
  submitterAddress: KeyringPair["address"]
  keyRelationship: VerificationKeyRelationship
  // Optional, retrieved from chain otherwise
  blockHeight?: BN
  genesisHash?: Hash
  providerBlockHeight?: BN
  // With defaults
  accountIdRuntimeType?: string
  blockNumberRuntimeType?: string
  identityDetailsRuntimeType?: string
  includeWeb3Name?: boolean
  linkedAccounts?: readonly PalletDidLookupLinkableAccountLinkableAccountId[]
}

/**
 * Generate a submittable extrinsic for the provided call which includes a complete DIP proof according to the parameters provided, to be used on a consumer chain of which the provider chain is a sibling.
 * @param params The DIP proof params.
 * @param params.call The [[Call]] on the consumer chain that requires a DIP origin.
 * @param params.consumerApi The [[ApiPromise]] instance for the consumer chain.
 * @param params.didUri The DID URI of the DIP subject that is performing the cross-chain operation.
 * @param params.keyIds The verification method IDs of the DID to be revealed in the cross-chain operation.
 * @param params.proofVersion The version of the DIP proof to generate.
 * @param params.providerApi The [[ApiPromise]] instance for the provider chain.
 * @param params.relayApi The [[ApiPromise]] instance for the parent relay chain.
 * @param params.signer The signing callback to sign the cross-chain transaction.
 * @param params.submitterAddress The address of the tx submitter on the consumer chain.
 * @param params.keyRelationship The [[VerificationKeyRelationship]] required for the DIP operation to be authorized on the relay chain.
 * @param params.blockHeight [OPTIONAL] The block number on the consumer chain to use for the DID signature. If not provided, the latest best block number is used.
 * @param params.genesisHash [OPTIONAL] The genesis hash of the consumer chain to use for the DID signature. If not provided, it is retrieved at runtime from the consumer chain.
 * @param params.providerBlockHeight [OPTIONAL] The block number of the provider to use for the generation of the DIP proof. If not provided, the latest finalized block number is used.
 * @param params.accountIdRuntimeType [OPTIONAL] The runtime type definition for an `AccountId` on the consumer chain. If not provided, the `AccountId` type is used.
 * @param params.blockNumberRuntimeType [OPTIONAL] The runtime type definition for a `BlockNumber` on the consumer chain. If not provided, the `u64` type is used.
 * @param params.identityDetailsRuntimeType [OPTIONAL] The runtime type definition for the `IdentityDetails` on the consumer chain. If not provided, the `Option<u128>` type, representing a simple nonce, is used.
 * @param params.includeWeb3Name [OPTIONAL] Flag indicating whether the generated DIP proof should include the web3name of the DID subject. If not provided, the web3name is not revealed.
 * @param params.linkedAccounts [OPTIONAL] The list of linked accounts to reveal in the generated DIP proof. If not provided, no account is revealed.
 *
 * @returns The [[SubmittableExtrinsic]] containing the signed cross-chain operation, that must be submitted by the account specified as the `submitterAddress` parameter.
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
  blockHeight,
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

  // Proof of commitment must be generated with the state root at the block before the last one finalized.
  const dipRootProofBlockHash = await providerApi.rpc.chain.getBlockHash(
    providerStateRootProofProviderBlockHeight.subn(1),
  )

  const {
    proof: { proof: dipCommitmentProof },
  } = await generateDipCommitmentProof({
    didUri,
    providerApi,
    providerBlockHash: dipRootProofBlockHash,
    version: proofVersion,
  })

  const { proof: dipIdentityProof } = await generateDipIdentityProof({
    didUri,
    providerApi,
    keyIds,
    linkedAccounts,
    version: proofVersion,
    includeWeb3Name,
  })

  const {
    blockNumber: didSignatureBlockNumber,
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
      blockHeight,
      blockNumberRuntimeType,
      genesisHash,
      identityDetailsRuntimeType,
    },
  })

  return consumerApi.tx.dipConsumer.dispatchAs(
    toChain(didUri),
    {
      [`V${proofVersion}`]: {
        paraStateRoot: {
          relayBlockHeight: providerStateRootProofRelayBlockHeight,
          proof: providerStateRootProof,
        },
        dipIdentityCommitment: dipCommitmentProof,
        did: {
          leaves: {
            blinded: dipIdentityProof.blinded,
            revealed: dipIdentityProof.revealed,
          },
          signature: {
            signature: {
              [didSignatureType]: u8aToHex(didSignature),
            },
            blockNumber: didSignatureBlockNumber,
          },
        },
      },
    },
    call,
  )
}
