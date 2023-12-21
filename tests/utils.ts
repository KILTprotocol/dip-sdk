/**
 * Copyright (c) 2023, Built on KILT
 * All rights reserved. Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. All advertising materials mentioning features or use of this software must display the following acknowledgement: Built on KILT.
 * 4. Neither the name of KILT nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY BOTLABS GMBH  ''AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL BOTLABS GMBH BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import * as Kilt from "@kiltprotocol/sdk-js"
import { didCalls, types } from "@kiltprotocol/type-definitions"
import { ApiPromise, SubmittableResult, WsProvider } from "@polkadot/api"
import { describe } from "vitest"

import type { KeyringPair, SubmittableExtrinsic } from "@kiltprotocol/types"
import type {
  AnyNumber,
  ISubmittableResult,
  DefinitionsCall,
  RegistryTypes,
} from "@polkadot/types/types"

import { dipProviderCalls } from "../src/runtime.js"

const dipProviderTemplateRuntimeCalls: DefinitionsCall = {
  ...dipProviderCalls,
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
    runtime: dipProviderTemplateRuntimeCalls,
    types: dipTypes,
  })
}

// Taken from the KILT SDK: https://github.com/KILTprotocol/sdk-js/blob/c4ab492812d19169532a399b57dd1bd013a61570/packages/chain-helpers/src/blockchain/Blockchain.ts#L179
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

// Taken from the KILT SDK: https://github.com/KILTprotocol/sdk-js/blob/c4ab492812d19169532a399b57dd1bd013a61570/packages/chain-helpers/src/blockchain/Blockchain.ts#L116
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

const testForBothModules = describe.each([
  { module: "ESM", importer: async (module: string) => import(module) },
  { module: "CJS", importer: async (module: string) => require(module) },
])

/**
 * Loads `module` and passes the implementation to the `tests` closure.
 * All tests defined in this closure are run twice; once using the module implementation
 * as loaded by `require()` and once as loaded by `import()`.
 * Note that some features, such as inline snapshots, are unavailable in these tests.
 *
 * @param module The module to be loaded.
 * @param tests A function defining tests using vitest's `it` or `test`. Receives the loaded module implementation as its first argument.
 */
export function withCrossModuleSystemImport<mod = any>(
  module: string,
  tests: (imported: mod) => void | Promise<void>,
): void {
  return testForBothModules("$module", async ({ importer }) => {
    const imported = await importer(module)
    return tests(imported)
  })
}
