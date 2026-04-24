import {
  Horizon,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  Contract,
  TimeoutInfinite,
  Account,
  xdr,
  Transaction,
} from '@stellar/stellar-sdk'

export type StellarNetwork = 'public' | 'testnet'

type WalletModalOptions = {
  onWalletSelected: () => Promise<void> | void
}

type WalletAddressResult = {
  address: string
}

export type WalletKit = {
  openModal: (options: WalletModalOptions) => Promise<void>
  closeModal: () => void
  getAddress: () => Promise<WalletAddressResult>
}

export const APP_STELLAR_NETWORK: StellarNetwork =
  (process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'testnet').toUpperCase() ===
  'PUBLIC'
    ? 'public'
    : 'testnet'

const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL || 'https://horizon-testnet.stellar.org'

export const horizonServer = new Horizon.Server(HORIZON_URL)

// ──────────────────────────────────────────────────────────────────────────────
// Issue #164: Soroban RPC Simulator and Polling Logic
// ──────────────────────────────────────────────────────────────────────────────

const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ||
  'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE =
  APP_STELLAR_NETWORK === 'public' ? Networks.PUBLIC : Networks.TESTNET

export const sorobanServer = new SorobanRpc.Server(SOROBAN_RPC_URL)

export async function getAccountState(publicKey: string): Promise<Account> {
  try {
    const accountInfo = await sorobanServer.getAccount(publicKey)
    return new Account(publicKey, accountInfo.sequenceNumber())
  } catch (error) {
    throw new Error(`Failed to fetch account state for ${publicKey}: ${error}`)
  }
}

export interface BuildTransactionParams {
  sourceAddress: string
  contractId: string
  method: string
  args?: xdr.ScVal[]
}

export async function buildAndSimulateTransaction({
  sourceAddress,
  contractId,
  method,
  args = [],
}: BuildTransactionParams): Promise<{
  transaction: Transaction
  simulation: SorobanRpc.Api.SimulateTransactionResponse
}> {
  // 1. Fetch fresh account state to avoid Sequence Number Mismatch
  const account = await getAccountState(sourceAddress)
  const contract = new Contract(contractId)

  // 2. Build the base transaction
  const txBuilder = new TransactionBuilder(account, {
    fee: '100', // Base fee; dynamically adjusted by simulation
    networkPassphrase: NETWORK_PASSPHRASE,
  })

  txBuilder.addOperation(contract.call(method, ...args))
  txBuilder.setTimeout(TimeoutInfinite)

  const tx = txBuilder.build()

  // 3. Simulate the transaction
  let simulation: SorobanRpc.Api.SimulateTransactionResponse
  try {
    simulation = await sorobanServer.simulateTransaction(tx)
  } catch (error) {
    throw new Error(`RPC Simulation request failed: ${error}`)
  }

  // 4. Handle simulation errors
  if (SorobanRpc.Api.isSimulationError(simulation)) {
    if (process.env.NODE_ENV === 'development') {
      console.error(
        'Raw Simulation Error:',
        JSON.stringify(simulation, null, 2)
      )
    }
    throw new Error(`Simulation failed: ${simulation.error}`)
  }

  if (process.env.NODE_ENV === 'development') {
    console.log('Simulation Success:', JSON.stringify(simulation, null, 2))
    console.log('Raw XDR Before Assembly:', tx.toXDR())
  }

  // 5. Assemble transaction with dynamic resource limits and fees from simulation
  try {
    const assembledTx = SorobanRpc.assembleTransaction(
      tx,
      NETWORK_PASSPHRASE,
      simulation
    ).build()
    return { transaction: assembledTx as Transaction, simulation }
  } catch (error) {
    throw new Error(
      `Failed to assemble transaction with simulation results: ${error}`
    )
  }
}

export async function submitTransaction(
  signedTx: Transaction
): Promise<SorobanRpc.Api.SendTransactionResponse> {
  const response = await sorobanServer.sendTransaction(signedTx)

  if (response.status === 'ERROR') {
    let isSeqMismatch = false
    try {
      if (response.errorResultXdr) {
        const result = xdr.TransactionResult.fromXDR(
          response.errorResultXdr,
          'base64'
        )
        isSeqMismatch = result.result().switch().name === 'txBadSeq'
      }
    } catch (e) {
      // Ignore XDR parsing errors fallback to generic error
    }

    if (process.env.NODE_ENV === 'development') {
      console.error('Transaction Submit Error XDR:', response.errorResultXdr)
    }

    if (isSeqMismatch) {
      throw new Error('SEQUENCE_MISMATCH')
    }

    throw new Error('Transaction submission failed with network status ERROR.')
  }

  return response
}

export async function pollTransactionStatus(
  txHash: string,
  maxWaitSeconds = 60
): Promise<SorobanRpc.Api.GetTransactionResponse> {
  let waited = 0
  const pollInterval = 3000

  while (waited < maxWaitSeconds * 1000) {
    const response = await sorobanServer.getTransaction(txHash)

    if (response.status !== SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`Transaction ${txHash} updated to status:`, response.status)
      }
      return response
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval))
    waited += pollInterval
  }

  throw new Error(
    `Transaction polling timed out after ${maxWaitSeconds} seconds.`
  )
}

export function isValidStellarAddress(address: string): boolean {
  return /^[G][A-Z2-7]{55}$/.test(address)
}

export function getWalletNetwork(): StellarNetwork {
  return APP_STELLAR_NETWORK
}

export function disconnectWallet(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('wallet_address')
    localStorage.removeItem('wallet_type')
    window.dispatchEvent(new Event('storage'))
  }
}

export function getWalletsKit(): WalletKit {
  return {
    openModal: async ({ onWalletSelected }) => {
      await onWalletSelected()
    },

    closeModal: () => {},

    getAddress: async () => {
      const stored =
        typeof window !== 'undefined'
          ? localStorage.getItem('wallet_address')
          : null

      return {
        address:
          stored || 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      }
    },
  }
}

export async function getConnectedWalletAddress(): Promise<string | null> {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('wallet_address')
  }

  return null
}

export async function connectWallet(): Promise<string> {
  const address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

  if (typeof window !== 'undefined') {
    localStorage.setItem('wallet_address', address)
  }

  return address
}

export async function signTransaction(xdr: string): Promise<string> {
  return xdr
}
