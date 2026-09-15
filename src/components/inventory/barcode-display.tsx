'use client';

import { useEffect, useRef } from 'react';

interface BarcodeDisplayProps {
  barcode: string;
  format: 'UPC' | 'EAN13' | 'CODE128';
}

// One script tag per page: a sheet of labels mounts many BarcodeDisplays at once.
let jsBarcodePromise: Promise<any> | null = null;

function loadJsBarcode(): Promise<any> {
  if ((window as any).JsBarcode) {
    return Promise.resolve((window as any).JsBarcode);
  }
  if (!jsBarcodePromise) {
    jsBarcodePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js';
      script.onload = () => resolve((window as any).JsBarcode);
      script.onerror = () => {
        // Let a later render try again instead of failing for the rest of the visit.
        jsBarcodePromise = null;
        script.remove();
        reject(new Error('Failed to load JsBarcode'));
      };
      document.head.appendChild(script);
    });
  }
  return jsBarcodePromise;
}

export function BarcodeDisplay({ barcode, format }: BarcodeDisplayProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let cancelled = false;

    loadJsBarcode()
      .then((JsBarcode) => {
        const svg = svgRef.current;
        if (cancelled || !svg) return;
        try {
          JsBarcode(svg, barcode, {
            format: format,
            width: 2,
            height: 60,
            displayValue: false, // We display the value separately
            // 11 bar widths of white on each side inside the SVG (EAN-13 needs 11 and 7, Code 128 needs 10), so the quiet
            // zone scales with the bars on every label size. Flat guard bars keep the bars off the text above and below.
            margin: 0,
            marginLeft: 22,
            marginRight: 22,
            flat: true,
          });
        } catch (error) {
          // Never leave the bars of a previous code on screen.
          svg.innerHTML = '';
          console.error('Error rendering barcode:', error);
        }
      })
      .catch((error) => {
        console.error('Error loading barcode library:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [barcode, format]);

  return (
    <div className="flex justify-center w-full">
      <svg ref={svgRef} className="w-full h-auto"></svg>
    </div>
  );
}
