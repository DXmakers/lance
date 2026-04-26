import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
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

export interface ReputationViewMetrics {
  client: ReputationMetrics;
  freelancer: ReputationMetrics;
}

interface ContractReputationScore {
  address: string;
  role: string;
  score: number | string | bigint;
  total_jobs: number | string | bigint;
  total_points: number | string | bigint;
  reviews: number | string | bigint;
}

interface ContractReputationView {
  address: string;
  client: ContractReputationScore;
  freelancer: ContractReputationScore;
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

function fallbackView(): ReputationViewMetrics {
  return {
    client: fallbackMetrics(),
    freelancer: fallbackMetrics(),
  };
}

function metricsFromScore(score: ContractReputationScore): ReputationMetrics {
  const scoreBps = normalizeNumber(score.score);
  const totalJobs = normalizeNumber(score.total_jobs);
  const totalPoints = normalizeNumber(score.total_points);
  const reviews = normalizeNumber(score.reviews);
  const averageStars = reviews > 0 ? totalPoints / reviews : toStarRating(scoreBps);

  return {
    scoreBps,
    totalJobs,
    totalPoints,
    reviews,
    starRating: toStarRating(scoreBps),
    averageStars,
  };
}

export async function getReputationView(address: string): Promise<ReputationViewMetrics> {
  if (!REPUTATION_CONTRACT_ID) {
    return fallbackView();
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
          "query_reputation",
          Address.fromString(address).toScVal(),
        ),
      )
      .setTimeout(30)
      .build();

    const simulation = await rpc.simulateTransaction(tx);
    const raw =
      "result" in simulation && simulation.result?.retval
        ? (scValToNative(simulation.result.retval) as ContractReputationView)
        : null;

    if (!raw) {
      return fallbackView();
    }

    return {
      client: metricsFromScore(raw.client),
      freelancer: metricsFromScore(raw.freelancer),
    };
  } catch {
    return fallbackView();
  }
}

export async function getReputationMetrics(
  address: string,
  role: ReputationRole,
): Promise<ReputationMetrics> {
  const view = await getReputationView(address);
  return role === "client" ? view.client : view.freelancer;
}
