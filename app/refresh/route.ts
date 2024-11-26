// TODO: Look into https://redis.io/docs/latest/develop/use/patterns/distributed-locks

import { Redis } from "@upstash/redis";
import { createHash } from "node:crypto";

const redis = Redis.fromEnv();
const RT_LOCK_TTL = 5; // Lock TTL in seconds

async function handleRefreshToken(request: Request) {
  // TODO: Authenticate the request via client_id + client_secret

  const { refresh_token } = await request.json();

  const refreshTokenPayload = await verifyRefreshToken(refresh_token);
  const key = getLockKey(refresh_token);

  // If the lock is set, this is the first request to refresh the token
  // We generate new tokens, cache them, release the lock and return the new tokens
  if (await attemptLock(key)) {
    console.log("Refreshing token for", refreshTokenPayload.sub);
    const tokens = await generateTokens(refreshTokenPayload);
    // TODO: revoke old tokens

    await cacheAndReleaseLock(key, tokens);
    console.log("Cached new tokens");
    console.log("Released lock", key);

    console.log("Returning new tokens for", refreshTokenPayload.sub);
    return Response.json(tokens);
  }

  // This a subsequent request with a refresh_token that is already being refreshed
  console.log("Attempting to get cached tokens for", refreshTokenPayload.sub);

  // Poll until the lock is released or time out if it takes too long
  const start = Date.now();
  while (await lockExists(key)) {
    await pollUntilTimeout(RT_LOCK_TTL, start);
  }

  console.log(
    "Lock released, getting cached tokens for",
    refreshTokenPayload.sub
  );
  const cachedTokens = await getCachedTokens(key);

  console.log("Returning cached tokens for", refreshTokenPayload.sub);
  return Response.json(cachedTokens);
}

export async function POST(request: Request) {
  try {
    return await handleRefreshToken(request);
  } catch (error) {
    console.error("Error handling refresh token:", error);
    return Response.json(
      {
        error: "invalid_request",
        error_description: "The access token could not be refreshed.",
      },
      { status: 400 }
    );
  }
}

async function verifyRefreshToken(token: string | undefined) {
  if (!token) throw new TypeError("Missing refresh_token");
  return { sub: "user123" };
}

async function cacheAndReleaseLock(key: string, tokens: unknown) {
  await redis
    .multi()
    .set(getCacheKey(key), JSON.stringify(tokens), { ex: RT_LOCK_TTL }) // Cache the result
    .del(key) // Release the lock
    .exec();
}

async function generateTokens(payload: { sub: string }) {
  return {
    refresh_token: `refresh_${payload.sub}_${Date.now()}`,
    access_token: `access_${payload.sub}_${Date.now()}`,
    expires_in: 3600,
    token_type: "Bearer",
  };
}

async function attemptLock(key: string): Promise<boolean> {
  const result = await redis.set(key, "1", { nx: true, ex: RT_LOCK_TTL });
  return result === "OK";
}

function getLockKey(token: string) {
  return `rt_lock:${createHash("sha256").update(token).digest("hex")}`;
}

function getCacheKey(key: string): string {
  return `cache_${key}`;
}

async function lockExists(key: string) {
  return await redis.exists(key);
}

async function getCachedTokens(key: string): Promise<unknown> {
  const cachedTokens = await redis.get(getCacheKey(key));
  if (!cachedTokens) throw new Error("Cached tokens not found");
  return cachedTokens;
}

function pollUntilTimeout(timeout: number, start: number) {
  if (Date.now() - start > timeout * 1000) {
    throw new Error("Timed out waiting for lock to be released");
  }
  return new Promise((resolve) => setTimeout(resolve, 100));
}
