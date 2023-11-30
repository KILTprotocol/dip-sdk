/**
 * Copyright (c) 2023, BOTLabs GmbH.
 *
 * This source code is licensed under the BSD 4-Clause "Original" license
 * found in the LICENSE file in the root directory of this source tree.
 */

import { setTimeout } from "timers/promises"

import * as Kilt from "@kiltprotocol/sdk-js"
import { ApiPromise, WsProvider } from "@polkadot/api"
import { blake2AsHex } from "@polkadot/util-crypto"
import { BN } from "bn.js"
import dotenv from "dotenv"
import { beforeAll, describe, it, expect } from "vitest"

import {
  createProviderApi,
  signAndSubmitTx,
  withCrossModuleSystemImport,
} from "./utils.js"

import type { GetStoreTxSignCallback, Web3Name } from "@kiltprotocol/did"
import type { DipSiblingProofInput } from "@kiltprotocol/dip-sdk"
import type {
  DidDocument,
  KiltAddress,
  VerificationKeyType,
} from "@kiltprotocol/types"
import type { Option } from "@polkadot/types/codec"
import type { Call } from "@polkadot/types/interfaces"
import type { Codec } from "@polkadot/types/types"

dotenv.config({ path: ".env.test" })

const baseConfig: Pick<
  DipSiblingProofInput,
  | "accountIdRuntimeType"
  | "blockNumberRuntimeType"
  | "identityDetailsRuntimeType"
> = {
  accountIdRuntimeType: "AccountId32",
  blockNumberRuntimeType: "u32",
  identityDetailsRuntimeType: "Option<u128>",
}
const web3NameRuntimeType = "Text"
const keyring = new Kilt.Utils.Keyring({
  type: "sr25519",
  ss58Format: Kilt.Utils.ss58Format,
})
const providerAndConsumerSudoKeypair = keyring.addFromUri("//Alice")

Kilt.ConfigService.set({ submitTxResolveOn: Kilt.Blockchain.IS_IN_BLOCK })

const relayAddress = process.env["RELAY_ADDRESS"] as string
const providerAddress = process.env["PROVIDER_ADDRESS"] as string
const consumerAddress = process.env["CONSUMER_ADDRESS"] as string

