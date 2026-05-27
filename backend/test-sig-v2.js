const { Keypair } = require("@stellar/stellar-sdk");
const crypto = require("crypto");

const address = "GB6UDGCIHZET6RNFINOFSBSRHJMAJEYKQWEJKCNDWS72FAHPZEG3QTCX";
const challenge = `Lance wants you to sign in with your Stellar account:\nGB6UDGCIHZET6RNFINOFSBSRHJMAJEYKQWEJKCNDWS72FAHPZEG3QTCX\n\nNonce: ed46d2f3-e5ac-41ff-bd64-0d50e39973e3`;
const signature = "Rgxru9VWsmiac9r/QV6mYyPJV1NR0I8onjZtao25YdfPNu4em7HL0qpi85peCblpjZVc3gHEWADbPJjtZoCUAA==";

const kp = Keypair.fromPublicKey(address);
const signatureBuffer = Buffer.from(signature, "base64");

console.log("isValid standard:", kp.verify(Buffer.from(challenge), signatureBuffer));

const hash = crypto.createHash("sha256").update(challenge).digest();
console.log("isValid sha256:", kp.verify(hash, signatureBuffer));

// Freighter prefix
const prefix = "Stellar Signed Message:\n";
const prefixedMessage = prefix + challenge;
console.log("isValid prefixed:", kp.verify(Buffer.from(prefixedMessage), signatureBuffer));

const prefixedHash = crypto.createHash("sha256").update(prefixedMessage).digest();
console.log("isValid prefixed sha256:", kp.verify(prefixedHash, signatureBuffer));
