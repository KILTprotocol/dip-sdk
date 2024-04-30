/**
 * Copyright (c) 2024, BOTLabs GmbH.
 *
 * This source code is licensed under the BSD 4-Clause "Original" license
 * found in the LICENSE file in the root directory of this source tree.
 */

import { setTimeout } from "timers/promises"

import * as Kilt from "@kiltprotocol/sdk-js"
import { ApiPromise, Keyring, WsProvider } from "@polkadot/api"
import { BN } from "@polkadot/util"
import { blake2AsHex } from "@polkadot/util-crypto"
import dotenv from "dotenv"
import { beforeAll, describe, it, expect } from "vitest"

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

import { signAndSubmitTx, withCrossModuleSystemImport } from "../utils.js"

dotenv.config({
  path: "tests/peregrine-dip-consumer-template/.env.develop.test",
})

const baseConfig: Pick<
  DipSiblingProofInput,
  | "accountIdRuntimeType"
  | "blockNumberRuntimeType"
  | "identityDetailsRuntimeType"
> = {
  accountIdRuntimeType: "AccountId32",
  blockNumberRuntimeType: "u64",
  identityDetailsRuntimeType: "Option<u128>",
}
const web3NameRuntimeType = "Text"
const keyring = new Kilt.Utils.Keyring({
  type: "sr25519",
  ss58Format: Kilt.Utils.ss58Format,
})
const providerAndConsumerSudoKeypair = keyring.addFromUri("//Alice")

Kilt.ConfigService.set({ submitTxResolveOn: Kilt.Blockchain.IS_IN_BLOCK })

