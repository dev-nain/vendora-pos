import { hash as argon2Hash, verify } from "@node-rs/argon2";

const ARGON2ID_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export async function hashCredential(secret: string): Promise<string> {
  return argon2Hash(secret, ARGON2ID_OPTIONS);
}

export async function verifyCredential(hash: string, secret: string): Promise<boolean> {
  try {
    return await verify(hash, secret);
  } catch {
    return false;
  }
}
