/**
 * Copyright (c) 2023, BOTLabs GmbH.
 *
 * This source code is licensed under the BSD 4-Clause "Original" license
 * found in the LICENSE file in the root directory of this source tree.
 */

// TODO: Push new Docker images baeing built on the kilt-node, update the Zombienet configuration and try again

import * as Kilt from "@kiltprotocol/sdk-js"
import { ApiPromise, WsProvider } from "@polkadot/api"
import { ObjectBuilder } from "typescript-object-builder"
import { beforeAll, describe, it, beforeEach } from "vitest"

import { createProviderApi } from './utils.js'

import type { DipSiblingProofInput } from '@kiltprotocol/dip-sdk'
import type { DidDocument, KiltAddress, SignExtrinsicCallback, VerificationKeyType } from "@kiltprotocol/types"
import { GetStoreTxSignCallback } from "@kiltprotocol/did"

const partialSiblingBuilder =
  ObjectBuilder.new<DipSiblingProofInput>()
    .with('accountIdRuntimeType', 'AccountId32')
    .with('blockNumberRuntimeType', 'u32')
    .with('identityDetailsRuntimeType', 'Option<u128>')
const keyring = new Kilt.Utils.Keyring({ type: 'sr25519', ss58Format: Kilt.Utils.ss58Format })
const sudoKeypair = keyring.addFromUri('//Alice')

Kilt.ConfigService.set({ 'submitTxResolveOn': Kilt.Blockchain.IS_IN_BLOCK })

describe('V0', () => {
  let v0SiblingBuilder: typeof partialSiblingBuilder = Object.create(partialSiblingBuilder)

  let relayApi: ApiPromise
  let providerApi: ApiPromise
  let consumerApi: ApiPromise
  let submitterKeypair: Kilt.KeyringPair
  let did: DidDocument
  let didKeypair: Kilt.KeyringPair

  beforeAll(async () => {
    relayApi = await ApiPromise.create({ provider: new WsProvider('ws://127.0.0.1:35265') })
    providerApi = await Kilt.connect('ws://127.0.0.1:43931')
    consumerApi = await ApiPromise.create({ provider: new WsProvider('ws://127.0.0.1:42107') })

    v0SiblingBuilder = v0SiblingBuilder.with('relayApi', relayApi).with('providerApi', providerApi).with('consumerApi', consumerApi)
  })

  beforeEach(async () => {
    const newSubmitterKeypair = keyring.addFromMnemonic(Kilt.Utils.Crypto.mnemonicGenerate())
    const balanceTransferTx = providerApi.tx.balances.transfer(newSubmitterKeypair.address, 10 ** 15)
    await Kilt.Blockchain.signAndSubmitTx(balanceTransferTx, sudoKeypair)
    const newDidKeypair = keyring.addFromMnemonic(Kilt.Utils.Crypto.mnemonicGenerate())
    // @ts-expect-error We know that the type is an "sr25519"
    const newLightDid = Kilt.Did.createLightDidDocument({ authentication: [{ ...newDidKeypair }] })
    const newFullDidUri = Kilt.Did.getFullDidUri(newLightDid.uri)
    const signCallback: GetStoreTxSignCallback = (async ({ data }) => ({ signature: await newDidKeypair.sign(data), keyType: newDidKeypair.type as VerificationKeyType }))
    const didCreationTx = await Kilt.Did.getStoreTx(newLightDid, newSubmitterKeypair.address as KiltAddress, signCallback)
    const web3NameTx = await Kilt.Did.authorizeTx(newFullDidUri, providerApi.tx.web3Names.claim('test'), signCallback, newSubmitterKeypair.address as KiltAddress)
    const commitIdentityTx = await Kilt.Did.authorizeTx(newFullDidUri, providerApi.tx.dipProvider.commitIdentity(Kilt.Did.toChain(newFullDidUri), 0), signCallback, newSubmitterKeypair.address as KiltAddress)
    const batchedTx = providerApi.tx.utility.batchAll([
      didCreationTx,
      web3NameTx,
      commitIdentityTx
    ])
    await Kilt.Blockchain.signAndSubmitTx(batchedTx, newSubmitterKeypair, { resolveOn: Kilt.Blockchain.IS_FINALIZED })
    const newFullDid = (await Kilt.Did.resolve(newLightDid.uri))?.document as DidDocument
    submitterKeypair = newSubmitterKeypair
    did = newFullDid
    didKeypair = newDidKeypair
  }, 60_000)

  it('Test successful call', async () => {

    await ApiPromise.create({ provider: new WsProvider('ws://127.0.0.1:35265') })
  })
})