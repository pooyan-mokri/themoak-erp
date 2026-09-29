'use client';

import { useRef, useState } from 'react';
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
import { updateDealStage } from '@/actions/crm';
import { toast } from 'sonner';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { DEAL_STAGES, PILL, dealStage, fa } from './crm-labels';

interface Deal {
  id: string;
  title: string;
  customer?: {
    name: string;
  };
  stage: string;
  value: any;
  probability: number;
  expectedClose?: Date;
}

interface DealKanbanProps {
  deals: Deal[];
  /** May move a deal between stages (sales.manage); the server checks it again. */
  canManage?: boolean;
}

/** The five stages, LOST included; status colour only on each column's pill. */
const STAGES = DEAL_STAGES.map((stage) => ({ ...stage, tone: dealStage(stage.id).tone }));

/** A click that ends a drag leaves the card on the board; any other click opens the deal. */
export function stopClickAfterDrag(event: { preventDefault(): void }, justDragged: boolean) {
  if (justDragged) event.preventDefault();
}

export function DealKanban({ deals: initialDeals, canManage = true }: DealKanbanProps) {
  const [deals, setDeals] = useState(initialDeals);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  // Set while a card is dragged, and until the click its drop fires has passed.
  const justDragged = useRef(false);
  const onCardClick = (event: { preventDefault(): void }) => stopClickAfterDrag(event, justDragged.current);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    justDragged.current = true;
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setTimeout(() => {
      justDragged.current = false;
    }, 0);
    const { active, over } = event;

    if (!over) {
      setActiveId(undefined);
      return;
    }

    const dealId = active.id as string;
    const newStage = over.id as string;

    // Find the deal
    const deal = deals.find(d => d.id === dealId);
    if (!deal || deal.stage === newStage) {
      setActiveId(undefined);
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

    setActiveId(undefined);
  };

  const getDealsByStage = (stage: string) =>
    deals.filter(deal => deal.stage === stage);

  const activeDeal = activeId ? deals.find(d => d.id === activeId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        justDragged.current = false;
        setActiveId(undefined);
      }}
    >
      <div className="grid grid-cols-1 gap-3 overflow-x-auto md:grid-cols-5">
        {STAGES.map(stage => {
          const stageDeals = getDealsByStage(stage.id);
          return (
            <DealColumn
              key={stage.id}
              stage={stage}
              deals={stageDeals}
              canManage={canManage}
              onCardClick={onCardClick}
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
  canManage,
  onCardClick,
}: {
  stage: { id: string; label: string; tone: string };
  deals: Deal[];
  canManage: boolean;
  onCardClick: (event: { preventDefault(): void }) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.id,
    disabled: !canManage,
  });

  const totalValue = deals.reduce((sum, deal) => sum + Number(deal.value), 0);

  return (
    <div className="flex min-w-[230px] flex-col gap-2 rounded-lg bg-secondary p-2">
      <div className="px-1 pt-1">
        <div className="flex items-center justify-between gap-2">
          <span className={cn(PILL, stage.tone)}>{stage.label}</span>
          <span className="font-mono text-[11px] text-muted-foreground">{fa(deals.length)}</span>
        </div>
        <p className="mt-1.5 text-[13px] font-medium tabular-nums">
          {fa(totalValue)}
          <small className="ms-1 text-[11px] font-normal text-muted-foreground">تومان</small>
        </p>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          'min-h-[400px] flex-1 space-y-2 rounded-md border border-dashed p-1.5 transition-colors duration-150',
          isOver ? 'border-brand bg-brand/[.04]' : 'border-transparent',
        )}
      >
        <SortableContext items={deals.map(d => d.id)} strategy={verticalListSortingStrategy}>
          {deals.map(deal => (
            <SortableDealCard key={deal.id} deal={deal} canManage={canManage} onCardClick={onCardClick} />
          ))}
        </SortableContext>
        {deals.length === 0 && (
          <div className="flex h-32 items-center justify-center text-center text-[12.5px] text-muted-foreground">
            {canManage ? 'فرصتی در این مرحله نیست؛ کارتی را اینجا بکشید.' : 'فرصتی در این مرحله نیست.'}
          </div>
        )}
      </div>
    </div>
  );
}

function SortableDealCard({
  deal,
  canManage,
  onCardClick,
}: {
  deal: Deal;
  canManage: boolean;
  onCardClick: (event: { preventDefault(): void }) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: deal.id, disabled: !canManage });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <DealCard deal={deal} onCardClick={onCardClick} />
    </div>
  );
}

function DealCard({
  deal,
  isOverlay,
  onCardClick,
}: {
  deal: Deal;
  isOverlay?: boolean;
  onCardClick?: (event: { preventDefault(): void }) => void;
}) {
  const content = (
    <div
      className={cn(
        'rounded-md border bg-card p-3 transition-colors duration-150',
        isOverlay ? 'border-brand' : 'cursor-grab hover:border-input active:cursor-grabbing',
      )}
    >
      <p className="text-[13px] font-medium">{deal.title}</p>
      <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{deal.customer?.name}</p>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[13px] font-medium tabular-nums">{fa(Number(deal.value))}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{fa(deal.probability)}٪</span>
      </div>
    </div>
  );

  if (isOverlay) return content;

  // The whole card opens the deal; a drag starts only after the pointer moves 8px, and the click its drop fires is held back.
  return (
    <Link href={`/dashboard/crm/deals/${deal.id}`} className="block hover:[&_p:first-child]:text-brand" onClick={onCardClick}>
      {content}
    </Link>
  );
}
