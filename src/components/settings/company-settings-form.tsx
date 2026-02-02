'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useState, useEffect } from 'react';
import {
  getCompanyInfo,
  saveCompanyInfo,
  getWooSettings,
  saveWooSettings,
} from '@/actions/settings';
import { getAccounts } from '@/actions/accounting';
import { getWarehouses } from '@/actions/warehouse';
import {
  getGoogleDriveAuthUrlAction,
  getGoogleDriveStatus,
  disconnectGoogleDrive,
} from '@/actions/google-drive';
import { toast } from 'sonner';
import { useLogo } from '@/components/providers/logo-provider';
import { CheckCircle2, XCircle, Link2 } from 'lucide-react';

export function CompanySettingsForm() {
  const { refreshLogo } = useLogo();
  const [loading, setLoading] = useState(false);
  const [companyInfo, setCompanyInfo] = useState({
    name: '',
    phone: '',
    address: '',
    logo: '',
  });
  const [wooSettings, setWooSettings] = useState({
    url: '',
    consumerKey: '',
    consumerSecret: '',
    accountId: '',
    warehouseId: '',
  });
  const [accounts, setAccounts] = useState<
    Array<{ id: string; name: string; type: string; currency: string }>
  >([]);
  const [warehouses, setWarehouses] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [googleDriveStatus, setGoogleDriveStatus] = useState<{
    connected: boolean;
    folderId?: string | null;
  }>({ connected: false });

  useEffect(() => {
    const loadSettings = async () => {
      const info = await getCompanyInfo();
      if (info) setCompanyInfo(info);

      const woo = await getWooSettings();
      if (woo)
        setWooSettings((prev) => ({
          ...prev,
          ...woo,
          accountId: woo.accountId || '',
          warehouseId: woo.warehouseId || '',
        }));

      const accs = await getAccounts();
      setAccounts(accs);

      const whs = await getWarehouses();
      setWarehouses(whs);

      const gdStatus = await getGoogleDriveStatus();
      setGoogleDriveStatus(gdStatus);
    };
    loadSettings();
  }, []);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setCompanyInfo((prev) => ({ ...prev, logo: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveCompany = async () => {
    setLoading(true);
    const result = await saveCompanyInfo(companyInfo);
    setLoading(false);
    if (result.success) {
      toast.success('تنظیمات شرکت ذخیره شد');
      // Refresh logo in sidebar
      refreshLogo();
    } else {
      toast.error(result.error || 'خطا در ذخیره تنظیمات');
    }
  };

  const handleSaveWoo = async () => {
    setLoading(true);
    const result = await saveWooSettings(wooSettings);
    setLoading(false);
    if (result.success) {
      toast.success('تنظیمات ووکامرس ذخیره شد');
    } else {
      toast.error(result.error || 'خطا در ذخیره تنظیمات');
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>مشخصات شرکت</CardTitle>
            <CardDescription>
              اطلاعات عمومی شرکت که در فاکتورها نمایش داده می‌شود.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="company-name">نام شرکت</Label>
                <Input
                  id="company-name"
                  value={companyInfo.name}
                  onChange={(e) =>
                    setCompanyInfo({ ...companyInfo, name: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company-phone">تلفن تماس</Label>
                <Input
                  id="company-phone"
                  value={companyInfo.phone}
                  onChange={(e) =>
                    setCompanyInfo({ ...companyInfo, phone: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="company-address">آدرس</Label>
                <Input
                  id="company-address"
                  value={companyInfo.address}
                  onChange={(e) =>
                    setCompanyInfo({ ...companyInfo, address: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="company-logo">لوگو</Label>
                <Input
                  id="company-logo"
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                />
                {companyInfo.logo && (
                  <div className="mt-2">
                    <img
                      src={companyInfo.logo}
                      alt="Logo Preview"
                      className="h-20 object-contain"
                    />
                  </div>
                )}
              </div>
            </div>
            <Button
              onClick={handleSaveCompany}
              disabled={loading}
            >
              {loading ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>تنظیمات ووکامرس</CardTitle>
            <CardDescription>
              کلیدهای API برای اتصال به فروشگاه اینترنتی.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="woo-url">آدرس سایت</Label>
                <Input
                  id="woo-url"
                  placeholder="https://example.com"
                  value={wooSettings.url}
                  onChange={(e) =>
                    setWooSettings({ ...wooSettings, url: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="woo-key">Consumer Key</Label>
                <Input
                  id="woo-key"
                  type="password"
                  placeholder="ck_..."
                  value={wooSettings.consumerKey}
                  onChange={(e) =>
                    setWooSettings({
                      ...wooSettings,
                      consumerKey: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="woo-secret">Consumer Secret</Label>
                <Input
                  id="woo-secret"
                  type="password"
                  placeholder="cs_..."
                  value={wooSettings.consumerSecret}
                  onChange={(e) =>
                    setWooSettings({
                      ...wooSettings,
                      consumerSecret: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="woo-account">حساب برای واریز درآمد فروش</Label>
                <Select
                  value={wooSettings.accountId || ''}
                  onValueChange={(value) =>
                    setWooSettings({ ...wooSettings, accountId: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="انتخاب حساب" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((account) => (
                      <SelectItem
                        key={account.id}
                        value={account.id}
                      >
                        {account.name} ({account.currency})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-gray-500">
                  درآمد حاصل از فروش ووکامرس به این حساب واریز می‌شود
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="woo-warehouse">
                  انبار پیش‌فرض برای محصولات
                </Label>
                <Select
                  value={wooSettings.warehouseId || ''}
                  onValueChange={(value) =>
                    setWooSettings({ ...wooSettings, warehouseId: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="انتخاب انبار" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((warehouse) => (
                      <SelectItem
                        key={warehouse.id}
                        value={warehouse.id}
                      >
                        {warehouse.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-gray-500">
                  محصولات سینک شده از ووکامرس در این انبار قرار می‌گیرند
                </p>
              </div>
            </div>
            <Button
              variant="secondary"
              onClick={handleSaveWoo}
              disabled={loading}
            >
              {loading ? 'در حال ذخیره...' : 'ذخیره تنظیمات'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>ذخیره‌سازی Google Drive</CardTitle>
            <CardDescription>
              اتصال به Google Drive برای ذخیره فایل‌های رسید و فاکتورها. تمام
              فایل‌ها در پوشه "Themoak ERP Receipts" ذخیره می‌شوند.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center gap-3">
                {googleDriveStatus.connected ? (
                  <>
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <div>
                      <p className="font-medium">متصل به Google Drive</p>
                      <p className="text-sm text-muted-foreground">
                        فایل‌ها به Google Drive شما آپلود می‌شوند
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <XCircle className="h-5 w-5 text-red-500" />
                    <div>
                      <p className="font-medium">متصل نشده</p>
                      <p className="text-sm text-muted-foreground">
                        برای ذخیره فایل‌ها، به Google Drive متصل شوید
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>

            {!googleDriveStatus.connected ? (
              <Button
                onClick={async () => {
                  const result = await getGoogleDriveAuthUrlAction();
                  if (result.success && result.url) {
                    window.location.href = result.url;
                  } else {
                    toast.error('خطا در اتصال به Google Drive');
                  }
                }}
                className="w-full"
              >
                <Link2 className="ml-2 h-4 w-4" />
                اتصال به Google Drive
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={async () => {
                  const result = await disconnectGoogleDrive();
                  if (result.success) {
                    toast.success('از Google Drive قطع شد');
                    setGoogleDriveStatus({ connected: false });
                  } else {
                    toast.error(result.error || 'خطا در قطع اتصال');
                  }
                }}
                className="w-full"
              >
                قطع اتصال از Google Drive
              </Button>
            )}

            <div className="text-sm text-muted-foreground space-y-1">
              <p>
                • برای استفاده از این قابلیت، نیاز به Google Cloud Project و
                OAuth 2.0 credentials دارید.
              </p>
              <p>
                • فایل‌های آپلود شده در پوشه "Themoak ERP Receipts" در Google
                Drive شما ذخیره می‌شوند.
              </p>
              <p>
                • متغیرهای محیطی مورد نیاز: GOOGLE_CLIENT_ID,
                GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
