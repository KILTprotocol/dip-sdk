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
type ProviderStateRootProofOpts = {
  providerApi: ApiPromise
  relayApi: ApiPromise
  // Optional
  providerBlockHeight?: BN
}
/**
 * The response object containing the provider state root proof.
 */
type ProviderStateRootProofRes = {
  proof: ReadProof
  providerBlockHeight: BN
  relayBlockHeight: BN
}
/**
 * Generate a state proof that proofs the head of the specified parachain.
 *
 * @param params The state proof params.
 * @param params.providerApi The [[ApiPromise]] instance for the provider chain.
 * @param params.relayApi The [[ApiPromise]] instance for the relay chain.
 * @param params.providerBlockHeight [OPTIONAL] The block number on the provider chain to use for the state proof. If not provided, the latest finalized block number is used.
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
type DipCommitmentProofOpts = {
  didUri: DidUri
  providerApi: ApiPromise
  providerBlockHash: Hash
  version: number
}
/**
 * The response object for a DIP commitment proof.
 */
type DipCommitmentProofRes = {
  proof: ReadProof
}
/**
 * Generate a state proof that proofs the value of an identity commitment on the specified provider chain.
 *
 * @param params The state proof params.
 * @param params.did The [[Did]] of the subject.
 * @param params.providerApi The [[ApiPromise]] instance for the provider chain.
 * @param params.providerBlockHash The block hash on the provider chain to use for the state proof.
 * @param params.version The version of the identity commitment to generate the state proof for.
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
type DipIdentityProofOpts = {
  didUri: DidUri
  keyIds: Array<DidKey["id"]>
  includeWeb3Name: boolean
  linkedAccounts: readonly PalletDidLookupLinkableAccountLinkableAccountId[]
  providerApi: ApiPromise
  version: number
}
/**
 * The response object for a generated DIP proof.
 */
type DipIdentityProofRes = {
  proof: {
    blinded: Codec
    revealed: Codec
  }
  root: Hash
}
/**
 * Generate a DIP proof that reveals the specified information about the DID subject.
 *
 * @param params The DIP proof params.
 * @param params.did The [[Did]] of the subject.
 * @param params.keyIds The list of DID verification methods to include in the DIP proof and to reveal to the consumer chain.
 * @param params.includeWeb3Name A flag indicating whether the web3name should be included in the DIP proof.
 * @param params.linkedAccounts The list of accounts linked to the DID ot include in the DIP proof and to reveal to the consumer chain.
 * @param params.providerApi The [[ApiPromise]] instance for the provider chain.
 * @param params.version The version of the DIP proof to generate.
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
type DipDidSignatureProviderOpts = {
  didUri: DidUri
  signer: SignExtrinsicCallback
  keyRelationship: VerificationKeyRelationship
}
/**
 * The Consumer options object provided when generating a DIP DID signature.
 */
type DipDidSignatureConsumerOpts = {
  accountIdRuntimeType: string
  api: ApiPromise
  blockNumberRuntimeType: string
  call: Call
  identityDetailsRuntimeType: string
  submitterAddress: KeyringPair["address"]
  // Optional
  blockHeight?: BN
  genesisHash?: Hash
}
/**
 * The options object provided when generating a DIP DID signature.
 */
type DipDidSignatureOpts = {
  consumer: DipDidSignatureConsumerOpts
  provider: DipDidSignatureProviderOpts
}
/**
 * The response object for DIP DID signature.
 */
type DipDidSignatureRes = {
  blockNumber: BN
  signature: Uint8Array
  type: VerificationKeyType
}
/**
 * Generate a DID signature to be used in conjunction with a DIP proof to DID-authorize a cross-chain operation.
 *
 * @param params The DID signature parameters.
 * @param params.provider The provider-specific parameters.
 * @param params.provider.didDocument The [[DidDocument] of the DIP subject that is performing the cross-chain operation.
 * @param params.provider.signers The list of [[Signers]] to use to sign the cross-chain payload.
 * @param params.provider.verificationRelationship The [[SignatureVerificationRelationship]] to use from the provided DID Document to sign the cross-chain payload.
 * @param params.consumer The consumer-specific parameters.
 * @param params.consumer.accountIdRuntimeType The runtime definition of an `AccountId`.
 * @param params.consumer.api The [[ApiPromise]] instance.
 * @param params.consumer.blockNumberRuntimeType The runtime definition of a `BlockNumber`.
 * @param params.consumer.call The [[Call]] to DID-authorize.
 * @param params.consumer.identityDetailsRuntimeType The runtime definition of the `IdentityDetails`.
 * @param params.consumer.submitterAddress The address of the submitter account on the consumer chain.
 * @param params.consumer.blockHeight [OPTIONAL] The block number to use for the DID signature. If not provided, the latest best block number is used.
 * @param params.consumer.genesisHash [OPTIONAL] The genesis hash to use for the DID signature. If not provided, it is retrieved at runtime.
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
