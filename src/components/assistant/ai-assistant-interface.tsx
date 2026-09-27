'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MessageSquare, Send, Plus, Trash2, Bot, User as UserIcon, CheckCircle, Menu } from 'lucide-react';
import { sendMessage } from '@/actions/ai-chat';
import { createConversation, deleteConversation, getConversationMessages } from '@/actions/ai-assistant';
import { toast } from 'sonner';
import { formatJalaliDate } from '@/lib/date-utils';
import { cn } from '@/lib/utils';
import { suggestionGroups, type AssistantAccess } from './assistant-suggestions';

interface AIAssistantInterfaceProps {
  conversations: Array<{
    id: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  settings: {
    enabled: boolean;
    provider: string;
    model: string;
  };
  /** Which subjects the signed-in role may ask about (the tools behind them check again). */
  access?: AssistantAccess;
  /** An admin can switch the assistant on from the settings card. */
  isAdmin?: boolean;
}

const NO_ACCESS: AssistantAccess = { stock: false, finance: false, salesManage: false };

export function AIAssistantInterface({
  conversations: initialConversations,
  settings,
  access = NO_ACCESS,
  isAdmin = false,
}: AIAssistantInterfaceProps) {
  const router = useRouter();
  const [conversations, setConversations] = useState(initialConversations);
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(
    initialConversations[0]?.id || undefined
  );
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [isConversationsOpen, setIsConversationsOpen] = useState(false);
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null);
  const groups = suggestionGroups(access);
  const [group, setGroup] = useState(groups[0]?.id ?? '');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load messages when conversation changes
  useEffect(() => {
    if (activeConversationId) {
      loadMessages(activeConversationId);
    }
  }, [activeConversationId]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const loadMessages = async (conversationId: string) => {
    setLoadingMessages(true);
    try {
      const msgs = await getConversationMessages(conversationId);
      setMessages(msgs);
    } catch (error) {
      toast.error('خطا در بارگذاری پیام‌ها');
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleNewConversation = async () => {
    const title = `مکالمه ${(conversations.length + 1).toLocaleString('fa-IR')}`;
    const result = await createConversation(title);

    if (result.success && result.conversation) {
      setConversations([result.conversation, ...conversations]);
      setActiveConversationId(result.conversation.id);
      setMessages([]);
      toast.success('مکالمه جدید ایجاد شد');
    } else {
      toast.error(result.message || 'خطا در ایجاد مکالمه');
    }
  };

  const handleDeleteConversation = async (id: string) => {
    const result = await deleteConversation(id);

    if (result.success) {
      const rest = conversations.filter(c => c.id !== id);
      setConversations(rest);
      if (activeConversationId === id) {
        setActiveConversationId(rest[0]?.id || undefined);
        if (!rest.length) setMessages([]);
      }
      toast.success(result.message);
    } else {
      toast.error(result.message);
    }
  };

  const handleSendMessage = async () => {
    if (!input.trim() || !activeConversationId) return;

    if (!settings.enabled) {
      toast.error('دستیار هوش مصنوعی فعال نیست. لطفاً ابتدا تنظیمات را انجام دهید.');
      return;
    }

    const userMessage = input.trim();
    setInput('');
    setLoading(true);

    // Add user message to UI immediately
    const tempUserMsg = {
      id: 'temp-' + Date.now(),
      role: 'USER',
      content: userMessage,
      createdAt: new Date(),
    };
    setMessages([...messages, tempUserMsg]);

    try {
      const result = await sendMessage(activeConversationId, userMessage);

      if (result.success && result.message) {
        // Replace temp message and add assistant response
        await loadMessages(activeConversationId);

        // Refresh router to update conversation list (in case title was auto-generated)
        router.refresh();

        if (result.actions && result.actions.length > 0) {
          toast.success(`${result.actions.length.toLocaleString('fa-IR')} عملیات انجام شد`);
        }
      } else {
        toast.error(result.message || 'خطا در ارسال پیام');
        // Remove temp message on error
        setMessages(messages);
      }
    } catch (error) {
      toast.error('خطا در ارتباط با دستیار');
      setMessages(messages);
    } finally {
      setLoading(false);
    }
  };

  const suggest = (text: string) => {
    setInput(text);
    inputRef.current?.focus();
  };

  if (!settings.enabled) {
    return (
      <div className="rounded-lg border bg-card px-4 py-12 text-center">
        <Bot className="mx-auto h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
        <h3 className="mt-3 text-[15px] font-medium">دستیار هوش مصنوعی غیرفعال است</h3>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {isAdmin
            ? 'در «تنظیمات دستیار هوش مصنوعی» ارائه‌دهنده، مدل و کلید API را وارد و دستیار را فعال کنید.'
            : 'برای استفاده از دستیار، مدیر سیستم باید آن را در تنظیمات فعال کند.'}
        </p>
      </div>
    );
  }

  const ConversationsList = () => (
    <div className="space-y-1">
      {conversations.map((conv) => (
        <div
          key={conv.id}
          className={cn(
            'group flex cursor-pointer items-start justify-between gap-2 rounded-md px-3 py-2 transition-colors duration-150 touch-manipulation',
            activeConversationId === conv.id ? 'bg-brand-soft text-brand' : 'hover:bg-brand/[.04]',
          )}
          onClick={() => {
            setActiveConversationId(conv.id);
            setIsConversationsOpen(false);
          }}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{conv.title}</p>
            <p className="mt-0.5 font-mono text-[11px] opacity-70">{formatJalaliDate(conv.updatedAt)}</p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 flex-shrink-0 text-muted-foreground hover:text-danger md:h-7 md:w-7"
            title="حذف مکالمه"
            onClick={(e) => {
              e.stopPropagation();
              setDeleting({ id: conv.id, title: conv.title });
            }}
          >
            <Trash2 className="h-4 w-4 md:h-3.5 md:w-3.5" />
          </Button>
        </div>
      ))}
      {conversations.length === 0 && (
        <div className="py-8 text-center text-[12.5px] text-muted-foreground">
          <p>هنوز مکالمه‌ای ندارید.</p>
          <p className="mt-1">با «مکالمه جدید» شروع کنید.</p>
        </div>
      )}
    </div>
  );

  const current = groups.find((g) => g.id === group) ?? groups[0];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
      {/* Conversations - desktop */}
      <div className="hidden rounded-lg border bg-card lg:block">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <h3 className="text-sm font-medium">مکالمات</h3>
          <Button size="sm" variant="outline" onClick={handleNewConversation}>
            <Plus className="h-4 w-4" />
            جدید
          </Button>
        </div>
        <ScrollArea className="h-[600px] p-2">
          <ConversationsList />
        </ScrollArea>
      </div>

      {/* Conversations - mobile */}
      <Sheet open={isConversationsOpen} onOpenChange={setIsConversationsOpen}>
        <SheetContent side="right" className="w-[320px] sm:w-[380px]">
          <SheetHeader>
            <div className="flex items-center justify-between">
              <SheetTitle>مکالمات</SheetTitle>
              <Button size="sm" variant="outline" onClick={handleNewConversation}>
                <Plus className="h-4 w-4" />
                جدید
              </Button>
            </div>
          </SheetHeader>
          <ScrollArea className="mt-4 h-[calc(100vh-100px)]">
            <ConversationsList />
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Chat */}
      <div className="flex w-full flex-col overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 lg:hidden"
              onClick={() => setIsConversationsOpen(true)}
              title="مکالمات"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <span className="grid h-9 w-9 place-items-center rounded-md bg-brand text-white">
              <Bot className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-medium">دستیار هوشمند</p>
              <p className="font-mono text-[11px] text-muted-foreground" dir="ltr" style={{ textAlign: 'end' }}>
                {settings.provider} · {settings.model}
              </p>
            </div>
          </div>
          <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11.5px] text-success">فعال</span>
        </div>

        {activeConversationId ? (
          <>
            {/* Messages */}
            <ScrollArea className="h-[calc(100vh-380px)] px-4 py-4 md:h-[480px]" ref={scrollRef}>
              {loadingMessages ? (
                <p className="py-12 text-center text-[13px] text-muted-foreground">در حال بارگذاری پیام‌ها…</p>
              ) : messages.length === 0 ? (
                <div className="py-10 text-center">
                  <h3 className="text-[15px] font-medium">سلام! چطور می‌تونم کمکتون کنم؟</h3>
                  <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
                    می‌تونم در حد دسترسی شما اطلاعات موجودی، فروش، مشتریان و مالی رو بررسی کنم و عملیاتی مثل ثبت مشتری
                    رو انجام بدم. از پیشنهادهای پایین شروع کنید یا سؤالتون رو بنویسید.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((msg) => {
                    const mine = msg.role === 'USER';
                    return (
                      <div key={msg.id} className={cn('flex gap-2.5', mine ? 'justify-start' : 'justify-end')}>
                        {mine && (
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
                            <UserIcon className="h-3.5 w-3.5" />
                          </span>
                        )}
                        <div
                          className={cn(
                            'max-w-[85%] rounded-lg px-3.5 py-2.5 md:max-w-[78%]',
                            mine ? 'bg-brand-soft text-foreground' : 'border bg-card',
                          )}
                          dir="auto"
                        >
                          <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{msg.content}</p>
                          {msg.metadata?.actionsExecuted > 0 && (
                            <div className="mt-2 border-t pt-2" dir="rtl">
                              <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11.5px] text-success">
                                <CheckCircle className="h-3 w-3" />
                                {Number(msg.metadata.actionsExecuted).toLocaleString('fa-IR')} عملیات انجام شد
                              </span>
                            </div>
                          )}
                        </div>
                        {!mine && (
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand text-white">
                            <Bot className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {loading && (
                    // Typing indicator: static, no animation (design system §12).
                    <div className="flex justify-end gap-2.5" role="status" aria-live="polite">
                      <div className="inline-flex items-center gap-2 rounded-lg border bg-card px-3.5 py-2.5 text-[12.5px] text-muted-foreground">
                        <span className="flex gap-1" aria-hidden>
                          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
                          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
                          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
                        </span>
                        دستیار در حال نوشتن پاسخ است…
                      </div>
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand text-white">
                        <Bot className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>

            {/* Suggestions, by subject: only what this role may ask about */}
            {messages.length === 0 && groups.length > 0 && current && (
              <div className="space-y-2 border-t px-4 py-3">
                <div className="flex flex-wrap gap-1.5">
                  {groups.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setGroup(g.id)}
                      className={cn(
                        'inline-flex h-7 items-center rounded-full border px-3 text-[12px] transition-colors duration-150',
                        current.id === g.id ? 'border-foreground bg-foreground text-white' : 'bg-card hover:border-foreground/40',
                      )}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {current.items.map((text) => (
                    <button
                      key={text}
                      type="button"
                      onClick={() => suggest(text)}
                      className="rounded-md border bg-secondary px-3 py-2 text-start text-[12.5px] transition-colors duration-150 hover:border-brand hover:bg-brand/[.04]"
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Input */}
            <div className="flex gap-2 border-t px-4 py-3">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="پیام خود را بنویسید..."
                disabled={loading || !settings.enabled}
                className="h-11 flex-1 text-base md:h-9 md:text-sm"
              />
              <Button
                onClick={handleSendMessage}
                disabled={loading || !input.trim() || !settings.enabled}
                className="h-11 w-11 md:h-9 md:w-9"
                size="icon"
                title="ارسال"
              >
                <Send className="h-4 w-4 -scale-x-100" />
              </Button>
            </div>
          </>
        ) : (
          <div className="px-4 py-12 text-center">
            <MessageSquare className="mx-auto h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
            <h3 className="mt-3 text-[15px] font-medium">مکالمه‌ای انتخاب نشده</h3>
            <p className="mt-1 text-[13px] text-muted-foreground">یک مکالمه انتخاب کنید یا مکالمهٔ جدیدی بسازید.</p>
            <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
              <Button onClick={() => setIsConversationsOpen(true)} variant="outline" className="lg:hidden">
                <Menu className="h-4 w-4" />
                انتخاب مکالمه
              </Button>
              <Button onClick={handleNewConversation}>
                <Plus className="h-4 w-4" />
                مکالمه جدید
              </Button>
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف «{deleting?.title}»</AlertDialogTitle>
            <AlertDialogDescription>آیا از حذف این مکالمه و همهٔ پیام‌هایش اطمینان دارید؟ این عمل قابل بازگشت نیست.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() => {
                if (deleting) handleDeleteConversation(deleting.id);
                setDeleting(null);
              }}
            >
              حذف مکالمه
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
