'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { 
  MessageSquare, Send, Plus, Trash2, Bot, User as UserIcon, 
  Loader2, AlertCircle, CheckCircle, Settings, Menu
} from 'lucide-react';
import { sendMessage } from '@/actions/ai-chat';
import { createConversation, deleteConversation, getConversationMessages } from '@/actions/ai-assistant';
import { toast } from 'sonner';
import { formatJalaliDate } from '@/lib/date-utils';

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
}

export function AIAssistantInterface({ conversations: initialConversations, settings }: AIAssistantInterfaceProps) {
  const router = useRouter();
  const [conversations, setConversations] = useState(initialConversations);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    initialConversations[0]?.id || null
  );
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [isConversationsOpen, setIsConversationsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
  }, [messages]);

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
    const title = `مکالمه ${conversations.length + 1}`;
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
    if (!confirm('آیا از حذف این مکالمه اطمینان دارید؟')) {
      return;
    }

    const result = await deleteConversation(id);
    
    if (result.success) {
      setConversations(conversations.filter(c => c.id !== id));
      if (activeConversationId === id) {
        setActiveConversationId(conversations[0]?.id || null);
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
          toast.success(`${result.actions.length} عملیات انجام شد`);
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

  if (!settings.enabled) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="h-12 w-12 text-orange-500 mb-4" />
            <h3 className="text-lg font-semibold mb-2">دستیار هوش مصنوعی غیرفعال است</h3>
            <p className="text-muted-foreground mb-4">
              برای استفاده از دستیار، ابتدا تنظیمات را انجام دهید.
            </p>
            <Badge variant="outline" className="text-xs">
              نیاز به دسترسی مدیر
            </Badge>
          </div>
        </CardContent>
      </Card>
    );
  }

  const ConversationsList = () => (
    <div className="space-y-2">
      {conversations.map((conv) => (
        <div
          key={conv.id}
          className={`p-3 md:p-3 rounded-lg cursor-pointer transition-colors touch-manipulation ${
            activeConversationId === conv.id
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-muted'
          }`}
          onClick={() => {
            setActiveConversationId(conv.id);
            setIsConversationsOpen(false);
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm md:text-sm font-medium truncate">{conv.title}</p>
              <p className="text-xs opacity-70 mt-1">
                {formatJalaliDate(conv.updatedAt)}
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 md:h-6 md:w-6 flex-shrink-0 touch-manipulation"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteConversation(conv.id);
              }}
            >
              <Trash2 className="h-4 w-4 md:h-3 md:w-3" />
            </Button>
          </div>
        </div>
      ))}
      {conversations.length === 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>هنوز مکالمه‌ای وجود ندارد</p>
          <p className="text-xs mt-1">برای شروع کلیک کنید</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* Conversations Sidebar - Desktop */}
      <Card className="hidden lg:block lg:col-span-1">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">مکالمات</CardTitle>
            <Button size="sm" variant="outline" onClick={handleNewConversation}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-2">
          <ScrollArea className="h-[600px]">
            <ConversationsList />
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Conversations Sheet - Mobile */}
      <Sheet open={isConversationsOpen} onOpenChange={setIsConversationsOpen}>
        <SheetContent side="right" className="w-[320px] sm:w-[380px]">
          <SheetHeader>
            <div className="flex items-center justify-between">
              <SheetTitle>مکالمات</SheetTitle>
              <Button size="sm" variant="outline" onClick={handleNewConversation}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </SheetHeader>
          <ScrollArea className="h-[calc(100vh-100px)] mt-4">
            <ConversationsList />
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Chat Interface */}
      <Card className="lg:col-span-3 w-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {/* Mobile: Menu button to open conversations */}
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden h-10 w-10 touch-manipulation"
                onClick={() => setIsConversationsOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>
              <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                <Bot className="h-5 w-5" />
                دستیار هوشمند
              </CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {settings.provider}
              </Badge>
              <Badge variant="secondary" className="text-xs hidden sm:inline-flex">
                {settings.model}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-3 md:p-6">
          {activeConversationId ? (
            <div className="space-y-4 md:space-y-4">
              {/* Messages */}
              <ScrollArea className="h-[calc(100vh-350px)] md:h-[500px] pr-2 md:pr-4" ref={scrollRef}>
                {loadingMessages ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Bot className="h-16 w-16 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-2">سلام! چطور می‌تونم کمکتون کنم؟</h3>
                    <p className="text-sm text-muted-foreground max-w-md">
                      می‌تونم اطلاعات موجودی، فروش، مشتریان و مالی رو بررسی کنم و 
                      عملیاتی مثل ثبت مشتری یا هزینه رو انجام بدم.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex gap-3 ${
                          msg.role === 'USER' ? 'justify-end' : 'justify-start'
                        }`}
                      >
                        {msg.role === 'ASSISTANT' && (
                          <div className="flex-shrink-0">
                            <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center">
                              <Bot className="h-4 w-4 text-primary-foreground" />
                            </div>
                          </div>
                        )}
                        <div
                          className={`max-w-[85%] md:max-w-[80%] rounded-lg px-4 py-3 ${
                            msg.role === 'USER'
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted'
                          }`}
                          dir={msg.role === 'ASSISTANT' ? 'rtl' : 'ltr'}
                        >
                          <p className={`text-base md:text-sm whitespace-pre-wrap ${msg.role === 'ASSISTANT' ? 'text-right' : ''}`}>{msg.content}</p>
                          {msg.metadata?.actionsExecuted > 0 && (
                            <div className="mt-2 pt-2 border-t border-border/50" dir="rtl">
                              <Badge variant="secondary" className="text-xs">
                                <CheckCircle className="h-3 w-3 ml-1" />
                                {msg.metadata.actionsExecuted} عملیات انجام شد
                              </Badge>
                            </div>
                          )}
                        </div>
                        {msg.role === 'USER' && (
                          <div className="flex-shrink-0">
                            <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center">
                              <UserIcon className="h-4 w-4" />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    {loading && (
                      <div className="flex gap-3 justify-start">
                        <div className="flex-shrink-0">
                          <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center">
                            <Bot className="h-4 w-4 text-primary-foreground" />
                          </div>
                        </div>
                        <div className="bg-muted rounded-lg px-4 py-3" dir="rtl">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>

              {/* Input */}
              <div className="flex gap-2 md:gap-2">
                <Input
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
                  className="flex-1 h-12 md:h-10 text-base md:text-sm"
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={loading || !input.trim() || !settings.enabled}
                  className="h-12 w-12 md:h-10 md:w-10 touch-manipulation"
                >
                  {loading ? (
                    <Loader2 className="h-5 w-5 md:h-4 md:w-4 animate-spin" />
                  ) : (
                    <Send className="h-5 w-5 md:h-4 md:w-4" />
                  )}
                </Button>
              </div>

              {/* Suggestions */}
              {messages.length === 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setInput('موجودی انبار چطوره؟')}
                    className="justify-start text-sm md:text-xs h-12 md:h-9 touch-manipulation"
                  >
                    موجودی انبار چطوره؟
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setInput('فروش این ماه چقدر بوده؟')}
                    className="justify-start text-sm md:text-xs h-12 md:h-9 touch-manipulation"
                  >
                    فروش این ماه چقدر بوده؟
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setInput('کدوم محصولات موجودیشون کمه؟')}
                    className="justify-start text-sm md:text-xs h-12 md:h-9 touch-manipulation"
                  >
                    کدوم محصولات موجودیشون کمه؟
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setInput('وضعیت مالی چطوره؟')}
                    className="justify-start text-sm md:text-xs h-12 md:h-9 touch-manipulation"
                  >
                    وضعیت مالی چطوره؟
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MessageSquare className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">مکالمه‌ای انتخاب نشده</h3>
              <p className="text-sm text-muted-foreground mb-4 px-4">
                یک مکالمه انتخاب کنید یا مکالمه جدید ایجاد کنید
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button 
                  onClick={() => setIsConversationsOpen(true)}
                  variant="outline"
                  className="lg:hidden h-12 md:h-10 text-base md:text-sm"
                >
                  <Menu className="h-4 w-4 ml-2" />
                  انتخاب مکالمه
                </Button>
                <Button 
                  onClick={handleNewConversation}
                  className="h-12 md:h-10 text-base md:text-sm"
                >
                  <Plus className="h-4 w-4 ml-2" />
                  مکالمه جدید
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

