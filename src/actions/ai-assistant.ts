'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';

// Get or create AI settings
export async function getAISettings() {
  try {
    // Check if AISettings table exists by trying to find first record
    let settings = await prisma.aISettings.findFirst().catch(() => null);
    
    if (!settings) {
      // Create default settings
      try {
        settings = await prisma.aISettings.create({
          data: {
            provider: 'OPENAI',
            apiKey: '',
            model: 'gpt-4',
            enabled: false,
            maxTokens: 1500,
            temperature: 0.7,
          },
        });
      } catch (createError) {
        console.error('Error creating AI settings:', createError);
        // Return default settings if creation fails
        return {
          id: 'default',
          provider: 'OPENAI' as any,
          apiKey: '',
          model: 'gpt-4',
          enabled: false,
          maxTokens: 1500,
          temperature: 0.7,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
    }
    
    return settings;
  } catch (error) {
    console.error('Error fetching AI settings:', error);
    // Return default settings instead of throwing
    return {
      id: 'default',
      provider: 'OPENAI' as any,
      apiKey: '',
      model: 'gpt-4',
          enabled: false,
          maxTokens: 1500,
          temperature: 0.7,
          createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}

// Update AI settings
export async function updateAISettings(data: {
  provider: 'OPENAI' | 'ANTHROPIC' | 'GEMINI' | 'GROQ';
  apiKey: string;
  model: string;
  enabled: boolean;
  maxTokens?: number;
  temperature?: number;
}) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== 'ADMIN') {
      return { success: false, message: 'غیرمجاز' };
    }

    const settings = await prisma.aISettings.findFirst();
    
    if (settings) {
      await prisma.aISettings.update({
        where: { id: settings.id },
        data: {
          provider: data.provider,
          apiKey: data.apiKey,
          model: data.model,
          enabled: data.enabled,
          maxTokens: data.maxTokens || 1500,
          temperature: data.temperature || 0.7,
        },
      });
    } else {
      await prisma.aISettings.create({
        data: {
          provider: data.provider,
          apiKey: data.apiKey,
          model: data.model,
          enabled: data.enabled,
          maxTokens: data.maxTokens || 1500,
          temperature: data.temperature || 0.7,
        },
      });
    }

    revalidatePath('/dashboard/assistant');
    return { success: true, message: 'تنظیمات با موفقیت ذخیره شد' };
  } catch (error) {
    console.error('Error updating AI settings:', error);
    return { success: false, message: 'خطا در ذخیره تنظیمات' };
  }
}

// Get user conversations
export async function getConversations() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      throw new Error('Unauthorized');
    }

    const conversations = await prisma.aIConversation.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    return conversations;
  } catch (error) {
    console.error('Error fetching conversations:', error);
    return [];
  }
}

// Create new conversation
export async function createConversation(title: string) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      throw new Error('Unauthorized');
    }

    const conversation = await prisma.aIConversation.create({
      data: {
        userId: session.user.id,
        title,
      },
    });

    revalidatePath('/dashboard/assistant');
    return { success: true, conversation };
  } catch (error) {
    console.error('Error creating conversation:', error);
    return { success: false, message: 'خطا در ایجاد مکالمه' };
  }
}

// Get conversation messages
export async function getConversationMessages(conversationId: string) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      throw new Error('Unauthorized');
    }

    const messages = await prisma.aIMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      include: {
        actions: true,
      },
    });

    return messages;
  } catch (error) {
    console.error('Error fetching messages:', error);
    return [];
  }
}

// Delete conversation
export async function deleteConversation(conversationId: string) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      throw new Error('Unauthorized');
    }

    await prisma.aIConversation.delete({
      where: { id: conversationId },
    });

    revalidatePath('/dashboard/assistant');
    return { success: true, message: 'مکالمه حذف شد' };
  } catch (error) {
    console.error('Error deleting conversation:', error);
    return { success: false, message: 'خطا در حذف مکالمه' };
  }
}

