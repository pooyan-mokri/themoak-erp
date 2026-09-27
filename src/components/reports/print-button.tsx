'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Opens the browser's print dialog, where the report can also be saved as a PDF. Not printed itself. */
export function PrintButton() {
  return (
    <Button variant="outline" onClick={() => window.print()} className="print:hidden">
      <Printer className="h-4 w-4" />
      چاپ / PDF
    </Button>
  );
}
