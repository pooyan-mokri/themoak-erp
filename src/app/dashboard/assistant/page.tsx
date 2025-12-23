import { getConversations, getAISettings } from '@/actions/ai-assistant';
import { AIAssistantInterface } from '@/components/assistant/ai-assistant-interface';
import { AISettingsCard } from '@/components/assistant/ai-settings-card';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';

export default async function AIAssistantPage() {
  const session = await auth();
  
  if (!session?.user) {
    redirect('/login');
  }

  const [conversations, settings] = await Promise.all([
    getConversations(),
    getAISettings(),
  ]);

  const isAdmin = session.user.role === 'ADMIN';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">دستیار هوش مصنوعی</h1>
        <p className="text-muted-foreground mt-1">
          چت با دستیار هوشمند و مدیریت سیستم
        </p>
      </div>

      {isAdmin && (
        <AISettingsCard settings={settings} />
      )}

      <AIAssistantInterface 
        conversations={conversations} 
        settings={settings}
      />
    </div>
  );
}