const relayAddress = `ws://127.0.0.1:${process.env["RELAY_ALICE_RPC"]}`
const providerAddress = `ws://127.0.0.1:${process.env["PROVIDER_ALICE_RPC"]}`
const consumerAddress = `ws://127.0.0.1:${process.env["CONSUMER_ALICE_RPC"]}`

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
      Kilt.connect(providerAddress),
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
    let lastTestSetupProviderBlockNumber: BN
    let testConfig: typeof v0Config &
      Pick<
        DipSiblingProofInput,
        | "didUri"
        | "signer"
        | "keyIds"
        | "keyRelationship"
        | "includeWeb3Name"
        | "submitterAddress"
        | "linkedAccounts"
      >

    beforeAll(async () => {
      const { providerApi, consumerApi } = v0Config
      const newSubmitterKeypair = keyring.addFromMnemonic(
        Kilt.Utils.Crypto.mnemonicGenerate(),
      )
      const providerUnit = "0".repeat(16)
      const consumerUnit = "0".repeat(13)
      const balanceTransferTxOnProviderChain = providerApi.tx.balances.transfer(
        newSubmitterKeypair.address,
        `1${providerUnit}`,
      )
      const balanceTransferTxOnConsumerChain = consumerApi.tx.balances.transfer(
        newSubmitterKeypair.address,
        `1${consumerUnit}`,
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
      const newKeyAgreementKeys = [...Array(10)].map(() =>
        Kilt.Utils.Crypto.makeEncryptionKeypairFromSeed(
          Kilt.Utils.Crypto.mnemonicToMiniSecret(
            Kilt.Utils.Crypto.mnemonicGenerate(),
          ),
        ),
      )
      const newKeyAgreementKeysTxs = await Promise.all(
        newKeyAgreementKeys.map((k) =>
          providerApi.tx.did.addKeyAgreementKey(Kilt.Did.publicKeyToChain(k)),
        ),
      )
      const signedKeyAgreements = await Kilt.Did.authorizeTx(
        newFullDidUri,
        providerApi.tx.utility.batchAll(newKeyAgreementKeysTxs),
        signCallback,
        newSubmitterKeypair.address as KiltAddress,
        { txCounter: new BN(1) },
      )
      const newAttestationKey = new Keyring({
        type: "ed25519",
      }).addFromMnemonic(Kilt.Utils.Crypto.mnemonicGenerate())
      const newAttestationKeyTx = (() => {
        return providerApi.tx.did.setAttestationKey(
          Kilt.Did.publicKeyToChain({
            publicKey: newAttestationKey.publicKey,
            type: "ed25519",
          }),
        )
      })()
      const signedNewAttestation = await Kilt.Did.authorizeTx(
        newFullDidUri,
        newAttestationKeyTx,
        signCallback,
        newSubmitterKeypair.address as KiltAddress,
        { txCounter: new BN(2) },
      )
      const newDelegationKey = new Keyring({ type: "ed25519" }).addFromMnemonic(
        Kilt.Utils.Crypto.mnemonicGenerate(),
      )
      const newDelegationKeyTx = (() => {
        return providerApi.tx.did.setDelegationKey(
          Kilt.Did.publicKeyToChain({
            publicKey: newDelegationKey.publicKey,
            type: "ed25519",
          }),
        )
      })()
      const signedNewDelegation = await Kilt.Did.authorizeTx(
        newFullDidUri,
        newDelegationKeyTx,
        signCallback,
        newSubmitterKeypair.address as KiltAddress,
        { txCounter: new BN(3) },
      )
      const linkedAccounts = [...Array(10)].map(() =>
        new Keyring({ type: "ed25519" }).addFromMnemonic(
          Kilt.Utils.Crypto.mnemonicGenerate(),
        ),
      )
      const linkAccountTxs = await Promise.all(
        linkedAccounts.map(async (acc) => {
          const functionArgs = await Kilt.Did.associateAccountToChainArgs(
            acc.address,
            newFullDidUri,
            async (input) => acc.sign(input, { withType: true }),
          )
          return providerApi.tx.didLookup.associateAccount(...functionArgs)
        }),
      )
      const signedLinkedAccounts = await Kilt.Did.authorizeTx(
        newFullDidUri,
        providerApi.tx.utility.batchAll(linkAccountTxs),
        signCallback,
        newSubmitterKeypair.address as KiltAddress,
        { txCounter: new BN(4) },
      )
      const newWeb3Name = Kilt.Utils.UUID.generate().substring(2, 25)
      const web3NameTx = await Kilt.Did.authorizeTx(
        newFullDidUri,
        providerApi.tx.web3Names.claim(newWeb3Name),
        signCallback,
        newSubmitterKeypair.address as KiltAddress,
        { txCounter: new BN(5) },
      )
      const commitIdentityTx = await Kilt.Did.authorizeTx(
        newFullDidUri,
        providerApi.tx.dipProvider.commitIdentity(
          Kilt.Did.toChain(newFullDidUri),
          0,
        ),
        signCallback,
        newSubmitterKeypair.address as KiltAddress,
        { txCounter: new BN(6) },
      )
      const batchedTx = providerApi.tx.utility.batchAll([
        didCreationTx,
        signedKeyAgreements,
        signedNewAttestation,
        signedNewDelegation,
        signedLinkedAccounts,
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
      ).toBn()
      const newFullDid = (await Kilt.Did.resolve(newFullDidUri))
        ?.document as DidDocument
      submitterKeypair = newSubmitterKeypair
      did = newFullDid
      web3Name = newWeb3Name
      didKeypair = newDidKeypair

      const accs = (
        await providerApi.call.did.query(Kilt.Did.toChain(newFullDidUri))
      ).unwrap().accounts

      testConfig = {
        ...v0Config,
        didUri: did.uri,
        signer: async ({ data }) => ({
          signature: await didKeypair.sign(data),
          keyType: didKeypair.type as VerificationKeyType,
        }),
        keyIds: [
          did.authentication[0].id,
          ...did.keyAgreement!.map((k) => k.id),
          did.capabilityDelegation![0].id,
          did.assertionMethod![0].id,
        ],
        keyRelationship: "authentication",
        includeWeb3Name: true,
        submitterAddress: submitterKeypair.address,
        linkedAccounts: accs,
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
              .createType(
                `(${
                  config.blockNumberRuntimeType as string
                }, ${web3NameRuntimeType}, Bytes)`,
                [blockNumber, web3Name, postText],
              )
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
            providerBlockHeight: lastTestSetupProviderBlockNumber,
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
              .createType(
                `(${
                  config.blockNumberRuntimeType as string
                }, ${web3NameRuntimeType}, Bytes)`,
                [blockNumber, web3Name, postText],
              )
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
