import { Router, Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../config/db";
import { Keypair } from "@stellar/stellar-sdk";

const router = Router();

// Define input types
interface ChallengeRequest {
  address: string;
}

interface VerifyRequest {
  address: string;
  signature: string;
}

// Scaffold the auth challenge route
router.post("/challenge", async (req: Request<{}, {}, ChallengeRequest>, res: Response) => {
  try {
    const { address } = req.body;

    if (!address) {
      return res.status(400).json({ error: "Address is required" });
    }

    // Generate challenge matching the old Rust backend format
    const nonce = crypto.randomUUID();
    const challenge = `Lance wants you to sign in with your Stellar account:\n${address}\n\nNonce: ${nonce}`;

    // Expiration time: 5 minutes from now
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Save or update the challenge in the database
    await prisma.auth_challenges.upsert({
      where: { address },
      update: { challenge, expires_at: expiresAt },
      create: { address, challenge, expires_at: expiresAt },
    });

    res.json({ challenge });
  } catch (error) {
    console.error("Auth challenge error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Verify route
router.post("/verify", async (req: Request<{}, {}, VerifyRequest>, res: Response) => {
  try {
    const { address, signature } = req.body;

    if (!address || !signature) {
      return res.status(400).json({ error: "Address and signature are required" });
    }

    // 1. Fetch the challenge
    const record = await prisma.auth_challenges.findUnique({ where: { address } });
    if (!record) {
      return res.status(404).json({ error: "Challenge not found. Please request a new challenge." });
    }

    if (record.expires_at < new Date()) {
      return res.status(400).json({ error: "Challenge expired" });
    }

    // 2. Verify the signature
    let isValid = false;
    try {
      const keypair = Keypair.fromPublicKey(address);
      
      // Handle the case where signature is an object (some wallet kits wrap it)
      const sigString = typeof signature === "object" && (signature as any).signature 
        ? (signature as any).signature 
        : typeof signature === "string" ? signature : "";

      const hexRegex = /^[0-9a-fA-F]+$/;
      const signatureBuffer = hexRegex.test(sigString) && sigString.length % 2 === 0
        ? Buffer.from(sigString, "hex")
        : Buffer.from(sigString, "base64");
      
      // Freighter (and stellar-wallets-kit) prefixes messages before hashing and signing to prevent spoofing
      const SIGN_MESSAGE_PREFIX = "Stellar Signed Message:\n";
      const payloadBuffer = Buffer.from(SIGN_MESSAGE_PREFIX + record.challenge);
      const messageHash = crypto.createHash("sha256").update(payloadBuffer).digest();

      isValid = keypair.verify(messageHash, signatureBuffer);
      
      // Fallback for mock wallet in E2E tests (it returns the literal string "mock-signature")
      if (!isValid && process.env.NODE_ENV !== "production") {
        if (signature === record.challenge || signature === "mock-signature") {
          isValid = true;
        }
      }
    } catch (err) {
      console.error("Signature verification failed structurally:", err);
      isValid = false;
    }

    // For local dev/E2E tests
    if (!isValid && process.env.NODE_ENV !== "production") {
      if (signature === record.challenge || signature === "mock-signature") {
        isValid = true;
      }
    }

    if (!isValid) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    // 3. Delete the used challenge
    await prisma.auth_challenges.delete({ where: { address } });

    // 4. Generate a session token
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // 5. Save the session
    await prisma.sessions.create({
      data: {
        token,
        address,
        expires_at: expiresAt,
      },
    });

    res.json({ token, address });
  } catch (error) {
    console.error("Auth verify error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
