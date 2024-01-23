/**
 * Copyright (c) 2024, BOTLabs GmbH.
 *
 * This source code is licensed under the BSD 4-Clause "Original" license
 * found in the LICENSE file in the root directory of this source tree.
 */

import { toChain } from "@kiltprotocol/did"

import type { PalletDidLookupLinkableAccountLinkableAccountId } from "@kiltprotocol/augment-api"
import type {
  DidUri,
  SignExtrinsicCallback,
  DidKey,
  VerificationKeyRelationship,
  VerificationKeyType,
  BN,
} from "@kiltprotocol/types"
import type { ApiPromise } from "@polkadot/api"
import type { KeyringPair } from "@polkadot/keyring/types"
import type { Call, Hash, ReadProof } from "@polkadot/types/interfaces"
import type { Result, Option } from "@polkadot/types-codec"
import type { Codec } from "@polkadot/types-codec/types"

export const defaultValues = {
  accountIdRuntimeType: "AccountId",
  blockNumberRuntimeType: "u64",
  identityDetailsRuntimeType: "Option<u128>",
  includeWeb3Name: false,
  linkedAccounts: [],
}

/**
 * The options object provided when generating a Provider state proof.
 */
export type ProviderStateRootProofOpts = {
  /** The `ApiPromise` instance for the provider chain. */
  providerApi: ApiPromise
  /** The `ApiPromise` instance for the relay chain. */
  relayApi: ApiPromise
  /** The block number on the provider chain to use for the state proof. If not provided, the latest finalized block number is used. */
  providerBlockHeight?: BN
}
/**
 * The response object containing the provider state root proof.
 */
export type ProviderStateRootProofRes = {
  /** The state proof for the provider header. */
  proof: ReadProof
  /** The block number of the provider which the proof is anchored to. */
  providerBlockHeight: BN
  /** The block number of the relaychain which the proof is anchored to. */
  relayBlockHeight: BN
}
/**
 * Generate a state proof that proofs the head of the specified parachain.
 *
 * @param params The state proof params.
 *
 * @returns The generated state proof.
 */
export async function generateProviderStateRootProof({
  providerApi,
  relayApi,
  // Optional
  providerBlockHeight,
}: ProviderStateRootProofOpts): Promise<ProviderStateRootProofRes> {
  const [providerBlockNumber, providerBlockHash] = await (async () => {
    if (providerBlockHeight !== undefined) {
      const blockHash =
        await providerApi.rpc.chain.getBlockHash(providerBlockHeight)
      return [providerBlockHeight, blockHash]
    }
    const providerLastFinalizedBlockHash =
      await providerApi.rpc.chain.getFinalizedHead()
    const providerLastFinalizedBlockHeight = await providerApi.rpc.chain
      .getHeader(providerLastFinalizedBlockHash)
      .then((h) => h.number.toBn())
    return [providerLastFinalizedBlockHeight, providerLastFinalizedBlockHash]
  })()
  const providerApiAtBlock = await providerApi.at(providerBlockHash)
  const providerChainId =
    await providerApiAtBlock.query.parachainInfo.parachainId()
  const relayParentBlockNumber =
    await providerApiAtBlock.query.parachainSystem.lastRelayChainBlockNumber()
  // This refers to the previously finalized block, we need the current one.
  const relayParentBlockHash = await relayApi.rpc.chain.getBlockHash(
    relayParentBlockNumber,
  )

  const proof = await relayApi.rpc.state.getReadProof(
    [relayApi.query.paras.heads.key(providerChainId)],
    relayParentBlockHash,
  )

  return {
    proof,
    providerBlockHeight: providerBlockNumber,
    relayBlockHeight: (relayParentBlockNumber as any).toNumber(),
  }
}

/**
 * The options object provided when generating a DIP commitment proof.
 */
export type DipCommitmentProofOpts = {
  /** The `DidUri` of the subject. */
  didUri: DidUri
  /** The `ApiPromise` instance for the provider chain. */
  providerApi: ApiPromise
  /** The block hash on the provider chain to use for the state proof. */
  providerBlockHash: Hash
  /** The version of the identity commitment to generate the state proof for. */
  version: number
}
/**
 * The response object for a DIP commitment proof.
 */
export type DipCommitmentProofRes = {
  /** The storage proof for the DIP commitment value. */
  proof: ReadProof
}
/**
 * Generate a state proof that proofs the value of an identity commitment on the specified provider chain.
 *
 * @param params The state proof params.
 *
 * @returns The generated state proof.
 */
export async function generateDipCommitmentProof({
  didUri: did,
  providerApi,
  providerBlockHash,
  version,
}: DipCommitmentProofOpts): Promise<DipCommitmentProofRes> {
  const proof = await providerApi.rpc.state.getReadProof(
    [
      providerApi.query.dipProvider.identityCommitments.key(
        toChain(did),
        version,
      ),
    ],
    providerBlockHash,
  )

  return { proof }
}

/**
 * The options object provided when generating a DIP identity proof.
 */
