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
  DidKey,
} from "@kiltprotocol/types"
import type { ApiPromise } from "@polkadot/api"
import type { Hash } from "@polkadot/types/interfaces"
import type { Codec } from "@polkadot/types-codec/types"

/**
 * The options object provided when generating a DIP identity proof.
 */
export type DipIdentityProofOpts = {
  /** The `DID` of the subject. */
  didUri: DidUri
  /** The list of DID verification methods to include in the DIP proof and to reveal to the consumer chain. */
  keyIds: Array<DidKey["id"]>
  /** A flag indicating whether the web3name should be included in the DIP proof. */
  includeWeb3Name: boolean
  /** The list of accounts linked to the DID to include in the DIP proof and to reveal to the consumer chain. */
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
 * @returns The generated basic DIP proof that reveals the specified parts of the DID Document, optionally revealing its web3name and any linked accounts as specified.
 */
export async function generateDipIdentityProof({
  didUri,
  keyIds,
  includeWeb3Name,
  linkedAccounts,
  providerApi,
  version,
}: DipIdentityProofOpts): Promise<DipIdentityProofRes> {
  const proof = await providerApi.call.dipProvider.generateProof({
    identifier: toChain(didUri),
    version,
    proofKeys: keyIds.map((keyId) => keyId.substring(1)),
    accounts: linkedAccounts,
    shouldIncludeWeb3Name: includeWeb3Name,
  })

  if (proof.isErr) {
    throw new Error(providerApi.findError(proof.asErr.toHex()).docs.join("\n"))
  }

  return proof.asOk
}
