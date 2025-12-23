'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { updateAISettings } from '@/actions/ai-assistant';
import { toast } from 'sonner';
import { Settings, Save } from 'lucide-react';

interface AISettingsCardProps {
  settings: {
    provider: string;
    apiKey: string;
    model: string;
    enabled: boolean;
    maxTokens: number;
    temperature: number;
  };
}

export function AISettingsCard({ settings }: AISettingsCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [provider, setProvider] = useState(settings.provider);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [model, setModel] = useState(settings.model);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [maxTokens, setMaxTokens] = useState(settings.maxTokens);
  const [temperature, setTemperature] = useState(settings.temperature);
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    try {
      const result = await updateAISettings({
        provider: provider as any,
        apiKey,
        model,
        enabled,
        maxTokens,
        temperature,
      });

      if (result.success) {
        toast.success(result.message);
        setIsOpen(false);
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      toast.error('خطا در ذخیره تنظیمات');
    } finally {
      setLoading(false);
    }
  };

  const modelOptions: Record<string, string[]> = {
    OPENAI: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    ANTHROPIC: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229'],
    GEMINI: ['gemini-pro', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    GROQ: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              تنظیمات دستیار هوش مصنوعی
            </CardTitle>
            <CardDescription>
              پیکربندی ارائه‌دهنده و مدل هوش مصنوعی
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsOpen(!isOpen)}
          >
            {isOpen ? 'بستن' : 'ویرایش'}
          </Button>
        </div>
      </CardHeader>
      {isOpen && (
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>ارائه‌دهنده</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPENAI">OpenAI (GPT)</SelectItem>
                  <SelectItem value="ANTHROPIC">Anthropic (Claude)</SelectItem>
                  <SelectItem value="GEMINI">Google (Gemini)</SelectItem>
                  <SelectItem value="GROQ">Groq (Llama)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>مدل</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions[provider]?.map(m => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>API Key</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>حداکثر توکن‌ها</Label>
              <Input
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
                min={100}
                max={8000}
              />
            </div>

            <div className="space-y-2">
              <Label>Temperature (خلاقیت)</Label>
              <Input
                type="number"
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                min={0}
                max={2}
                step={0.1}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>فعال‌سازی دستیار</Label>
              <p className="text-sm text-muted-foreground">
                دستیار هوش مصنوعی را فعال یا غیرفعال کنید
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setIsOpen(false)}
            >
              انصراف
            </Button>
            <Button
              onClick={handleSave}
              disabled={loading || !apiKey}
            >
              <Save className="h-4 w-4 ml-2" />
              ذخیره تنظیمات
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

