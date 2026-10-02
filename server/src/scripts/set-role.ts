import { eq } from 'drizzle-orm'
import { closePool, db } from '../db/client.js'
import { users } from '../db/schema.js'

/**
 * Operator task: change an existing account's role, e.g. to create the first
 * admin in a fresh production database (there is no demo seed there).
 *
 *   npm run user:role -- someone@example.com admin
 *
 * Store accounts are created through signup, since they also need a merchant row.
 */
const ROLES = ['user', 'admin'] as const

async function main(): Promise<void> {
  const [emailArg, role] = process.argv.slice(2)
  const email = emailArg?.trim().toLowerCase()

  if (!email || !ROLES.includes(role as (typeof ROLES)[number])) {
    console.error(`Usage: npm run user:role -- <email> <${ROLES.join('|')}>`)
    process.exitCode = 1
    return
  }

  const [updated] = await db
    .update(users)
    .set({ role: role as (typeof ROLES)[number], updatedAt: new Date() })
    .where(eq(users.email, email))
    .returning({ id: users.id, email: users.email, role: users.role })

  if (!updated) {
    console.error(`[role] no account with email ${email}. Register it on the site first.`)
    process.exitCode = 1
    return
  }
  console.log(`[role] ${updated.email} is now ${updated.role}`)
}

main()
  .catch((error) => {
    console.error('[role] failed', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closePool()
  })
