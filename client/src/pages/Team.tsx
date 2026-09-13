import { useEffect, useState } from 'react'
import { api, type TeamUser } from '../lib/api'
import { useAuth } from '../lib/auth'

const REASON_MESSAGES: Record<string, string> = {
  phone_already_in_use: 'That phone number is already on an account',
  forbidden: "You don't have permission to do that",
  cannot_remove_owner: "The owner can't be removed",
  cannot_remove_self: "You can't remove yourself",
  not_found: 'User not found',
}

/**
 * PRD §8.1 P1: "Multi-user with roles: Owner, Editor (create/send), Viewer,
 * Accountant (read + export)." Inviting/removing is Owner-only server-side
 * (server/src/lib/authz.ts) — hidden here for a non-Owner too, but that's
 * a convenience, not the actual boundary.
 */
export default function Team() {
  const role = useAuth((s) => s.role)
  const isOwner = role === null || role === 'OWNER' // null = pre-existing session, defaults to Owner server-side too
  const [users, setUsers] = useState<TeamUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [phone, setPhone] = useState('')
  const [inviteRole, setInviteRole] = useState<'EDITOR' | 'VIEWER' | 'ACCOUNTANT'>('EDITOR')
  const [inviting, setInviting] = useState(false)

  function load() {
    api
      .listUsers()
      .then(setUsers)
      .catch(() => setError("Couldn't load your team."))
  }

  useEffect(load, [])

  async function invite() {
    if (!phone.trim()) return
    setError(null)
    setInviting(true)
    try {
      const result = await api.inviteUser(phone.trim(), inviteRole)
      if (result.ok) {
        setUsers(result.users)
        setPhone('')
      } else {
        setError(REASON_MESSAGES[result.reason] ?? "Couldn't send that invite.")
      }
    } catch {
      setError("Couldn't send that invite.")
    } finally {
      setInviting(false)
    }
  }

  async function remove(userId: string) {
    setError(null)
    const result = await api.removeUser(userId)
    if (result.ok) {
      setUsers((prev) => prev?.filter((u) => u.id !== userId) ?? prev)
    } else {
      setError(REASON_MESSAGES[result.reason] ?? "Couldn't remove that person.")
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">Team</h1>
      <p className="text-sm text-neutral-500">
        Editors can create and send invoices. Viewers and Accountants can see invoices and export reports, but can't
        approve, send, or record payments.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {isOwner && (
        <div className="flex flex-wrap items-end gap-2 rounded border p-3 text-sm">
          <div className="flex flex-1 flex-col">
            <label className="text-xs text-neutral-500">Phone number</label>
            <input
              className="rounded border px-2 py-1"
              placeholder="+2348012345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <select
            className="rounded border px-2 py-1"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as 'EDITOR' | 'VIEWER' | 'ACCOUNTANT')}
          >
            <option value="EDITOR">Editor</option>
            <option value="VIEWER">Viewer</option>
            <option value="ACCOUNTANT">Accountant</option>
          </select>
          <button
            className="rounded bg-emerald-700 px-3 py-2 text-white disabled:opacity-50"
            disabled={inviting || !phone.trim()}
            onClick={invite}
          >
            {inviting ? 'Inviting…' : 'Invite'}
          </button>
        </div>
      )}

      {!users && <p className="text-sm text-neutral-500">Loading…</p>}

      {users && (
        <div className="flex flex-col gap-2">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-2 rounded border p-3 text-sm">
              <div>
                <p className="font-medium">
                  {u.phone} <span className="ml-1 text-xs font-normal text-neutral-500">{u.role}</span>
                </p>
                {!u.joined && <p className="text-xs text-amber-600">Invited — hasn't signed in yet</p>}
              </div>
              {isOwner && u.role !== 'OWNER' && (
                <button className="text-xs text-red-600 underline" onClick={() => remove(u.id)}>
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
