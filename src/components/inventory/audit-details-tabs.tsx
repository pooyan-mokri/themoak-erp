'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PreAuditTab } from './audit-pre-audit-tab';
import { ExecutionTab } from './audit-execution-tab';
import { PostAuditTab } from './audit-post-audit-tab';

interface AuditDetailsTabsProps {
  audit: any; // TODO: Type this properly
}

export function AuditDetailsTabs({ audit }: AuditDetailsTabsProps) {
  return (
    <Tabs defaultValue="pre-audit" className="w-full">
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
        <PostAuditTab audit={audit} />
      </TabsContent>
    </Tabs>
  );
}




