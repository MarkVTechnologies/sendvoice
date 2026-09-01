import { redis } from '../lib/redis.js'

const TTL_SECONDS = 5 * 60
const key = (phone: string) => `otp:${phone}`

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export async function issueOtp(phone: string): Promise<string> {
  const code = generateCode()
  await redis.set(key(phone), code, 'EX', TTL_SECONDS)
  return code
}

export async function verifyOtp(phone: string, code: string): Promise<boolean> {
  const stored = await redis.get(key(phone))
  if (!stored || stored !== code) return false
  await redis.del(key(phone))
  return true
}
