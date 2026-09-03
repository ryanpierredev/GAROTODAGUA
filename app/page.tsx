import { requireChatGPTUser } from './chatgpt-auth';
import { Dashboard } from './dashboard-client';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await requireChatGPTUser('/');
  return <Dashboard identity={{ name: user.fullName ?? user.displayName, email: user.email }} />;
}
