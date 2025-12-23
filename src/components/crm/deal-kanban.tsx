'use client';

import { useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { updateDealStage } from '@/actions/crm';
import { toast } from 'sonner';
import Link from 'next/link';

interface Deal {
  id: string;
  title: string;
  customer: {
    name: string;
  };
  stage: string;
  value: any;
  probability: number;
  expectedClose: Date | null;
}

interface DealKanbanProps {
  deals: Deal[];
}

const STAGES = [
  { id: 'PROSPECT', label: 'سرنخ', color: 'bg-gray-100' },
  { id: 'PROPOSAL', label: 'پیشنهاد', color: 'bg-blue-100' },
  { id: 'NEGOTIATION', label: 'مذاکره', color: 'bg-yellow-100' },
  { id: 'WON', label: 'برنده', color: 'bg-green-100' },
  { id: 'LOST', label: 'باخته', color: 'bg-red-100' },
];

export function DealKanban({ deals: initialDeals }: DealKanbanProps) {
  const [deals, setDeals] = useState(initialDeals);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over) {
      setActiveId(null);
      return;
    }

    const dealId = active.id as string;
    const newStage = over.id as string;

    // Find the deal
    const deal = deals.find(d => d.id === dealId);
    if (!deal || deal.stage === newStage) {
      setActiveId(null);
      return;
    }

    // Optimistically update UI
    setDeals(prev =>
      prev.map(d => (d.id === dealId ? { ...d, stage: newStage } : d))
    );

    // Update backend
    const result = await updateDealStage(dealId, newStage);
    
    if (!result.success) {
      // Revert on error
      setDeals(prev =>
        prev.map(d => (d.id === dealId ? { ...d, stage: deal.stage } : d))
      );
      toast.error(result.message);
    } else {
      toast.success('مرحله معامله به‌روز شد');
    }

    setActiveId(null);
  };

  const getDealsByStage = (stage: string) =>
    deals.filter(deal => deal.stage === stage);

  const activeDeal = activeId ? deals.find(d => d.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 overflow-x-auto">
        {STAGES.map(stage => {
          const stageDeals = getDealsByStage(stage.id);
          return (
            <DealColumn
              key={stage.id}
              stage={stage}
              deals={stageDeals}
            />
          );
        })}
      </div>

      <DragOverlay>
        {activeDeal && <DealCard deal={activeDeal} isOverlay />}
      </DragOverlay>
    </DndContext>
  );
}

function DealColumn({
  stage,
  deals,
}: {
  stage: { id: string; label: string; color: string };
  deals: Deal[];
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.id,
  });

  const totalValue = deals.reduce((sum, deal) => sum + Number(deal.value), 0);

  return (
    <div className="flex flex-col gap-2 min-w-[250px]">
      <div className={`p-3 rounded-lg ${stage.color}`}>
        <h3 className="font-medium text-sm">{stage.label}</h3>
        <div className="text-xs text-muted-foreground mt-1">
          {deals.length} معامله
          <span className="mr-2">
            {new Intl.NumberFormat('fa-IR', {
              notation: 'compact',
            }).format(totalValue)} ت
          </span>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={`flex-1 space-y-2 min-h-[400px] p-2 rounded border-2 border-dashed transition-colors ${
          isOver ? 'border-primary bg-primary/5' : 'border-gray-200'
        }`}
      >
        <SortableContext items={deals.map(d => d.id)} strategy={verticalListSortingStrategy}>
          {deals.map(deal => (
            <SortableDealCard key={deal.id} deal={deal} />
          ))}
        </SortableContext>
        {deals.length === 0 && (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            بدون معامله
          </div>
        )}
      </div>
    </div>
  );
}

function SortableDealCard({ deal }: { deal: Deal }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: deal.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <DealCard deal={deal} />
    </div>
  );
}

function DealCard({ deal, isOverlay }: { deal: Deal; isOverlay?: boolean }) {
  const content = (
    <Card className={isOverlay ? 'rotate-3 opacity-80' : 'cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow'}>
      <CardContent className="p-3">
        <div className="font-medium text-sm mb-1">{deal.title}</div>
        <div className="text-xs text-muted-foreground mb-2">{deal.customer.name}</div>
        <div className="flex justify-between items-center">
          <span className="text-sm font-medium text-green-600">
            {new Intl.NumberFormat('fa-IR').format(Number(deal.value))} ت
          </span>
          <Badge variant="outline" className="text-xs">
            {deal.probability}%
          </Badge>
        </div>
      </CardContent>
    </Card>
  );

  if (isOverlay) {
    return content;
  }

  return (
    <Link href={`/dashboard/crm/deals/${deal.id}`} className="block" onClick={(e) => e.preventDefault()}>
      {content}
    </Link>
  );
}
