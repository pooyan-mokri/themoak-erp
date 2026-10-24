import { redirect } from 'next/navigation';
import { auth } from '@/auth';

// Reads the session for each request; never cached (see src/app/login/page.tsx).
export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = await auth();
  
  if (session?.user) {
    redirect('/dashboard');
  } else {
    redirect('/login');
  }
}
