/**
 * Copyright (c) 2024, BOTLabs GmbH.
 *
 * This source code is licensed under the BSD 4-Clause "Original" license
 * found in the LICENSE file in the root directory of this source tree.
 */

import { toChain } from "@kiltprotocol/did"
import { BN } from "@polkadot/util"

import type {
  DidUri,
  SignExtrinsicCallback,
  VerificationKeyRelationship,
  VerificationKeyType,
} from "@kiltprotocol/types"
import type { ApiPromise } from "@polkadot/api"
import type { KeyringPair } from "@polkadot/keyring/types"
import type { Call, Hash } from "@polkadot/types/interfaces"
import type { Option } from "@polkadot/types-codec"
import type { Codec } from "@polkadot/types-codec/types"

const defaultValues = {
  accountIdRuntimeType: "AccountId",
  blockNumberRuntimeType: "u64",
  identityDetailsRuntimeType: "Option<u128>",
  validUntilOffset: new BN(50),
}

/**
 * The Provider options object provided when generating a time-bound DID signature.
 */
export type TimeBoundDidSignatureProviderOpts = {
  /** The `DidUri` of the DIP subject that is performing the cross-chain operation. */
  didUri: DidUri
  /** The `SignatureVerificationRelationship` to use from the provided DID Document to sign the cross-chain payload. */
  keyRelationship: VerificationKeyRelationship
  /** The list of `Signers` to use to sign the cross-chain payload. */
  signer: SignExtrinsicCallback
}
/**
 * The Consumer options object provided when generating a DIP DID signature.
 */
export type TimeBoundDidSignatureConsumerOpts = {
  /** The runtime definition of an `AccountId`. If not provided, the `AccountId` type is used. */
  accountIdRuntimeType?: string
  /** The `ApiPromise` instance. */
  api: ApiPromise
  /** The runtime definition of a `BlockNumber`. If not provided, the `u64` type is used. */
  blockNumberRuntimeType?: string
  /** The `Call` to DID-authorize. */
  call: Call
  /** The genesis hash to use for the DID signature. If not provided, it is retrieved at runtime. */
  genesisHash?: Hash
  /** The runtime definition of the `IdentityDetails`. If not provided, the `Option<u128>` type is used. */
  identityDetailsRuntimeType?: string
  /** The address of the submitter account on the consumer chain. */
  submitterAddress: KeyringPair["address"]
  /** The block number until which the DID signature is to be considered fresh. If not provided, the latest best block number + an offset of 50 is used. */
  validUntil?: BN
}
/**
 * The options object provided when generating a DIP DID signature.
 */
export type TimeBoundDidSignatureOpts = {
  consumer: TimeBoundDidSignatureConsumerOpts
  provider: TimeBoundDidSignatureProviderOpts
}
/**
 * The response object for DIP DID signature.
 */
export type TimeBoundDidSignatureRes = {
  signature: Uint8Array
  type: VerificationKeyType
  validUntil: BN
}
/**
 * Generate a DID signature to be used in conjunction with a DIP proof to DID-authorize a cross-chain operation.
 *
 * @param params The signature generation parameters.

 * @returns The generated DIP proof.
 */
export async function generateTimeBoundDipDidSignature({
  provider: { didUri, signer, keyRelationship },
  consumer: {
    api,
    call,
    submitterAddress,
    // Optional
    accountIdRuntimeType,
    blockNumberRuntimeType,
    genesisHash,
    identityDetailsRuntimeType,
    validUntil,
  },
}: TimeBoundDidSignatureOpts): Promise<TimeBoundDidSignatureRes> {
  const blockNumber: BN =
    validUntil ??
    (await api.query.system.number())
      .toBn()
      .add(defaultValues.validUntilOffset)
  const genesis = genesisHash ?? (await api.query.system.blockHash(0))
  const actualIdentityDetailsRuntimeType = identityDetailsRuntimeType ?? defaultValues.identityDetailsRuntimeType
  const identityDetails = (
    await api.query.dipConsumer.identityEntries<Option<Codec>>(toChain(didUri))
  ).unwrapOr(api.createType(actualIdentityDetailsRuntimeType, null))

  const signaturePayload = api
    .createType(
      `(Call, ${identityDetailsRuntimeType}, ${accountIdRuntimeType ?? defaultValues.accountIdRuntimeType}, ${blockNumberRuntimeType ?? defaultValues.blockNumberRuntimeType}, Hash)`,
      [call, identityDetails, submitterAddress, blockNumber, genesis],
    )
    .toU8a()
  const { signature, keyType } = await signer({
    data: signaturePayload,
    did: didUri,
    keyRelationship,
  })
  return {
    validUntil: blockNumber,
    signature,
    type: keyType,
  }
}

export function signatureToCodec(signature: TimeBoundDidSignatureRes): Record<string, Codec> {
  const encodedSignature = {
    signature: {
      [signature.type]: signature.signature
    },
    validUntil: signature.validUntil
  } as any as Codec
  return {
    signature: encodedSignature
  }
}
