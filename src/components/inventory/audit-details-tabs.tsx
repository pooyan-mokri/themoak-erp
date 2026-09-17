'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PreAuditTab } from './audit-pre-audit-tab';
import { ExecutionTab } from './audit-execution-tab';
import { PostAuditTab } from './audit-post-audit-tab';

interface AuditDetailsTabsProps {
  audit: any; // TODO: Type this properly
  isAdmin: boolean;
  canSeeCost: boolean;
}

export function AuditDetailsTabs({ audit, isAdmin, canSeeCost }: AuditDetailsTabsProps) {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(() => {
    const requested = searchParams.get('tab');
    return requested === 'execution' || requested === 'post-audit' ? requested : 'pre-audit';
  });

  // The tab lives in ?tab= so a reload opens it again; other parameters such as ?round= are kept.
  // Next.js syncs history.replaceState with its router, so switching tabs does not reload the page from the server.
  const handleTabChange = (value: string) => {
    setTab(value);
    const params = new URLSearchParams(window.location.search);
    params.set('tab', value);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  };

  return (
    <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="pre-audit">پیش از عملیات</TabsTrigger>
        <TabsTrigger value="execution">حین عملیات</TabsTrigger>
        <TabsTrigger value="post-audit">پس از عملیات</TabsTrigger>
      </TabsList>
      <TabsContent value="pre-audit" className="mt-6">
        <PreAuditTab audit={audit} />
      </TabsContent>
      <TabsContent value="execution" className="mt-6">
        <ExecutionTab audit={audit} />
      </TabsContent>
      <TabsContent value="post-audit" className="mt-6">
        <PostAuditTab audit={audit} isAdmin={isAdmin} canSeeCost={canSeeCost} />
      </TabsContent>
    </Tabs>
  );
}




