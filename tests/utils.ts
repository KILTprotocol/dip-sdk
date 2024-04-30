/**
 * Copyright (c) 2024, BOTLabs GmbH.
 *
 * This source code is licensed under the BSD 4-Clause "Original" license
 * found in the LICENSE file in the root directory of this source tree.
 */

import * as Kilt from "@kiltprotocol/sdk-js"
import { SubmittableResult } from "@polkadot/api"
import { describe } from "vitest"

import type { KeyringPair, SubmittableExtrinsic } from "@kiltprotocol/types"
import type { ApiPromise } from "@polkadot/api"
import type {
  AnyNumber,
  ISubmittableResult,
} from "@polkadot/types/types"

export async function createProviderApi(address: string): Promise<ApiPromise> {
  return Kilt.connect(address)
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
