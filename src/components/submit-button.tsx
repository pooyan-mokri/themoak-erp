'use client';

import { useFormStatus } from 'react-dom';

interface SubmitButtonProps {
  text: string;
  loadingText?: string;
  className?: string;
}

export function SubmitButton({ text, loadingText = 'در حال ثبت...', className = '' }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={`bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors disabled:bg-blue-400 disabled:cursor-not-allowed ${className}`}
    >
      {pending ? loadingText : text}
    </button>
  );
}
