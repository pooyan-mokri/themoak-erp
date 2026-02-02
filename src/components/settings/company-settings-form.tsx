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
  saveFTPCredentials,
  getFTPCredentials,
  testFTPConnectionAction,
} from '@/actions/ftp';
import { toast } from 'sonner';
import { useLogo } from '@/components/providers/logo-provider';
import { CheckCircle2, XCircle, Link2, TestTube } from 'lucide-react';

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
  const [ftpCredentials, setFTPCredentials] = useState({
    host: '',
    port: 21,
    user: '',
    password: '',
    secure: false,
    basePath: '/uploads/receipts',
  });
  const [ftpTestResult, setFTPTestResult] = useState<{
    success: boolean;
    error?: string;
  } | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);

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

      const ftpCreds = await getFTPCredentials();
      if (ftpCreds) {
        setFTPCredentials({
          host: ftpCreds.host || '',
          port: ftpCreds.port || 21,
          user: ftpCreds.user || '',
          password: ftpCreds.password || '',
          secure: ftpCreds.secure || false,
          basePath: ftpCreds.basePath || '/uploads/receipts',
        });
      }
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
            <CardTitle>ذخیره‌سازی FTP</CardTitle>
            <CardDescription>
              تنظیمات FTP برای ذخیره فایل‌های رسید و فاکتورها. تمام فایل‌ها در
              مسیر مشخص شده در سرور FTP ذخیره می‌شوند.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ftp-host">آدرس سرور FTP</Label>
                <Input
                  id="ftp-host"
                  type="text"
                  placeholder="ftp.example.com"
                  value={ftpCredentials.host}
                  onChange={(e) =>
                    setFTPCredentials({
                      ...ftpCredentials,
                      host: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ftp-port">پورت</Label>
                <Input
                  id="ftp-port"
                  type="number"
                  placeholder="21"
                  value={ftpCredentials.port}
                  onChange={(e) =>
                    setFTPCredentials({
                      ...ftpCredentials,
                      port: parseInt(e.target.value) || 21,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ftp-user">نام کاربری</Label>
                <Input
                  id="ftp-user"
                  type="text"
                  placeholder="username"
                  value={ftpCredentials.user}
                  onChange={(e) =>
                    setFTPCredentials({
                      ...ftpCredentials,
                      user: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ftp-password">رمز عبور</Label>
                <Input
                  id="ftp-password"
                  type="password"
                  placeholder="password"
                  value={ftpCredentials.password}
                  onChange={(e) =>
                    setFTPCredentials({
                      ...ftpCredentials,
                      password: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ftp-base-path">مسیر پایه</Label>
                <Input
                  id="ftp-base-path"
                  type="text"
                  placeholder="/uploads/receipts"
                  value={ftpCredentials.basePath}
                  onChange={(e) =>
                    setFTPCredentials({
                      ...ftpCredentials,
                      basePath: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-2 flex items-end">
                <div className="flex items-center space-x-2 space-x-reverse">
                  <input
                    type="checkbox"
                    id="ftp-secure"
                    checked={ftpCredentials.secure}
                    onChange={(e) =>
                      setFTPCredentials({
                        ...ftpCredentials,
                        secure: e.target.checked,
                      })
                    }
                    className="rounded"
                  />
                  <Label htmlFor="ftp-secure" className="cursor-pointer">
                    استفاده از FTPS (امن)
                  </Label>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  setLoading(true);
                  const result = await saveFTPCredentials(ftpCredentials);
                  setLoading(false);
                  if (result.success) {
                    toast.success('تنظیمات FTP ذخیره شد');
                    setFTPTestResult(null);
                  } else {
                    toast.error(result.error || 'خطا در ذخیره تنظیمات');
                  }
                }}
                disabled={loading || !ftpCredentials.host || !ftpCredentials.user}
                className="flex-1"
              >
                {loading ? 'در حال ذخیره...' : 'ذخیره تنظیمات'}
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  setIsTestingConnection(true);
                  setFTPTestResult(null);
                  const result = await testFTPConnectionAction();
                  setIsTestingConnection(false);
                  setFTPTestResult(result);
                  if (result.success) {
                    toast.success('اتصال به FTP موفق بود');
                  } else {
                    toast.error(result.error || 'خطا در اتصال به FTP');
                  }
                }}
                disabled={isTestingConnection || !ftpCredentials.host || !ftpCredentials.user}
                className="flex-1"
              >
                <TestTube className="ml-2 h-4 w-4" />
                {isTestingConnection ? 'در حال تست...' : 'تست اتصال'}
              </Button>
            </div>

            {ftpTestResult && (
              <div
                className={`p-3 rounded-md border ${
                  ftpTestResult.success
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                }`}
              >
                <div className="flex items-center gap-2">
                  {ftpTestResult.success ? (
                    <>
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                      <p className="text-sm text-green-800 dark:text-green-200">
                        اتصال موفق: سرور FTP در دسترس است
                      </p>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-5 w-5 text-red-500" />
                      <p className="text-sm text-red-800 dark:text-red-200">
                        خطا: {ftpTestResult.error || 'اتصال به FTP ناموفق بود'}
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="text-sm text-muted-foreground space-y-1">
              <p>
                • فایل‌های آپلود شده در مسیر مشخص شده در سرور FTP ذخیره
                می‌شوند.
              </p>
              <p>
                • برای استفاده از FTPS، گزینه "استفاده از FTPS" را فعال کنید.
              </p>
              <p>
                • پس از وارد کردن اطلاعات، دکمه "تست اتصال" را برای بررسی
                اتصال استفاده کنید.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
