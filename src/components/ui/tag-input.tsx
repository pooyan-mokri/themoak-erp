'use client';

import { useState, KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface TagInputProps {
  name: string;
  label?: string;
  placeholder?: string;
  defaultTags?: string[];
}

export function TagInput({ name, label, placeholder = 'تگ جدید...', defaultTags = [] }: TagInputProps) {
  const [tags, setTags] = useState<string[]>(defaultTags);
  const [inputValue, setInputValue] = useState('');

  const addTag = (tag: string) => {
    const t = tag.trim();
    if (t && !tags.includes(t)) {
      setTags([...tags, t]);
    }
    setInputValue('');
  };

  const removeTag = (index: number) => {
    setTags(tags.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  };

  return (
    <div className="space-y-2">
      {label && <Label>{label}</Label>}
      <input type="hidden" name={name} value={tags.join(',')} />
      <div className="flex flex-wrap gap-1.5 p-2 border rounded-md min-h-[42px] bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
        {tags.map((tag, i) => (
          <Badge key={i} variant="secondary" className="flex items-center gap-1 h-6">
            {tag}
            <button
              type="button"
              onClick={() => removeTag(i)}
              className="rounded-full hover:bg-muted-foreground/20 p-0.5"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <Input
          className="border-0 shadow-none focus-visible:ring-0 p-0 h-6 flex-1 min-w-[80px] text-sm"
          placeholder={tags.length === 0 ? placeholder : ''}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => inputValue && addTag(inputValue)}
        />
      </div>
      <p className="text-xs text-muted-foreground">Enter یا کاما برای افزودن تگ</p>
    </div>
  );
}
