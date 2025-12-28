'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { syncProducts, syncOrders, testWooCommerceConnection, debugProductMatching } from '@/actions/woocommerce';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';
import { RefreshCw, ShoppingCart, Package, CheckCircle2, XCircle, Wifi } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function WooCommercePage() {
  const router = useRouter();
  const [isSyncingProducts, setIsSyncingProducts] = useState(false);
  const [isSyncingOrders, setIsSyncingOrders] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isDebugging, setIsDebugging] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<{
    success: boolean;
    message: string;
    details?: any;
  } | undefined>(undefined);
  const [debugResult, setDebugResult] = useState<any>(undefined);

  const handleSyncProducts = async () => {
    setIsSyncingProducts(true);
    try {
      const result = await syncProducts();
      if (result.success) {
        toast.success(`محصولات سینک شدند: ${result.data?.created} جدید، ${result.data?.updated} به‌روزرسانی شد`);
      } else {
        toast.error(result.error || 'خطا در سینک محصولات');
        console.error('Sync products error:', result);
      }
    } catch (error: any) {
      console.error('Sync products exception:', error);
      toast.error(error?.message || 'خطا در سینک محصولات');
    } finally {
      setIsSyncingProducts(false);
    }
  };

  const handleSyncOrders = async () => {
    setIsSyncingOrders(true);
    console.log('[CLIENT] شروع سینک سفارشات...');
    try {
      console.log('[CLIENT] فراخوانی syncOrders...');
      const result = await syncOrders();
      console.log('[CLIENT] نتیجه syncOrders:', JSON.stringify(result, null, 2));
      
      if (result.success && result.data) {
        console.log('[CLIENT] سینک موفق بود:', {
          created: result.data.created,
          skipped: result.data.skipped,
          totalOrders: result.data.totalOrders,
          totalOrdersInWooCommerce: result.data.totalOrdersInWooCommerce,
          stats: result.data.stats,
          errorCount: result.data.errorCount,
          message: result.message,
          debugLogs: result.data.debugLogs
        });

        // Log debug logs if available
        if (result.data.debugLogs && result.data.debugLogs.length > 0) {
          console.log('[CLIENT] لاگ‌های Debug:');
          result.data.debugLogs.forEach((log: string) => console.log(log));
        }

        if (result.message) {
          toast.success(result.message);
        } else {
          toast.success(`Orders synced: ${result.data.created} new transactions created`);
        }
        if (result.errors && Array.isArray(result.errors) && result.errors.length > 0) {
          console.warn('[CLIENT] خطاها در حین سینک:', result.errors);
          // Show errors in console for debugging
          result.errors.forEach((err: string) => {
            console.error('[CLIENT] خطا:', err);
          });
        }
        // Refresh the router to update cached pages
        router.refresh();
      } else {
        console.error('[CLIENT] سینک ناموفق بود:', result);
        toast.error(result.message || result.error || 'Failed to sync orders');
      }
    } catch (error: any) {
      console.error('[CLIENT] خطا در handleSyncOrders:', error);
      toast.error(error.message || 'An error occurred');
    } finally {
      setIsSyncingOrders(false);
      console.log('[CLIENT] پایان سینک سفارشات');
    }
  };

  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setConnectionStatus(undefined);
    try {
      const result = await testWooCommerceConnection();
      setConnectionStatus(result);
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch (error: any) {
      setConnectionStatus({
        success: false,
        message: error.message || 'خطا در تست اتصال',
      });
      toast.error('خطا در تست اتصال');
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleDebugProductMatching = async () => {
    setIsDebugging(true);
    setDebugResult(undefined);
    try {
      const result = await debugProductMatching();
      setDebugResult(result);
      console.log('[CLIENT] نتیجه debugProductMatching:', result);
      if (result.success) {
        toast.success(result.message || 'Debug completed');
      } else {
        toast.error(result.message || 'Debug failed');
      }
    } catch (error: any) {
      setDebugResult({
        success: false,
        error: error.message || 'Unknown error'
      });
      toast.error('خطا در debug');
    } finally {
      setIsDebugging(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">WooCommerce Integration</h1>
      
      {/* Connection Test */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wifi className="h-5 w-5" />
            تست اتصال
          </CardTitle>
          <CardDescription>
            بررسی اتصال به WooCommerce و دسترسی به API
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button 
            onClick={handleTestConnection} 
            disabled={isTestingConnection}
            className="w-full"
            variant="outline"
          >
            {isTestingConnection ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                در حال تست...
              </>
            ) : (
              <>
                <Wifi className="mr-2 h-4 w-4" />
                تست اتصال
              </>
            )}
          </Button>
          
          {connectionStatus && (
            <Alert className={connectionStatus.success ? 'border-green-500 bg-green-50 dark:bg-green-950' : 'border-red-500 bg-red-50 dark:bg-red-950'}>
              <div className="flex items-center gap-2">
                {connectionStatus.success ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-600" />
                )}
                <AlertTitle className={connectionStatus.success ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'}>
                  {connectionStatus.success ? 'اتصال موفق' : 'اتصال ناموفق'}
                </AlertTitle>
              </div>
              <AlertDescription className={connectionStatus.success ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}>
                {connectionStatus.message}
                {connectionStatus.details && (
                  <div className="mt-2 text-sm">
                    {connectionStatus.details.productsCount !== undefined && (
                      <p>تعداد محصولات قابل دسترسی: {connectionStatus.details.productsCount}</p>
                    )}
                    {connectionStatus.details.ordersCount !== undefined && (
                      <p>تعداد سفارشات قابل دسترسی: {connectionStatus.details.ordersCount}</p>
                    )}
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Debug Product Matching */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Debug Product Matching
          </CardTitle>
          <CardDescription>
            بررسی تطابق محصولات بین WooCommerce و سیستم
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button 
            onClick={handleDebugProductMatching} 
            disabled={isDebugging}
            className="w-full"
            variant="outline"
          >
            {isDebugging ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                در حال بررسی...
              </>
            ) : (
              'Debug Product Matching'
            )}
          </Button>
          
          {debugResult && (
            <Alert className={debugResult.success ? 'border-green-500 bg-green-50 dark:bg-green-950' : 'border-red-500 bg-red-50 dark:bg-red-950'}>
              <AlertTitle className={debugResult.success ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'}>
                {debugResult.message}
              </AlertTitle>
              <AlertDescription className={debugResult.success ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}>
                <pre className="text-xs mt-2 overflow-auto max-h-96">
                  {JSON.stringify(debugResult, null, 2)}
                </pre>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Products
            </CardTitle>
            <CardDescription>
              Sync products from WooCommerce to local inventory.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={handleSyncProducts} 
              disabled={isSyncingProducts}
              className="w-full"
            >
              {isSyncingProducts ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Syncing...
                </>
              ) : (
                'Sync Products'
              )}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />
              Orders
            </CardTitle>
            <CardDescription>
              Import WooCommerce orders as sales transactions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={handleSyncOrders} 
              disabled={isSyncingOrders}
              className="w-full"
            >
              {isSyncingOrders ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Syncing...
                </>
              ) : (
                'Sync Orders'
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
