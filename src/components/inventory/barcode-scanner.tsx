'use client';

import { useEffect, useRef, useState, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Camera, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// Declare Html5Qrcode type from CDN
declare global {
  interface Window {
    Html5Qrcode: any;
  }
}

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  onClose?: () => void;
}

export interface BarcodeScannerHandle {
  stopScanning: () => void;
}

const BarcodeScannerComponent = forwardRef<BarcodeScannerHandle, BarcodeScannerProps>(
  ({ onScan, onClose }, ref) => {
    const [isScanning, setIsScanning] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);
    const [isLibraryLoaded, setIsLibraryLoaded] = useState(false);
    const scannerRef = useRef<any | null>(null);
    const isScannerStartedRef = useRef<boolean>(false);
    const scannerId = 'barcode-scanner';

    // Load html5-qrcode library from CDN
    useEffect(() => {
      if (typeof window !== 'undefined' && !window.Html5Qrcode) {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
        script.async = true;
        script.onload = () => {
          setIsLibraryLoaded(true);
        };
        script.onerror = () => {
          setError('خطا در بارگذاری کتابخانه اسکن بارکد.');
        };
        document.head.appendChild(script);

        return () => {
          // Only remove script if it's still in the DOM
          if (script.parentNode) {
            document.head.removeChild(script);
          }
        };
      } else if (window.Html5Qrcode) {
        setIsLibraryLoaded(true);
      }
    }, []);

    const stopScanning = useCallback(async () => {
      if (scannerRef.current && isScannerStartedRef.current) {
        try {
          await scannerRef.current.stop();
          await scannerRef.current.clear();
        } catch (err: any) {
          // Ignore errors if scanner is already stopped
          if (err?.message && !err.message.includes('not running') && !err.message.includes('not started')) {
            console.error('Error stopping scanner:', err);
          }
        }
        scannerRef.current = null;
        isScannerStartedRef.current = false;
        setIsScanning(false);
      } else {
        // If scanner was never started, just reset state
        scannerRef.current = null;
        isScannerStartedRef.current = false;
        setIsScanning(false);
      }
    }, []);

    const startScanning = () => {
      if (!isLibraryLoaded || !window.Html5Qrcode) {
        setError('کتابخانه اسکن بارکد هنوز بارگذاری نشده است. لطفاً صبر کنید.');
        return;
      }

      // First set isScanning to true to render the element
      setIsScanning(true);
    };

    // Start scanner after element is rendered
    useEffect(() => {
      if (!isScanning || !isLibraryLoaded || !window.Html5Qrcode) {
        return;
      }

      const initScanner = async () => {
        // Wait for the element to be rendered
        await new Promise(resolve => setTimeout(resolve, 200));

        const element = document.getElementById(scannerId);
        if (!element) {
          setError('عنصر اسکنر یافت نشد. لطفاً دوباره تلاش کنید.');
          setIsScanning(false);
          return;
        }

        try {
          setError(null);
          const Html5Qrcode = window.Html5Qrcode;
          const scanner = new Html5Qrcode(scannerId);
          scannerRef.current = scanner;

          await scanner.start(
            {
              facingMode: 'environment', // Use back camera on mobile
            },
            {
              fps: 10,
              qrbox: { width: 250, height: 250 },
              aspectRatio: 1.0,
            },
            (decodedText: string) => {
              // Successfully scanned
              onScan(decodedText);
              stopScanning();
            },
            (errorMessage: string) => {
              // Ignore scanning errors (they're normal while scanning)
            }
          );
          
          // Mark scanner as successfully started
          isScannerStartedRef.current = true;
        } catch (err: any) {
          console.error('Error starting scanner:', err);
          
          // Provide specific error messages
          if (err?.message?.includes('Permission denied') || err?.message?.includes('NotAllowedError')) {
            setError('دسترسی به دوربین رد شد. لطفاً در تنظیمات مرورگر دسترسی دوربین را فعال کنید.');
          } else if (err?.message?.includes('NotFoundError') || err?.message?.includes('no camera')) {
            setError('دوربینی یافت نشد. لطفاً اطمینان حاصل کنید که دوربین به دستگاه متصل است.');
          } else {
            setError('خطا در راه‌اندازی دوربین. لطفاً دسترسی دوربین را بررسی کنید و دوباره تلاش کنید.');
          }
          
          scannerRef.current = null;
          isScannerStartedRef.current = false;
          setIsScanning(false);
        }
      };

      initScanner();

      return () => {
        // Cleanup on unmount or when dependencies change
        if (scannerRef.current && isScannerStartedRef.current) {
          stopScanning();
        } else {
          // Reset state if scanner never started
          scannerRef.current = null;
          isScannerStartedRef.current = false;
          setIsScanning(false);
        }
      };
    }, [isScanning, isLibraryLoaded, onScan, stopScanning]);

    // Expose stopScanning method via ref
    useImperativeHandle(ref, () => ({
      stopScanning,
    }));

    return (
      <div className="space-y-4">
        {!isScanning ? (
          <Button
            onClick={startScanning}
            className="w-full"
            type="button"
            disabled={!isLibraryLoaded}
          >
            <Camera className="h-4 w-4 mr-2" />
            {isLibraryLoaded ? 'شروع اسکن با دوربین' : 'در حال بارگذاری...'}
          </Button>
        ) : (
          <div className="space-y-4">
            <div className="relative">
              <div id={scannerId} className="w-full rounded-lg overflow-hidden min-h-[300px]" />
              <div className="absolute top-2 right-2 z-10">
                <Button
                  onClick={stopScanning}
                  size="sm"
                  variant="destructive"
                  type="button"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <p className="text-sm text-center text-muted-foreground">
              بارکد را در مقابل دوربین قرار دهید
            </p>
          </div>
        )}
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}
      </div>
    );
  }
);

BarcodeScannerComponent.displayName = 'BarcodeScanner';

export const BarcodeScanner = BarcodeScannerComponent;

// Dialog wrapper for scanner
interface BarcodeScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (barcode: string) => void;
}

export function BarcodeScannerDialog({ open, onOpenChange, onScan }: BarcodeScannerDialogProps) {
  const scannerRef = useRef<BarcodeScannerHandle | null>(null);

  const handleScan = (barcode: string) => {
    onScan(barcode);
    onOpenChange(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && scannerRef.current) {
      // Stop scanner when dialog closes
      scannerRef.current.stopScanning();
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>اسکن بارکد با دوربین</DialogTitle>
          <DialogDescription>
            بارکد محصول را با دوربین موبایل اسکن کنید
          </DialogDescription>
        </DialogHeader>
        <BarcodeScanner 
          onScan={handleScan} 
          onClose={() => onOpenChange(false)}
          ref={scannerRef}
        />
      </DialogContent>
    </Dialog>
  );
}
