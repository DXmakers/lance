import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
} from "@stellar/stellar-sdk";
import { Server as SorobanServer } from "@stellar/stellar-sdk/rpc";
import { toStarRating } from "./format";

const REPUTATION_CONTRACT_ID =
  process.env.NEXT_PUBLIC_REPUTATION_CONTRACT_ID ?? "";
const RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ??
  "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  (process.env.NEXT_PUBLIC_STELLAR_NETWORK as Networks) ?? Networks.TESTNET;

export type ReputationRole = "client" | "freelancer";

export interface ReputationMetrics {
  scoreBps: number;
  totalJobs: number;
  totalPoints: number;
  reviews: number;
  starRating: number;
  averageStars: number;
}

function normalizeNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return 0;
}

function fallbackMetrics(): ReputationMetrics {
  const scoreBps = 5000;
  return {
    scoreBps,
    totalJobs: 0,
    totalPoints: 0,
    reviews: 0,
    starRating: toStarRating(scoreBps),
    averageStars: 2.5,
  };
}

export async function getReputationMetrics(
  address: string,
  role: ReputationRole,
): Promise<ReputationMetrics> {
  if (!REPUTATION_CONTRACT_ID) {
    return fallbackMetrics();
  }

  try {
    const rpc = new SorobanServer(RPC_URL);
    const contract = new Contract(REPUTATION_CONTRACT_ID);
    const account = new Account(Keypair.random().publicKey(), "0");

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        contract.call(
          "get_public_metrics",
          Address.fromString(address).toScVal(),
          nativeToScVal(role, { type: "symbol" }),
        ),
      )
      .setTimeout(30)
      .build();

    const simulation = await rpc.simulateTransaction(tx);
    const raw =
      "result" in simulation && simulation.result?.retval
        ? (scValToNative(simulation.result.retval) as unknown[])
        : [];

    const scoreBps = normalizeNumber(raw[0]);
    const totalJobs = normalizeNumber(raw[1]);
    const totalPoints = normalizeNumber(raw[2]);
    const reviews = normalizeNumber(raw[3]);
    const averageStars = reviews > 0 ? totalPoints / reviews : toStarRating(scoreBps);

    return {
      scoreBps,
      totalJobs,
      totalPoints,
      reviews,
      starRating: toStarRating(scoreBps),
      averageStars,
    };
  } catch {
    return fallbackMetrics();
  }
}
