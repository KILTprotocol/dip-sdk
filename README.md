[![](https://user-images.githubusercontent.com/39338561/122415864-8d6a7c00-cf88-11eb-846f-a98a936f88da.png)](https://kilt.io)

![Lint and Test](https://github.com/KILTprotocol/sdk-js/workflows/Lint%20and%20Test/badge.svg)

# KILT DIP

A cross-chain DID feature that allows KILT DID owners to DID-authorize extrinsics on other parachains and relaychains without bridging their full DID state.

More documentation is coming!

## Installation

NPM:

```
npm install @kiltprotocol/dip-sdk
```

YARN:

```
yarn add @kiltprotocol/dip-sdk
```

## End-to-end testing

The end-to-end testing use a Zombienet-based setup with a Kubernetes provider.
Hence, a Kubernetes cluster, e.g., [minikube](https://minikube.sigs.k8s.io/docs/start/) must be installed on the machine where the tests are to be executed.
For more information on how to set up the machine to spawn Zombienet-based network, please refer to the [official Zombienet repository](https://github.com/paritytech/zombienet).

### Environment configuration

The Zombienet deployment relies on a number of environment variables, which are:

- `RELAY_IMAGE`: The Docker image for relaychain nodes.
- `RELAY_ALICE_RPC`: The RPC port for the `relay-alice` relaychain node.
- `PROVIDER_IMAGE`: The Docker image for the DIP provider nodes.
- `PROVIDER_ALICE_RPC`: The RPC port for the `provider-alice` provider node.
- `CONSUMER_IMAGE`: The Docker image for the DIP consumer nodes.
- `CONSUMER_ALICE_RPC`: The RPC port for the `consumer-alice` consumer node.

A series of default values is sourced from the `tests/.env.test` file.

### Test execution

Test execution requires the following steps:

1. Switch to the expected Node version with `nvm use`.
2. Install the repo dependencies with `yarn install`.
3. Set up the environment variables as explained above.
4. Spin up the Zombienet network with `test:e2e:start-network:peregrine-provider:develop` or `test:e2e:start-network:dip-template-provider:develop`.
5. In a new shell session, run the end-to-end tests with `yarn test:e2e:peregrine-provider` or `yarn test:e2e:dip-template-provider`.
6. [OPTIONAL] Tear down the network by killing the process started at step 4.
