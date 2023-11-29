/**
 * Copyright (c) 2023, BOTLabs GmbH.
 *
 * This source code is licensed under the BSD 4-Clause "Original" license
 * found in the LICENSE file in the root directory of this source tree.
 */

import * as Kilt from "@kiltprotocol/sdk-js"
import { didCalls, types } from "@kiltprotocol/type-definitions"
import { ApiPromise, SubmittableResult, WsProvider } from "@polkadot/api"

import type { KeyringPair, SubmittableExtrinsic } from "@kiltprotocol/types"
import type {
  AnyNumber,
  ISubmittableResult,
  DefinitionsCall,
  RegistryTypes,
} from "@polkadot/types/types"

const dipProviderCalls: DefinitionsCall = {
  DipProvider: [
    {
      methods: {
        generate_proof: {
          description:
            "Generate a Merkle proof for the DIP protocol for the specified request parameters.",
          params: [
            {
              name: "request",
              type: "DipProofRequest",
            },
          ],
          type: "Result<CompleteMerkleProof, RuntimeApiDipProofError>",
        },
      },
      version: 1,
    },
  ],
  ...didCalls,
}
const dipTypes: RegistryTypes = {
  ...types,
  IdentityCommitmentVersion: "u16",
  // DipProvider state_call
  DipProofRequest: {
    identifier: "AccountId32",
    version: "IdentityCommitmentVersion",
    keys: "Vec<Hash>",
    accounts: "Vec<PalletDidLookupLinkableAccountLinkableAccountId>",
    shouldIncludeWeb3Name: "bool",
  },
  CompleteMerkleProof: {
    root: "MerkleRoot",
    proof: "MerkleProof",
  },
  MerkleRoot: "Hash",
  MerkleProof: {
    blinded: "BlindedLeaves",
    revealed: "RevealedLeaves",
  },
  BlindedLeaves: "Vec<BlindedValue>",
  BlindedValue: "Bytes",
  RevealedLeaves: "Vec<RevealedLeaf>",
  RevealedLeaf: {
    _enum: {
      DidKey: "(DidKeyMerkleKey, DidKeyMerkleValue)",
      Web3Name: "(Web3NameMerkleKey, Web3NameMerkleValue)",
      LinkedAccount: "(LinkedAccountMerkleKey, LinkedAccountMerkleValue)",
    },
  },
  DidKeyMerkleKey: "(KeyId, KeyRelationship)",
  KeyId: "Hash",
  KeyRelationship: {
    _enum: {
      Encryption: "Null",
      Verification: "VerificationRelationship",
    },
  },
  VerificationRelationship: {
    _enum: [
      "Authentication",
      "CapabilityDelegation",
      "CapabilityInvocation",
      "AssertionMethod",
    ],
  },
  DidKeyMerkleValue: "DidDidDetailsDidPublicKeyDetails",
  Web3NameMerkleKey: "Text",
  Web3NameMerkleValue: "BlockNumber",
  LinkedAccountMerkleKey: "PalletDidLookupLinkableAccountLinkableAccountId",
  LinkedAccountMerkleValue: "Null",
  RuntimeApiDipProofError: {
    _enum: {
      IdentityProvider: "LinkedDidIdentityProviderError",
      MerkleProof: "DidMerkleProofError",
    },
  },
  LinkedDidIdentityProviderError: {
    _enum: ["DidNotFound", "DidDeleted", "Internal"],
  },
  DidIdentityProviderError: {
    _enum: ["DidNotFound", "Internal"],
  },
  DidMerkleProofError: {
    _enum: [
      "UnsupportedVersion",
      "KeyNotFound",
      "LinkedAccountNotFound",
      "Web3NameNotFound",
      "Internal",
    ],
  },
}

export async function createProviderApi(address: string): Promise<ApiPromise> {
  return ApiPromise.create({
    provider: new WsProvider(address),
    runtime: dipProviderCalls,
    types: dipTypes,
  })
}

// Taken from the KILT SDK
export async function signAndSubmitTx(
  api: ApiPromise,
  tx: SubmittableExtrinsic,
  signer: KeyringPair,
  {
    tip,
    ...opts
  }: Partial<Kilt.SubscriptionPromise.Options> &
    Partial<{ tip: AnyNumber }> = {},
): Promise<ISubmittableResult> {
  const signedTx = await tx.signAsync(signer, { tip })
  return submitSignedTx(api, signedTx, opts)
}

// Taken from the KILT SDK
async function submitSignedTx(
  api: ApiPromise,
  tx: SubmittableExtrinsic,
  opts: Partial<Kilt.SubscriptionPromise.Options> = {},
): Promise<ISubmittableResult> {
  const {
    resolveOn = (result: ISubmittableResult) =>
      Kilt.Blockchain.IS_IN_BLOCK(result),
    rejectOn = (result: ISubmittableResult) =>
      Kilt.Blockchain.EXTRINSIC_FAILED(result) ||
      Kilt.Blockchain.IS_ERROR(result),
  } = opts

  const { promise, subscription } =
    Kilt.ChainHelpers.SubscriptionPromise.makeSubscriptionPromise({
      ...opts,
      resolveOn,
      rejectOn,
    })

  let latestResult: SubmittableResult | undefined
  const unsubscribe = await tx.send((result) => {
    latestResult = result
    subscription(result)
  })

  function handleDisconnect(): void {
    const result = new SubmittableResult({
      events: latestResult?.events || [],
      internalError: new Error("connection error"),
      status:
        latestResult?.status ||
        api.registry.createType("ExtrinsicStatus", "future"),
      txHash: api.registry.createType("Hash"),
    })
    subscription(result)
  }

  api.once("disconnected", handleDisconnect)

  try {
    return await promise
  } catch (e) {
    throw (
      Kilt.ChainHelpers.ErrorHandler.getExtrinsicError(
        e as ISubmittableResult,
      ) || e
    )
  } finally {
    unsubscribe()
    api.off("disconnected", handleDisconnect)
  }
}
