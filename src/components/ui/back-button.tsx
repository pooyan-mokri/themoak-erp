import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';

interface BackButtonProps {
  href: string;
  label: string;
}

export function BackButton({ href, label }: BackButtonProps) {
  return (
    <Link href={href}>
      <Button variant="ghost" size="sm">
        <ArrowRight className="h-4 w-4 ml-2 rotate-180" />
        {label}
      </Button>
    </Link>
  );
}

