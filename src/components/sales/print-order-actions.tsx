'use client';

import { Button } from '@/components/ui/button';
import { Printer, Download } from 'lucide-react';

interface PrintOrderActionsProps {
  orderNumber: string | number;
  invoiceContentId: string;
}

export function PrintOrderActions({ orderNumber, invoiceContentId }: PrintOrderActionsProps) {
  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = async () => {
    const element = document.getElementById(invoiceContentId);
    if (!element) return;

    try {
      // Load libraries from CDN dynamically
      // @ts-ignore
      if (!window.html2canvas || !window.jspdf) {
        await Promise.all([
          new Promise<void>((resolve, reject) => {
            // @ts-ignore
            if (window.html2canvas) {
              resolve();
              return;
            }
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load html2canvas'));
            document.head.appendChild(script);
          }),
          new Promise<void>((resolve, reject) => {
            // @ts-ignore
            if (window.jspdf) {
              resolve();
              return;
            }
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load jsPDF'));
            document.head.appendChild(script);
          })
        ]);
      }

      // @ts-ignore
      const html2canvas = window.html2canvas;
      // @ts-ignore
      const jsPDF = window.jspdf.jsPDF;

      // Create canvas from HTML element
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      });

      // Convert canvas to image
      const imgData = canvas.toDataURL('image/png');
      
      // Create PDF
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgWidth = 210; // A4 width in mm
      const pageHeight = 297; // A4 height in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      // Add first page
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      // Add additional pages if needed
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      // Save PDF
      pdf.save(`فاکتور_${orderNumber}.pdf`);
    } catch (error) {
      console.error('Error generating PDF:', error);
      // Fallback: Open print dialog
      window.print();
    }
  };

  return (
    <div className="mb-8 flex justify-end gap-2 print:hidden">
      <Button onClick={handlePrint} variant="outline" className="text-foreground dark:text-white border-foreground dark:border-gray-300 hover:bg-accent dark:hover:bg-gray-800">
        <Printer className="w-4 h-4 ml-2" />
        چاپ فاکتور
      </Button>
      <Button onClick={handleDownloadPDF} variant="outline" className="text-foreground dark:text-white border-foreground dark:border-gray-300 hover:bg-accent dark:hover:bg-gray-800">
        <Download className="w-4 h-4 ml-2" />
        دانلود PDF
      </Button>
    </div>
  );
}

