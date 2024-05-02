/**
 * Copyright (c) 2024, BOTLabs GmbH.
 *
 * This source code is licensed under the BSD 4-Clause "Original" license
 * found in the LICENSE file in the root directory of this source tree.
 */

import { toChain } from "@kiltprotocol/did"

import type { DidUri } from "@kiltprotocol/types"
import type { ApiPromise } from "@polkadot/api"
import type { Hash, ReadProof } from "@polkadot/types/interfaces"

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
 * Generate a state proof for the value of a DIP identity commitment of a specific version on the specified provider chain.
 *
 * For more details about what each `version` provides, please refer to our docs.
 *
 * @param params The state proof params.
 *
 * @returns The generated state proof.
 */
export async function generateDipCommitmentProof({
  didUri,
  providerApi,
  providerBlockHash,
  version,
}: DipCommitmentProofOpts): Promise<DipCommitmentProofRes> {
  const proof = await providerApi.rpc.state.getReadProof(
    [
      providerApi.query.dipProvider.identityCommitments.key(
        toChain(didUri),
        version,
      ),
    ],
    providerBlockHash,
  )

  return { proof }
}