describe("V0", () => {
  // beforeAll
  let v0Config: typeof baseConfig &
    Pick<
      DipSiblingProofInput,
      "consumerApi" | "proofVersion" | "providerApi" | "relayApi"
    >

  beforeAll(async () => {
    const [relayApi, providerApi, consumerApi] = await Promise.all([
      ApiPromise.create({ provider: new WsProvider(relayAddress) }),
      createProviderApi(providerAddress),
      ApiPromise.create({ provider: new WsProvider(consumerAddress) }),
    ])
    Kilt.ConfigService.set({ api: providerApi })

    v0Config = {
      ...baseConfig,
      consumerApi,
      proofVersion: 0,
      providerApi,
      relayApi,
    }
  })

  describe("CJS + ESM", () => {
    // beforeAll
    let submitterKeypair: Kilt.KeyringPair
    let did: DidDocument
    let web3Name: Web3Name
    let didKeypair: Kilt.KeyringPair
    let lastTestSetupProviderBlockNumber: number
    let testConfig: typeof v0Config &
      Pick<
        DipSiblingProofInput,
        | "didUri"
        | "signer"
        | "keyIds"
        | "keyRelationship"
        | "includeWeb3Name"
        | "submitterAddress"
      >

    beforeAll(async () => {
      const { providerApi, consumerApi } = v0Config
      const newSubmitterKeypair = keyring.addFromMnemonic(
        Kilt.Utils.Crypto.mnemonicGenerate(),
      )
      const balanceTransferTxOnProviderChain = providerApi.tx.balances.transfer(
        newSubmitterKeypair.address,
        10 ** 15,
      )
      const balanceTransferTxOnConsumerChain = consumerApi.tx.balances.transfer(
        newSubmitterKeypair.address,
        10 ** 15,
      )
      await Promise.all([
        Kilt.Blockchain.signAndSubmitTx(
          balanceTransferTxOnProviderChain,
          providerAndConsumerSudoKeypair,
        ),
        balanceTransferTxOnConsumerChain.signAndSend(
          providerAndConsumerSudoKeypair,
        ),
      ])
      const newDidKeypair = keyring.addFromMnemonic(
        Kilt.Utils.Crypto.mnemonicGenerate(),
      )
      const newLightDid = Kilt.Did.createLightDidDocument({
        // @ts-expect-error We know that the type is an "sr25519"
        authentication: [{ ...newDidKeypair }],
      })
      const newFullDidUri = Kilt.Did.getFullDidUri(newLightDid.uri)
      const signCallback: GetStoreTxSignCallback = async ({ data }) => ({
        signature: await newDidKeypair.sign(data),
        keyType: newDidKeypair.type as VerificationKeyType,
      })
      const didCreationTx = await Kilt.Did.getStoreTx(
        newLightDid,
        newSubmitterKeypair.address as KiltAddress,
        signCallback,
      )
      const newWeb3Name = Kilt.Utils.UUID.generate().substring(2, 25)
      const web3NameTx = await Kilt.Did.authorizeTx(
        newFullDidUri,
        providerApi.tx.web3Names.claim(newWeb3Name),
        signCallback,
        newSubmitterKeypair.address as KiltAddress,
        { txCounter: new BN(1) },
      )
      const commitIdentityTx = await Kilt.Did.authorizeTx(
        newFullDidUri,
        providerApi.tx.dipProvider.commitIdentity(
          Kilt.Did.toChain(newFullDidUri),
          0,
        ),
        signCallback,
        newSubmitterKeypair.address as KiltAddress,
        { txCounter: new BN(2) },
      )
      const batchedTx = providerApi.tx.utility.batchAll([
        didCreationTx,
        web3NameTx,
        commitIdentityTx,
      ])
      await Kilt.Blockchain.signAndSubmitTx(batchedTx, newSubmitterKeypair, {
        resolveOn: Kilt.Blockchain.IS_FINALIZED,
      })
      // FIXME: Timeout needed since it seems `.getFinalizedHead()` still returns the previous block number as the latest finalized, even if we wait for finalization above. This results in invalid storage proofs.
      await setTimeout(12_000)
      lastTestSetupProviderBlockNumber = (
        await providerApi.query.system.number()
      ).toNumber()
      const newFullDid = (await Kilt.Did.resolve(newFullDidUri))
        ?.document as DidDocument
      submitterKeypair = newSubmitterKeypair
      did = newFullDid
      web3Name = newWeb3Name
      didKeypair = newDidKeypair

      testConfig = {
        ...v0Config,
        didUri: did.uri,
        signer: async ({ data }) => ({
          signature: await didKeypair.sign(data),
          keyType: didKeypair.type as VerificationKeyType,
        }),
        keyIds: [did.authentication[0].id],
        keyRelationship: "authentication",
        includeWeb3Name: true,
        submitterAddress: submitterKeypair.address,
      }
    }, 96_000)

    withCrossModuleSystemImport<typeof import("@kiltprotocol/dip-sdk")>(
      "..",
      async (DipSdk) => {
        it("Successful posts on the consumer's PostIt pallet using by default the latest provider finalized block", async () => {
          const { consumerApi } = testConfig
          const postText = "Hello, world!"
          const config: DipSiblingProofInput = {
            ...testConfig,
            call: consumerApi.tx.postIt.post(postText).method as Call,
          }

          const crossChainTx =
            await DipSdk.generateDipAuthorizedTxForSibling(config)
          const { status } = await signAndSubmitTx(
            consumerApi,
            crossChainTx,
            submitterKeypair,
          )
          expect(
            status.isInBlock,
            "Status of submitted tx should be in block.",
          ).toBe(true)
          const blockHash = status.asInBlock
          const blockNumber = (await consumerApi.rpc.chain.getHeader(blockHash))
            .number
          // The example PostIt pallet generates the storage key for a post by hashing (block number, submitter's username, content of the post).
          const postKey = blake2AsHex(
            consumerApi
              .createType(`(BlockNumber, ${web3NameRuntimeType}, Bytes)`, [
                blockNumber,
                web3Name,
                postText,
              ])
              .toHex(),
          )
          const postEntry =
            await consumerApi.query.postIt.posts<Option<Codec>>(postKey)
          expect(
            postEntry.isSome,
            "Post should successfully be stored on the chain",
          ).toBe(true)
        })

        it("Successful posts on the consumer's PostIt pallet using the same block as before", async () => {
          const { consumerApi } = testConfig
          const postText = "Hello, world!"
          const config: DipSiblingProofInput = {
            ...testConfig,
            call: consumerApi.tx.postIt.post(postText).method as Call,
            // Set explicit block number for the DIP proof
            providerBlockHeight: lastTestSetupProviderBlockNumber
          }

          const crossChainTx =
            await DipSdk.generateDipAuthorizedTxForSibling(config)
          const { status } = await signAndSubmitTx(
            consumerApi,
            crossChainTx,
            submitterKeypair,
          )
          expect(
            status.isInBlock,
            "Status of submitted tx should be in block.",
          ).toBe(true)
          const blockHash = status.asInBlock
          const blockNumber = (await consumerApi.rpc.chain.getHeader(blockHash))
            .number
          // The example PostIt pallet generates the storage key for a post by hashing (block number, submitter's username, content of the post).
          const postKey = blake2AsHex(
            consumerApi
              .createType(`(BlockNumber, ${web3NameRuntimeType}, Bytes)`, [
                blockNumber,
                web3Name,
                postText,
              ])
              .toHex(),
          )
          const postEntry =
            await consumerApi.query.postIt.posts<Option<Codec>>(postKey)
          expect(
            postEntry.isSome,
            "Post should successfully be stored on the chain",
          ).toBe(true)
        })
      },
    )
  })
}, 60_000)
