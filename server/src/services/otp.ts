import { redis } from '../lib/redis.js'

const TTL_SECONDS = 5 * 60
const key = (phone: string) => `otp:${phone}`
const attemptsKey = (phone: string) => `otp:attempts:${phone}`
const sendCountKey = (phone: string) => `otp:sendcount:${phone}`

// PRD §12 P0: "velocity limits, new-account send caps... before public
// launch, not after." An IP-based rate limit (see index.ts) stops one
// attacker hammering the endpoint, but Telnyx bills per phone regardless of
// source IP, and an attacker can trivially rotate IPs — so the real cap
// that protects both our bill and a victim's phone from being spammed has
// to be keyed on the phone number itself.
const MAX_SENDS_PER_WINDOW = 5
const SEND_WINDOW_SECONDS = 60 * 60

// Caps how many wrong codes a request can try before the code is burned —
// otherwise a 6-digit code (1e6 space) sitting valid for 5 minutes is
// guessable by brute force alone, independent of any IP-based throttling.
const MAX_VERIFY_ATTEMPTS = 5

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export class OtpRateLimitError extends Error {}

export async function issueOtp(phone: string): Promise<string> {
  const sendCount = await redis.incr(sendCountKey(phone))
  if (sendCount === 1) await redis.expire(sendCountKey(phone), SEND_WINDOW_SECONDS)
  if (sendCount > MAX_SENDS_PER_WINDOW) {
    throw new OtpRateLimitError(`too many OTP requests for this phone in the last hour`)
  }

  const code = generateCode()
  await redis.set(key(phone), code, 'EX', TTL_SECONDS)
  await redis.del(attemptsKey(phone))
  return code
}

export async function verifyOtp(phone: string, code: string): Promise<boolean> {
  const stored = await redis.get(key(phone))
  if (!stored) return false

  if (stored !== code) {
    const attempts = await redis.incr(attemptsKey(phone))
    if (attempts === 1) await redis.expire(attemptsKey(phone), TTL_SECONDS)
    // Burn the code once guessed at too many times, rather than leaving it
    // valid (and guessable) for the rest of its TTL — forces a fresh
    // request, which is itself capped by issueOtp's send limit above.
    if (attempts >= MAX_VERIFY_ATTEMPTS) {
      await redis.del(key(phone))
      await redis.del(attemptsKey(phone))
    }
    return false
  }

  await redis.del(key(phone))
  await redis.del(attemptsKey(phone))
  return true
}
