import { Dashboard } from './dashboard-client';
import { AuthScreen } from './auth-screen';
import { getSessionUser, setupRequired } from './local-auth';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getSessionUser();
  if (!user) return <AuthScreen firstAccess={await setupRequired()} />;
  return <Dashboard identity={{ name: user.name }} />;
}
