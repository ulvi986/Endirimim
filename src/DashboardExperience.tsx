import type { Session } from './api'
import StoreWorkspace from './StoreWorkspace'
import UserWorkspace from './UserWorkspace'

type Props = { mode: 'user' | 'store'; session: Extract<Session, { status: 'authenticated' }> }

export default function DashboardExperience({ mode, session }: Props) {
  return mode === 'store' ? <StoreWorkspace session={session} /> : <UserWorkspace session={session} />
}
