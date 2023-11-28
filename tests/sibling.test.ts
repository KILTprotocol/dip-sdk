/**
 * Copyright (c) 2023, BOTLabs GmbH.
 *
 * This source code is licensed under the BSD 4-Clause "Original" license
 * found in the LICENSE file in the root directory of this source tree.
 */

import * as Kilt from "@kiltprotocol/sdk-js"
import { ApiPromise, WsProvider } from "@polkadot/api"
import { BN } from "bn.js"
import { ObjectBuilder } from "typescript-object-builder"
import { beforeAll, describe, it, beforeEach } from "vitest"

import { generateDipAuthorizedTxForSibling } from "../src/index.js"
import { createConsumerApi, createProviderApi } from "./utils.js"

import type { DipSiblingProofInput } from "../src/index.js"
import type { GetStoreTxSignCallback } from "@kiltprotocol/did"
import type { DidDocument, KiltAddress, VerificationKeyType } from "@kiltprotocol/types"
import type { Call } from "@polkadot/types/interfaces"

const partialSiblingBuilder =
  ObjectBuilder.new<DipSiblingProofInput>()
    .with('accountIdRuntimeType', 'AccountId32')
    .with('blockNumberRuntimeType', 'u32')
    .with('identityDetailsRuntimeType', 'Option<u128>')
const keyring = new Kilt.Utils.Keyring({ type: 'sr25519', ss58Format: Kilt.Utils.ss58Format })
const sudoKeypair = keyring.addFromUri('//Alice')

Kilt.ConfigService.set({ 'submitTxResolveOn': Kilt.Blockchain.IS_IN_BLOCK })

describe('V0', () => {
  let relayApi: ApiPromise
  let providerApi: ApiPromise
  let consumerApi: ApiPromise
  let submitterKeypair: Kilt.KeyringPair
  let did: DidDocument
  let didKeypair: Kilt.KeyringPair

  beforeAll(async () => {
    const [r, p, c] = await Promise.all([
      ApiPromise.create({ provider: new WsProvider('ws://127.0.0.1:32813') }),
      createProviderApi('ws://127.0.0.1:41231'),
      ApiPromise.create({ provider: new WsProvider('ws://127.0.0.1:45695') }),
    ])
    relayApi = r
    providerApi = p
    consumerApi = c

    Kilt.ConfigService.set({ api: providerApi })
  })

  beforeEach(async () => {
    const newSubmitterKeypair = keyring.addFromMnemonic(Kilt.Utils.Crypto.mnemonicGenerate())
    const balanceTransferTxOnProviderChain = providerApi.tx.balances.transfer(newSubmitterKeypair.address, 10 ** 15)
    const balanceTransferTxOnConsumerChain = consumerApi.tx.balances.transfer(newSubmitterKeypair.address, 10 ** 15)
    await Promise.all([
      Kilt.Blockchain.signAndSubmitTx(balanceTransferTxOnProviderChain, sudoKeypair),
      balanceTransferTxOnConsumerChain.signAndSend(sudoKeypair)
    ])
    const newDidKeypair = keyring.addFromMnemonic(Kilt.Utils.Crypto.mnemonicGenerate())
    // @ts-expect-error We know that the type is an "sr25519"
    const newLightDid = Kilt.Did.createLightDidDocument({ authentication: [{ ...newDidKeypair }] })
    const newFullDidUri = Kilt.Did.getFullDidUri(newLightDid.uri)
    const signCallback: GetStoreTxSignCallback = (async ({ data }) => ({ signature: await newDidKeypair.sign(data), keyType: newDidKeypair.type as VerificationKeyType }))
    const didCreationTx = await Kilt.Did.getStoreTx(newLightDid, newSubmitterKeypair.address as KiltAddress, signCallback)
    const web3NameTx = await Kilt.Did.authorizeTx(newFullDidUri, providerApi.tx.web3Names.claim(Kilt.Utils.UUID.generate().substring(2, 25)), signCallback, newSubmitterKeypair.address as KiltAddress, { txCounter: new BN(1) })
    const commitIdentityTx = await Kilt.Did.authorizeTx(newFullDidUri, providerApi.tx.dipProvider.commitIdentity(Kilt.Did.toChain(newFullDidUri), 0), signCallback, newSubmitterKeypair.address as KiltAddress, { txCounter: new BN(2) })
    const batchedTx = providerApi.tx.utility.batchAll([
      didCreationTx,
      web3NameTx,
      commitIdentityTx
    ])
    await Kilt.Blockchain.signAndSubmitTx(batchedTx, newSubmitterKeypair, { resolveOn: Kilt.Blockchain.IS_FINALIZED })
    const newFullDid = (await Kilt.Did.resolve(newFullDidUri))?.document as DidDocument
    submitterKeypair = newSubmitterKeypair
    did = newFullDid
    didKeypair = newDidKeypair
  }, 100_000)

  /*
  * TODO: Print the DID mnemonic so that it can be used in the DID CLI utility
  * Generate the extrinsic via the DID CLI and via the tests (using the block number used in the CLI execution), and check the differences.
  */

  it('Test successful call', async () => {
    const builder: typeof partialSiblingBuilder = Object.create(partialSiblingBuilder)

    const args = builder
      .with('call', consumerApi.tx.postIt.post('Hello, world!').method as Call)
      .with('consumerApi', consumerApi)
      .with('includeWeb3Name', true)
      .with('keyIds', [did.authentication[0].id])
      .with('keyRelationship', 'authentication')
      .with('didUri', did.uri)
      .with('proofVersion', 0)
      .with('providerApi', providerApi)
      .with('relayApi', relayApi)
      .with('signer', (async ({ data }) => ({ signature: await didKeypair.sign(data), keyType: didKeypair.type as VerificationKeyType })))
      // .with('submitterAddress', submitterKeypair.address)
      .with('submitterAddress', sudoKeypair.address)
      .with('providerBlockHeight', 1971)
      .build()

    const crossChainTx = await generateDipAuthorizedTxForSibling(args)
    console.log(crossChainTx.toHex())
    // await crossChainTx.signAndSend(submitterKeypair)
  }, 36_000)
}, 100_000)
