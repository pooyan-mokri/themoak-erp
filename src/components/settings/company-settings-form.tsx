'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useState, useEffect, useRef } from 'react';
import {
  getCompanyInfo,
  saveCompanyInfo,
  getWooSettings,
  saveWooSettings,
} from '@/actions/settings';
import { getWarehouses } from '@/actions/warehouse';
import {
  saveFTPCredentials,
  getFTPCredentials,
  testFTPConnectionAction,
} from '@/actions/ftp';
import { toast } from 'sonner';
import { useLogo } from '@/components/providers/logo-provider';
import { CheckCircle2, ImageIcon, TestTube, Upload, XCircle } from 'lucide-react';
import { FieldRow, PanelActions, SettingsPanel, StatusNote } from './settings-panel';

/**
 * The company card is one free-form setting (SystemSetting «company_info»), saved whole:
 * name, phone, address and logo print on the invoice; the other fields are kept with them.
 */
const EMPTY_COMPANY = {
  name: '',
  legalName: '',
  taxId: '',
  phone: '',
  address: '',
  website: '',
  instagram: '',
  logo: '',
};

export function CompanySettingsForm() {
  const { refreshLogo } = useLogo();
  const [loading, setLoading] = useState(false);
  const [companyInfo, setCompanyInfo] = useState(EMPTY_COMPANY);
  const [wooSettings, setWooSettings] = useState({
    warehouseId: '',
  });
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
    ignoreCertificateErrors: false,
  });
  // The saved password never comes to the page; an empty field keeps it.
  const [ftpHasPassword, setFTPHasPassword] = useState(false);
  const [ftpTestResult, setFTPTestResult] = useState<{
    success: boolean;
    error?: string;
  } | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const loadSettings = async () => {
      const info = await getCompanyInfo();
      // Fields saved before this form had them read as empty, and any other stored field is kept.
      if (info) setCompanyInfo({ ...EMPTY_COMPANY, ...info });

      const woo = await getWooSettings();
      setWooSettings({ warehouseId: woo.warehouseId || '' });

      const whs = await getWarehouses();
      // A consignment (virtual) warehouse is never used to restore stock, so it is not offered.
      setWarehouses(whs.filter((warehouse: any) => !warehouse.isVirtual));

      const ftpCreds = await getFTPCredentials();
      if (ftpCreds) {
        setFTPCredentials({
          host: ftpCreds.host || '',
          port: ftpCreds.port || 21,
          user: ftpCreds.user || '',
          password: '',
          secure: ftpCreds.secure || false,
          basePath: ftpCreds.basePath || '/uploads/receipts',
          ignoreCertificateErrors: ftpCreds.ignoreCertificateErrors || false,
        });
        setFTPHasPassword(ftpCreds.hasPassword);
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
      toast.success('انبار پیش‌فرض برگشت موجودی ذخیره شد');
    } else {
      toast.error(result.error || 'خطا در ذخیره تنظیمات');
    }
  };

  const setCompany = (field: keyof typeof EMPTY_COMPANY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setCompanyInfo((prev) => ({ ...prev, [field]: e.target.value }));

  return (
    <>
      <SettingsPanel
        title="مشخصات شرکت"
        description="نام، تلفن، آدرس و لوگو روی فاکتورِ چاپی می‌آیند."
      >
        <FieldRow label="نام شرکت" htmlFor="company-name">
          <Input id="company-name" value={companyInfo.name} onChange={setCompany('name')} />
        </FieldRow>
        <FieldRow label="نام حقوقی" htmlFor="company-legal-name">
          <Input id="company-legal-name" value={companyInfo.legalName} onChange={setCompany('legalName')} />
        </FieldRow>
        <FieldRow label="شناسهٔ ملی یا مالیاتی" htmlFor="company-tax-id">
          <Input
            id="company-tax-id"
            dir="ltr"
            className="font-mono"
            value={companyInfo.taxId}
            onChange={setCompany('taxId')}
          />
        </FieldRow>

        <div className="my-2 border-t" />

        <FieldRow label="تلفن تماس" htmlFor="company-phone">
          <Input id="company-phone" dir="ltr" value={companyInfo.phone} onChange={setCompany('phone')} />
        </FieldRow>
        <FieldRow label="آدرس" htmlFor="company-address">
          <Input id="company-address" value={companyInfo.address} onChange={setCompany('address')} />
        </FieldRow>
        <FieldRow label="وب‌سایت" htmlFor="company-website">
          <Input
            id="company-website"
            dir="ltr"
            className="font-mono"
            placeholder="themoak.com"
            value={companyInfo.website}
            onChange={setCompany('website')}
          />
        </FieldRow>
        <FieldRow
          label="اینستاگرام"
          htmlFor="company-instagram"
          hint="نام حقوقی، شناسه، وب‌سایت و اینستاگرام همین‌جا نگه داشته می‌شوند و هنوز روی فاکتور چاپ نمی‌شوند."
        >
          <Input
            id="company-instagram"
            dir="ltr"
            className="font-mono"
            placeholder="@themoak"
            value={companyInfo.instagram}
            onChange={setCompany('instagram')}
          />
        </FieldRow>

        <div className="my-2 border-t" />

        <FieldRow label="لوگو" htmlFor="company-logo" hint="تصویری با زمینهٔ شفاف؛ در منوی کناری و روی فاکتور نمایش داده می‌شود.">
          <div className="flex items-center gap-4">
            <div className="grid h-20 w-20 shrink-0 place-items-center rounded-lg border bg-secondary">
              {companyInfo.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={companyInfo.logo} alt="پیش‌نمایش لوگو" className="max-h-16 max-w-16 object-contain" />
              ) : (
                <ImageIcon className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
              )}
            </div>
            <Button type="button" variant="outline" onClick={() => logoInput.current?.click()}>
              <Upload className="h-4 w-4" />
              {companyInfo.logo ? 'تعویض لوگو' : 'انتخاب لوگو'}
            </Button>
            <input
              ref={logoInput}
              id="company-logo"
              type="file"
              accept="image/*"
              onChange={handleLogoUpload}
              className="hidden"
            />
          </div>
        </FieldRow>

        <PanelActions>
          <Button onClick={handleSaveCompany} disabled={loading}>
            {loading ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
          </Button>
        </PanelActions>
      </SettingsPanel>

      <SettingsPanel
        title="انبار پیش‌فرض برگشت موجودی"
        description="وقتی فروشی لغو می‌شود و انبار اقلامش ثبت نشده، موجودی به این انبار برمی‌گردد."
      >
        <FieldRow label="انبار برگشت موجودی" htmlFor="woo-warehouse">
          <Select
            value={wooSettings.warehouseId || ''}
            onValueChange={(value) =>
              setWooSettings({ ...wooSettings, warehouseId: value })
            }
          >
            <SelectTrigger id="woo-warehouse" className="sm:max-w-sm">
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
        </FieldRow>
        <PanelActions>
          <Button onClick={handleSaveWoo} disabled={loading}>
            {loading ? 'در حال ذخیره...' : 'ذخیره تنظیمات'}
          </Button>
        </PanelActions>
      </SettingsPanel>

      <SettingsPanel
        title="ذخیره‌سازی FTP"
        description="فایل‌های رسید و فاکتورها در مسیر مشخص‌شده روی سرور FTP ذخیره می‌شوند."
      >
        <FieldRow label="آدرس سرور FTP" htmlFor="ftp-host">
          <Input
            id="ftp-host"
            type="text"
            dir="ltr"
            className="font-mono"
            placeholder="ftp.example.com"
            value={ftpCredentials.host}
            onChange={(e) =>
              setFTPCredentials({
                ...ftpCredentials,
                host: e.target.value,
              })
            }
          />
        </FieldRow>
        <FieldRow label="پورت" htmlFor="ftp-port">
          <Input
            id="ftp-port"
            type="number"
            dir="ltr"
            className="font-mono sm:max-w-[120px]"
            placeholder="21"
            value={ftpCredentials.port}
            onChange={(e) =>
              setFTPCredentials({
                ...ftpCredentials,
                port: parseInt(e.target.value) || 21,
              })
            }
          />
        </FieldRow>
        <FieldRow label="نام کاربری" htmlFor="ftp-user">
          <Input
            id="ftp-user"
            type="text"
            dir="ltr"
            className="font-mono"
            placeholder="username"
            value={ftpCredentials.user}
            onChange={(e) =>
              setFTPCredentials({
                ...ftpCredentials,
                user: e.target.value,
              })
            }
          />
        </FieldRow>
        <FieldRow label="رمز عبور" htmlFor="ftp-password">
          <Input
            id="ftp-password"
            type="password"
            dir="ltr"
            // The saved password never comes to the page; an empty field keeps it.
            placeholder={ftpHasPassword ? 'ذخیره شده؛ برای تغییر، رمز تازه را وارد کنید' : 'password'}
            value={ftpCredentials.password}
            onChange={(e) =>
              setFTPCredentials({
                ...ftpCredentials,
                password: e.target.value,
              })
            }
          />
        </FieldRow>
        <FieldRow label="مسیر پایه" htmlFor="ftp-base-path">
          <Input
            id="ftp-base-path"
            type="text"
            dir="ltr"
            className="font-mono"
            placeholder="/uploads/receipts"
            value={ftpCredentials.basePath}
            onChange={(e) =>
              setFTPCredentials({
                ...ftpCredentials,
                basePath: e.target.value,
              })
            }
          />
        </FieldRow>
        <FieldRow label="اتصال امن" htmlFor="ftp-secure">
          <div className="flex min-h-9 items-center gap-2.5">
            <Switch
              id="ftp-secure"
              checked={ftpCredentials.secure}
              onCheckedChange={(checked) =>
                setFTPCredentials({
                  ...ftpCredentials,
                  secure: checked,
                })
              }
            />
            <Label htmlFor="ftp-secure" className="cursor-pointer text-[13px] font-normal">
              استفاده از FTPS (امن)
            </Label>
          </div>
          {ftpCredentials.secure && (
            <div className="mt-2 flex items-start gap-2.5">
              <Switch
                id="ftp-ignore-cert"
                checked={ftpCredentials.ignoreCertificateErrors}
                onCheckedChange={(checked) =>
                  setFTPCredentials({
                    ...ftpCredentials,
                    ignoreCertificateErrors: checked,
                  })
                }
              />
              <Label htmlFor="ftp-ignore-cert" className="cursor-pointer text-[13px] font-normal leading-relaxed">
                نادیده گرفتن خطاهای گواهینامه SSL (برای سرورهایی که گواهینامه مطابقت ندارد)
              </Label>
            </div>
          )}
        </FieldRow>

        {ftpTestResult && (
          <StatusNote tone={ftpTestResult.success ? 'success' : 'danger'} className="mt-2 flex items-center gap-2">
            {ftpTestResult.success ? (
              <>
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                اتصال موفق: سرور FTP در دسترس است
              </>
            ) : (
              <>
                <XCircle className="h-4 w-4 shrink-0" />
                خطا: {ftpTestResult.error || 'اتصال به FTP ناموفق بود'}
              </>
            )}
          </StatusNote>
        )}

        <PanelActions>
          <Button
            onClick={async () => {
              setLoading(true);
              const result = await saveFTPCredentials(ftpCredentials);
              setLoading(false);
              if (result.success) {
                toast.success('تنظیمات FTP ذخیره شد');
                setFTPTestResult(null);
                setFTPHasPassword(true);
                setFTPCredentials((prev) => ({ ...prev, password: '' }));
              } else {
                toast.error(result.error || 'خطا در ذخیره تنظیمات');
              }
            }}
            disabled={loading || !ftpCredentials.host || !ftpCredentials.user}
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
          >
            <TestTube className="h-4 w-4" />
            {isTestingConnection ? 'در حال تست...' : 'تست اتصال'}
          </Button>
        </PanelActions>

        <ul className="mt-3 list-disc space-y-1 ps-5 text-xs leading-relaxed text-muted-foreground">
          <li>فایل‌های آپلود شده در مسیر مشخص شده در سرور FTP ذخیره می‌شوند.</li>
          <li>برای استفاده از FTPS، گزینهٔ «استفاده از FTPS» را روشن کنید.</li>
          <li>تست اتصال با تنظیمات ذخیره‌شده انجام می‌شود؛ پس از وارد کردن اطلاعات، اول ذخیره کنید.</li>
        </ul>
      </SettingsPanel>
    </>
  );
}
