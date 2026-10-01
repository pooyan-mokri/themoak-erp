// AI Provider interfaces and implementations

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AIProvider {
  sendMessage(messages: AIMessage[], options?: {
    maxTokens?: number;
    temperature?: number;
  }): Promise<AIResponse>;
}

/** Longest wait for one provider answer: the assistant page waits on it. */
export const PROVIDER_TIMEOUT_MS = 60_000;

/**
 * Every provider is outside Iran, and the ERP may run inside it: a provider
 * can be unreachable from the server (filtered, no route) or refuse its
 * country. Either way the user reads why in Persian; only the assistant's
 * request fails, never another page.
 */
export function providerUnreachableMessage(name: string, error: any): string {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return `سرویس ${name} در ${PROVIDER_TIMEOUT_MS / 1000} ثانیه جواب نداد. ممکن است از سرور ERP در دسترس نباشد؛ کمی بعد دوباره امتحان کنید یا در تنظیمات دستیار سرویس دیگری انتخاب کنید.`;
  }
  const code = error?.cause?.code ?? error?.code ?? 'خطای شبکه';
  return `سرور ERP به سرویس ${name} وصل نشد (${code}). ممکن است این سرویس از سرور ERP (ایران) مسدود باشد؛ در تنظیمات دستیار سرویس دیگری انتخاب کنید یا از مدیر سیستم بخواهید راه دسترسی را بررسی کند.`;
}

/** A refusal for where the request comes from (OpenAI and Anthropic answer 403, Gemini 400 with "location"). */
export function regionRefusalMessage(name: string, status: number, errorMessage: string): string | null {
  const byText = /unsupported_country|country|region|territor|location is not supported/i.test(errorMessage);
  if (status === 403 || status === 451 || byText) {
    return `سرویس ${name} درخواست‌های این سرور را نپذیرفت (${status})؛ احتمالاً این سرویس به سرورهای ایران خدمات نمی‌دهد. در تنظیمات دستیار سرویس دیگری انتخاب کنید.`;
  }
  return null;
}

/** fetch with the timeout, and a network failure turned into the Persian message. */
async function callProvider(name: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  } catch (error) {
    console.error(`${name} API unreachable:`, error);
    throw new Error(providerUnreachableMessage(name, error));
  }
}

// OpenAI Provider
export class OpenAIProvider implements AIProvider {
  constructor(private apiKey: string, private model: string = 'gpt-4') {}

  async sendMessage(messages: AIMessage[], options?: {
    maxTokens?: number;
    temperature?: number;
  }): Promise<AIResponse> {
    const response = await callProvider('OpenAI', 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: options?.maxTokens || 2000,
        temperature: options?.temperature || 0.7,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error?.message || response.statusText;
      const errorType = errorData.error?.type;
      console.error('OpenAI API error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorData,
      });
      
      const refused = regionRefusalMessage('OpenAI', response.status, `${errorData.error?.code ?? ''} ${errorMessage}`);
      if (refused) throw new Error(refused);

      // Handle rate limit errors with better messages
      if (errorType === 'rate_limit_error' || errorMessage.includes('rate limit')) {
        const retryAfter = errorData.error?.retry_after || 'چند ثانیه';
        throw new Error(`محدودیت نرخ درخواست: لطفاً ${retryAfter} دیگر دوباره تلاش کنید. این خطا موقت است و پس از مدتی برطرف می‌شود.`);
      }
      
      throw new Error(`خطای OpenAI API: ${errorMessage}`);
    }

    const data = await response.json();
    
    return {
      content: data.choices[0].message.content,
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
    };
  }
}

// Anthropic Provider
export class AnthropicProvider implements AIProvider {
  constructor(private apiKey: string, private model: string = 'claude-3-5-sonnet-20241022') {}

  async sendMessage(messages: AIMessage[], options?: {
    maxTokens?: number;
    temperature?: number;
  }): Promise<AIResponse> {
    const response = await callProvider('Anthropic', 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages.filter(m => m.role !== 'system'),
        system: messages.find(m => m.role === 'system')?.content,
        max_tokens: options?.maxTokens || 2000,
        temperature: options?.temperature || 0.7,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error?.message || response.statusText;
      console.error('Anthropic API error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorData,
      });
      throw new Error(regionRefusalMessage('Anthropic', response.status, errorMessage) ?? `Anthropic API error: ${errorMessage}`);
    }

    const data = await response.json();
    
    return {
      content: data.content[0].text,
      usage: {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
    };
  }
}

// Google Gemini Provider
export class GeminiProvider implements AIProvider {
  constructor(private apiKey: string, private model: string = 'gemini-pro') {}

  async sendMessage(messages: AIMessage[], options?: {
    maxTokens?: number;
    temperature?: number;
  }): Promise<AIResponse> {
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const response = await callProvider(
      'Gemini',
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents,
          generationConfig: {
            maxOutputTokens: options?.maxTokens || 2000,
            temperature: options?.temperature || 0.7,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error?.message || response.statusText;
      console.error('Gemini API error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorData,
      });
      throw new Error(regionRefusalMessage('Gemini', response.status, errorMessage) ?? `Gemini API error: ${errorMessage}`);
    }

    const data = await response.json();
    
    return {
      content: data.candidates[0].content.parts[0].text,
    };
  }
}

// Groq Provider
export class GroqProvider implements AIProvider {
  constructor(private apiKey: string, private model: string = 'llama-3.3-70b-versatile') {}

  async sendMessage(messages: AIMessage[], options?: {
    maxTokens?: number;
    temperature?: number;
  }): Promise<AIResponse> {
    const response = await callProvider('Groq', 'https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: options?.maxTokens || 2000,
        temperature: options?.temperature || 0.7,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error?.message || response.statusText;
      console.error('Groq API error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorData,
      });
      throw new Error(regionRefusalMessage('Groq', response.status, errorMessage) ?? `Groq API error: ${errorMessage}`);
    }

    const data = await response.json();
    
    return {
      content: data.choices[0].message.content,
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
    };
  }
}

// Factory function
export function createAIProvider(
  provider: 'OPENAI' | 'ANTHROPIC' | 'GEMINI' | 'GROQ',
  apiKey: string,
  model: string
): AIProvider {
  switch (provider) {
    case 'OPENAI':
      return new OpenAIProvider(apiKey, model);
    case 'ANTHROPIC':
      return new AnthropicProvider(apiKey, model);
    case 'GEMINI':
      return new GeminiProvider(apiKey, model);
    case 'GROQ':
      return new GroqProvider(apiKey, model);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