export type DipIdentityProofOpts = {
  /** The `Did` of the subject. */
  didUri: DidUri
  /** The list of DID verification methods to include in the DIP proof and to reveal to the consumer chain. */
  keyIds: Array<DidKey["id"]>
  /** A flag indicating whether the web3name should be included in the DIP proof. */
  includeWeb3Name: boolean
  /** The list of accounts linked to the DID ot include in the DIP proof and to reveal to the consumer chain. */
  linkedAccounts: readonly PalletDidLookupLinkableAccountLinkableAccountId[]
  /** The `ApiPromise` instance for the provider chain. */
  providerApi: ApiPromise
  /** The version of the DIP proof to generate. */
  version: number
}
/**
 * The response object for a generated DIP proof.
 */
export type DipIdentityProofRes = {
  /** The generated storage proof. */
  proof: {
    /** The Merkle proof blinded (not revealed) leaves. */
    blinded: Codec
    /** The Merkle proof revealed leaves. */
    revealed: Codec
  }
  /** The Merkle root hash which the proof is anchored to. */
  root: Hash
}
/**
 * Generate a DIP proof that reveals the specified information about the DID subject.
 *
 * @param params The DIP proof params.
 *
 * @returns The generated DIP proof.
 */
export async function generateDipIdentityProof({
  didUri: did,
  keyIds,
  includeWeb3Name,
  linkedAccounts,
  providerApi,
  version,
}: DipIdentityProofOpts): Promise<DipIdentityProofRes> {
  const proof = await providerApi.call.dipProvider.generateProof<
    Result<Codec, Codec>
  >({
    identifier: toChain(did),
    version,
    keys: keyIds.map((keyId) => keyId.substring(1)),
    accounts: linkedAccounts,
    shouldIncludeWeb3Name: includeWeb3Name,
  })

  if (proof.isErr) {
    throw new Error(providerApi.findError(proof.asErr.toHex()).docs.join("\n"))
  }

  // TODO: Better way to cast this?
  const okProof = proof.asOk.toJSON() as any

  return okProof
}

/**
 * The Provider options object provided when generating a DIP DID signature.
 */
export type DipDidSignatureProviderOpts = {
  /** The `DidUri` of the DIP subject that is performing the cross-chain operation. */
  didUri: DidUri
  /** The list of `Signers` to use to sign the cross-chain payload. */
  signer: SignExtrinsicCallback
  /** The `SignatureVerificationRelationship` to use from the provided DID Document to sign the cross-chain payload. */
  keyRelationship: VerificationKeyRelationship
}
/**
 * The Consumer options object provided when generating a DIP DID signature.
 */
export type DipDidSignatureConsumerOpts = {
  /** The runtime definition of an `AccountId`. */
  accountIdRuntimeType: string
  /** The `ApiPromise` instance. */
  api: ApiPromise
  /** The runtime definition of a `BlockNumber`. */
  blockNumberRuntimeType: string
  /** The `Call` to DID-authorize. */
  call: Call
  /** The runtime definition of the `IdentityDetails`. */
  identityDetailsRuntimeType: string
  /** The address of the submitter account on the consumer chain. */
  submitterAddress: KeyringPair["address"]
  /** The block number to use for the DID signature. If not provided, the latest best block number is used. */
  blockHeight?: BN
  /** The genesis hash to use for the DID signature. If not provided, it is retrieved at runtime. */
  genesisHash?: Hash
}
/**
 * The options object provided when generating a DIP DID signature.
 */
export type DipDidSignatureOpts = {
  consumer: DipDidSignatureConsumerOpts
  provider: DipDidSignatureProviderOpts
}
/**
 * The response object for DIP DID signature.
 */
export type DipDidSignatureRes = {
  blockNumber: BN
  signature: Uint8Array
  type: VerificationKeyType
}
/**
 * Generate a DID signature to be used in conjunction with a DIP proof to DID-authorize a cross-chain operation.
 *
 * @param params The signature generation parameters.

 * @returns The generated DIP proof.
 */
export async function generateDipDidSignature({
  provider: { didUri, signer, keyRelationship },
  consumer: {
    accountIdRuntimeType,
    api,
    blockNumberRuntimeType,
    call,
    identityDetailsRuntimeType,
    submitterAddress,
    // Optional
    blockHeight,
    genesisHash,
  },
}: DipDidSignatureOpts): Promise<DipDidSignatureRes> {
  const blockNumber: BN =
    blockHeight ?? (await api.query.system.number<any>()).toBn()
  const genesis = genesisHash ?? (await api.query.system.blockHash(0))
  const identityDetails = (
    await api.query.dipConsumer.identityEntries<Option<Codec>>(toChain(didUri))
  ).unwrapOr(api.createType(identityDetailsRuntimeType, null))

  const signaturePayload = api
    .createType(
      `(Call, ${identityDetailsRuntimeType}, ${accountIdRuntimeType}, ${blockNumberRuntimeType}, Hash)`,
      [call, identityDetails, submitterAddress, blockNumber, genesis],
    )
    .toU8a()
  const { signature, keyType } = await signer({
    data: signaturePayload,
    did: didUri,
    keyRelationship,
  })
  return {
    blockNumber,
    signature,
    type: keyType,
  }
}
