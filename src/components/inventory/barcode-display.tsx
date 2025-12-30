'use client';

import { useEffect, useRef } from 'react';

interface BarcodeDisplayProps {
  barcode: string;
  format: 'UPC' | 'EAN13' | 'CODE128';
}

export function BarcodeDisplay({ barcode, format }: BarcodeDisplayProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    // Load JsBarcode dynamically
    const loadBarcode = async () => {
      try {
        // Check if JsBarcode is already loaded
        if (typeof window !== 'undefined' && (window as any).JsBarcode) {
          renderBarcode();
        } else {
          // Load the script
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js';
          script.onload = () => {
            renderBarcode();
          };
          document.head.appendChild(script);
        }
      } catch (error) {
        console.error('Error loading barcode library:', error);
      }
    };

    const renderBarcode = () => {
      if (svgRef.current && (window as any).JsBarcode) {
        try {
          (window as any).JsBarcode(svgRef.current, barcode, {
            format: format,
            width: 2,
            height: 60,
            displayValue: false, // We display the value separately
            margin: 0,
          });
        } catch (error) {
          console.error('Error rendering barcode:', error);
        }
      }
    };

    loadBarcode();
  }, [barcode, format]);

  return (
    <div className="flex justify-center w-full">
      <svg ref={svgRef} className="w-full h-auto"></svg>
    </div>
  );
}

