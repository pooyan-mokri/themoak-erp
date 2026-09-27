import { getConversations, getAISettings } from '@/actions/ai-assistant';
import { AIAssistantInterface } from '@/components/assistant/ai-assistant-interface';
import { AISettingsCard } from '@/components/assistant/ai-settings-card';
import { PageHeader } from '@/components/layout/page-header';
import { auth } from '@/auth';
import { hasPermission } from '@/lib/access';
import { redirect } from 'next/navigation';

export default async function AIAssistantPage() {
  const session = await auth();
  
  if (!session?.user) {
    redirect('/login');
  }

  const [conversations, settings, stock, finance, salesManage] = await Promise.all([
    getConversations(),
    getAISettings(),
    hasPermission('stock.view'),
    hasPermission('finance.view'),
    hasPermission('sales.manage'),
  ]);

  const isAdmin = session.user.role === 'ADMIN';

  return (
    <div className="space-y-4">
      <PageHeader
        title="دستیار هوش مصنوعی"
        description="پرسش دربارهٔ موجودی، فروش، مشتریان و مالی، در حد دسترسی نقش شما"
      />

      {isAdmin && (
        <AISettingsCard settings={settings} />
      )}

      <AIAssistantInterface 
        conversations={conversations} 
        settings={settings}
        access={{ stock, finance, salesManage }}
        isAdmin={isAdmin}
      />
    </div>
  );
}
