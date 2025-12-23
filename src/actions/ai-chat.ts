'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { createAIProvider } from '@/lib/ai-providers';
import { agentTools, getSystemContext } from '@/lib/ai-agent';
import { buildSystemPrompt } from '@/lib/ai-system-prompt';
import { revalidatePath } from 'next/cache';

export async function sendMessage(conversationId: string, userMessage: string) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, message: 'غیرمجاز' };
    }

    // Get AI settings
    const settings = await prisma.aISettings.findFirst();
    if (!settings || !settings.enabled) {
      return { success: false, message: 'دستیار هوش مصنوعی فعال نیست' };
    }

    if (!settings.apiKey) {
      return { success: false, message: 'API Key تنظیم نشده است' };
    }

    // Save user message
    const userMsg = await prisma.aIMessage.create({
      data: {
        conversationId,
        role: 'USER',
        content: userMessage,
      },
    });

    // Get conversation history (reduced to 10 messages to save tokens)
    const messages = await prisma.aIMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 10, // Last 10 messages for context (reversed later)
    });

    // Get system context
    const systemContext = await getSystemContext();

    // Build comprehensive system prompt
    const systemPrompt = buildSystemPrompt(systemContext);

    // Build messages for AI
    const aiMessages = [
      {
        role: 'system' as const,
        content: systemPrompt,
      },
      ...messages.reverse().map(m => ({
        role: m.role.toLowerCase() as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    // Send to AI provider
    const provider = createAIProvider(settings.provider, settings.apiKey, settings.model);
    // Limit maxTokens to ensure we don't exceed context limits (8192 for some models)
    // Reduced to 1000 to leave more room for system prompt and message history
    const maxTokens = Math.min(settings.maxTokens || 1000, 1000);
    const response = await provider.sendMessage(aiMessages, {
      maxTokens,
      temperature: settings.temperature,
    });

    let assistantContent = response.content;
    let responseUsage = response.usage;
    const executedActions = [];

    // Check if AI wants to use tools
    const toolMatches = assistantContent.matchAll(/\[TOOL:(\w+)\]\s*(\{[\s\S]*?\})\s*\[\/TOOL\]/g);
    
    const toolCalls = Array.from(toolMatches);
    
    // Execute all tools and collect results
    for (const match of toolCalls) {
      const toolName = match[1];
      const paramsStr = match[2].trim();
      
      console.log('[AI AGENT] Tool call detected:', toolName, paramsStr);
      
      try {
        const params = JSON.parse(paramsStr);
        const tool = agentTools.find(t => t.name === toolName);
        
        if (tool) {
          console.log('[AI AGENT] Executing tool:', toolName, 'with params:', params);
          const result = await tool.execute(params);
          console.log('[AI AGENT] Tool result:', result);
          
          // Save action
          await prisma.aIAction.create({
            data: {
              messageId: userMsg.id,
              action: toolName,
              parameters: params,
              result,
              success: true,
            },
          });
          
          executedActions.push({
            tool: toolName,
            result,
          });

          // Remove the tool call from content
          assistantContent = assistantContent.replace(match[0], '');
        }
      } catch (error: any) {
        console.error('[AI AGENT] Error executing tool:', error);
        await prisma.aIAction.create({
          data: {
            messageId: userMsg.id,
            action: toolName,
            parameters: paramsStr,
            success: false,
            error: error.message,
          },
        });
      }
    }

    // If tools were executed, ask AI to explain the results
    if (executedActions.length > 0) {
      const resultsContext = executedActions.map(action => 
        `نتیجه ${action.tool}:\n${JSON.stringify(action.result, null, 2)}`
      ).join('\n\n');

      const explainMessages = [
        ...aiMessages,
        {
          role: 'assistant' as const,
          content: assistantContent,
        },
        {
          role: 'user' as const,
          content: `اطلاعات زیر از سیستم دریافت شد. لطفاً این اطلاعات را به زبان ساده و قابل فهم برای کاربر توضیح بده:\n\n${resultsContext}`,
        },
      ];

      const explainResponse = await provider.sendMessage(explainMessages, {
        maxTokens,
        temperature: settings.temperature,
      });

      assistantContent = explainResponse.content;
      // Update usage if explain was called
      if (explainResponse.usage) {
        responseUsage = explainResponse.usage;
      }
    }

    // Save assistant message
    const assistantMsg = await prisma.aIMessage.create({
      data: {
        conversationId,
        role: 'ASSISTANT',
        content: assistantContent,
        metadata: {
          usage: responseUsage,
          actionsExecuted: executedActions.length,
        },
      },
    });

    // Auto-generate title if this is one of the first few messages
    const messageCount = await prisma.aIMessage.count({
      where: { conversationId },
    });

    // Generate title after 2-3 messages (1 user + 1-2 assistant)
    if (messageCount >= 2 && messageCount <= 4) {
      const conversation = await prisma.aIConversation.findUnique({
        where: { id: conversationId },
      });

      // Only generate if title is still default (starts with "مکالمه")
      if (conversation?.title.startsWith('مکالمه ')) {
        try {
          // Get first user message for context
          const firstMessages = await prisma.aIMessage.findMany({
            where: { conversationId },
            orderBy: { createdAt: 'asc' },
            take: 3, // First user message + first assistant response
          });

          const firstUserMessage = firstMessages.find(m => m.role === 'USER');
          if (firstUserMessage) {
            // Generate a short title using AI
            const titlePrompt = `لطفاً یک عنوان کوتاه و مناسب (حداکثر 4-5 کلمه) برای این گفتگو انتخاب کن:\n\nسوال کاربر: ${firstUserMessage.content}\n\nعنوان باید مختصر و واضح باشد، فقط متن عنوان را برگردان (بدون توضیح اضافی).`;
            
            const titleResponse = await provider.sendMessage([
              {
                role: 'system' as const,
                content: 'شما یک دستیار هستید که باید عنوان کوتاه و مناسب برای گفتگوها انتخاب کنید. فقط عنوان را برگردانید، بدون توضیح.',
              },
              {
                role: 'user' as const,
                content: titlePrompt,
              },
            ], {
              maxTokens: 30, // Very short response for title
              temperature: 0.5,
            });

            const generatedTitle = titleResponse.content.trim();
            // Clean up title (remove quotes, extra spaces, etc.)
            const cleanTitle = generatedTitle
              .replace(/^["']|["']$/g, '') // Remove quotes
              .replace(/\n/g, ' ') // Replace newlines
              .trim()
              .substring(0, 50); // Limit length

            if (cleanTitle && cleanTitle.length > 0) {
              await prisma.aIConversation.update({
                where: { id: conversationId },
                data: { title: cleanTitle },
              });
              // Revalidate to refresh conversation list with new title
              revalidatePath('/dashboard/assistant');
            }
          }
        } catch (error) {
          console.error('Error generating conversation title:', error);
          // Don't fail the entire request if title generation fails
        }
      }
    }

    // Update conversation timestamp
    await prisma.aIConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    revalidatePath('/dashboard/assistant');

    return {
      success: true,
      message: assistantMsg,
      actions: executedActions,
    };
  } catch (error: any) {
    console.error('Error sending message:', error);
    return { 
      success: false, 
      message: error.message || 'خطا در ارسال پیام',
    };
  }
}

