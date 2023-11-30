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

### Test execution

Test execution requires the following steps:

1. Switch to the expected Node version with `nvm use`
2. Install the repo dependencies with `yarn install`
3. Spin up the Zombienet network with `yarn test:e2e:deploy`.
4. Once the network deployment is complete, create a `.env.test` file with `RELAY_ADDRESS`, `PROVIDER_ADDRESS`, and `CONSUMER_ADDRESS` values pointing to the started nodes for relaychain, provider chain and consumer chain respectively.
5. Run the end-to-end tests with `yarn test:e2e`.
