'use client';

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";
import { createBackup, getBackupSettings, saveBackupSettings, getLastBackup, listBackups } from "@/actions/backup";
import { toast } from "sonner";
import { Download, Database } from "lucide-react";
import { formatJalaliDate } from "@/lib/date-utils";
import { FieldRow, PanelActions, SettingsPanel, StatusNote } from "./settings-panel";

export function BackupSettings() {
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState({
    enabled: false,
    frequency: 'daily' as 'daily' | 'weekly' | 'monthly',
    time: '02:00',
    dayOfWeek: 0,
    dayOfMonth: 1,
    keepBackups: 30,
  });
  const [lastBackup, setLastBackup] = useState<any>(undefined);
  const [backups, setBackups] = useState<any[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const backupSettings = await getBackupSettings();
    if (backupSettings) {
      setSettings(prev => ({ ...prev, ...backupSettings }));
    }

    const last = await getLastBackup();
    if (last) {
      setLastBackup(last);
    }

    await loadBackups();
  };

  const loadBackups = async () => {
    setLoadingBackups(true);
    try {
      const result = await listBackups();
      if (result.success && result.backups) {
        setBackups(result.backups);
      }
    } catch (error) {
      console.error('Error loading backups:', error);
    } finally {
      setLoadingBackups(false);
    }
  };

  const handleCreateBackup = async () => {
    setLoading(true);
    try {
      const result = await createBackup();
      if (result.success) {
        toast.success('بک‌آپ با موفقیت ایجاد شد');
        setLastBackup({
          filename: result.filename,
          downloadUrl: result.downloadUrl,
          sizeInMB: result.sizeInMB,
          createdAt: new Date().toISOString(),
        });
        await loadBackups();
      } else {
        toast.error(result.error || 'خطا در ایجاد بک‌آپ');
      }
    } catch (error: any) {
      toast.error(error.message || 'خطا در ایجاد بک‌آپ');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    setLoading(true);
    try {
      const result = await saveBackupSettings(settings);
      if (result.success) {
        toast.success('تنظیمات با موفقیت ذخیره شد');
      } else {
        toast.error(result.error || 'خطا در ذخیره تنظیمات');
      }
    } catch (error: any) {
      toast.error(error.message || 'خطا در ذخیره تنظیمات');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = (url: string, filename: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <>
      <SettingsPanel
        title="بک‌آپ دستی"
        description="کل دیتابیس همین حالا به صورت فایل SQL روی سرور FTP ذخیره می‌شود و از فهرست پایین دانلود می‌شود."
        action={
          <Button onClick={handleCreateBackup} disabled={loading}>
            <Database className="h-4 w-4" />
            {loading ? 'در حال ایجاد بک‌آپ...' : 'ایجاد بک‌آپ جدید'}
          </Button>
        }
      >
        {lastBackup ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-secondary px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[12.5px] text-muted-foreground">آخرین بک‌آپ</p>
              <p className="truncate font-mono text-[12.5px]">
                <bdi>{lastBackup.filename}</bdi>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                <span className="font-mono">{formatJalaliDate(new Date(lastBackup.createdAt))}</span> ·{' '}
                <span className="font-mono">{lastBackup.sizeInMB} MB</span>
              </p>
            </div>
            {lastBackup.downloadUrl && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDownload(lastBackup.downloadUrl, lastBackup.filename)}
              >
                <Download className="h-4 w-4" />
                دانلود
              </Button>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">هنوز بک‌آپی ثبت نشده است. «ایجاد بک‌آپ جدید» را بزنید.</p>
        )}
      </SettingsPanel>

      <SettingsPanel
        title="بک‌آپ دوره‌ای"
        description="تنظیم بک‌آپ خودکار در زمان‌های مشخص"
      >
        <div className="flex items-center justify-between gap-4 py-2">
          <div className="space-y-0.5">
            <Label htmlFor="enabled" className="text-[13.5px] font-normal">فعال‌سازی بک‌آپ دوره‌ای</Label>
            <p className="text-xs text-muted-foreground">
              بک‌آپ به صورت خودکار در زمان مشخص ایجاد می‌شود
            </p>
          </div>
          <Switch
            id="enabled"
            checked={settings.enabled}
            onCheckedChange={(checked) =>
              setSettings((prev) => ({ ...prev, enabled: checked }))
            }
          />
        </div>

        {settings.enabled && (
          <div className="mt-1 border-t pt-1">
            <FieldRow label="فراوانی بک‌آپ" htmlFor="frequency">
              <Select
                value={settings.frequency}
                onValueChange={(value: 'daily' | 'weekly' | 'monthly') =>
                  setSettings((prev) => ({ ...prev, frequency: value }))
                }
              >
                <SelectTrigger id="frequency" className="sm:max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">روزانه</SelectItem>
                  <SelectItem value="weekly">هفتگی</SelectItem>
                  <SelectItem value="monthly">ماهانه</SelectItem>
                </SelectContent>
              </Select>
            </FieldRow>

            {settings.frequency === 'weekly' && (
              <FieldRow label="روز هفته" htmlFor="dayOfWeek">
                <Select
                  value={settings.dayOfWeek?.toString()}
                  onValueChange={(value) =>
                    setSettings((prev) => ({ ...prev, dayOfWeek: parseInt(value) }))
                  }
                >
                  <SelectTrigger id="dayOfWeek" className="sm:max-w-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">یکشنبه</SelectItem>
                    <SelectItem value="1">دوشنبه</SelectItem>
                    <SelectItem value="2">سه‌شنبه</SelectItem>
                    <SelectItem value="3">چهارشنبه</SelectItem>
                    <SelectItem value="4">پنج‌شنبه</SelectItem>
                    <SelectItem value="5">جمعه</SelectItem>
                    <SelectItem value="6">شنبه</SelectItem>
                  </SelectContent>
                </Select>
              </FieldRow>
            )}

            {settings.frequency === 'monthly' && (
              <FieldRow label="روز ماه شمسی (۱ تا ۲۹)" htmlFor="dayOfMonth">
                <Input
                  id="dayOfMonth"
                  type="number"
                  min="1"
                  max="29"
                  className="sm:max-w-[120px]"
                  value={settings.dayOfMonth}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      dayOfMonth: parseInt(e.target.value) || 1,
                    }))
                  }
                />
              </FieldRow>
            )}

            <FieldRow
              label="تعداد بک‌آپ‌های نگه‌داری شده"
              htmlFor="keepBackups"
              hint="بک‌آپ‌های قدیمی‌تر از این تعداد حذف می‌شوند"
            >
              <Input
                id="keepBackups"
                type="number"
                min="1"
                max="365"
                className="sm:max-w-[120px]"
                value={settings.keepBackups}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    keepBackups: parseInt(e.target.value) || 30,
                  }))
                }
              />
            </FieldRow>

            <StatusNote tone="neutral" className="mt-2 text-muted-foreground">
              هر روز حدود ساعت ۳:۳۰ بامداد (به وقت تهران) بررسی می‌شود و اگر روزِ بک‌آپ باشد،
              بک‌آپ کامل روی سرور FTP (پوشهٔ <span dir="ltr" className="font-mono">/backups</span>) ذخیره می‌شود.
            </StatusNote>
          </div>
        )}

        <PanelActions>
          <Button
            onClick={handleSaveSettings}
            disabled={loading || !settings.enabled}
          >
            {loading ? 'در حال ذخیره...' : 'ذخیره تنظیمات'}
          </Button>
        </PanelActions>
      </SettingsPanel>

      <SettingsPanel
        title="فهرست بک‌آپ‌ها"
        count={loadingBackups ? undefined : backups.length.toLocaleString('fa-IR')}
        description="بک‌آپ‌های موجود روی سرور FTP برای دانلود"
      >
        {loadingBackups ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">در حال خواندن فهرست از سرور FTP...</p>
        ) : backups.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            هیچ بک‌آپی روی سرور FTP نیست. با «ایجاد بک‌آپ جدید» اولین بک‌آپ را بسازید.
          </p>
        ) : (
          <div className="-mx-4 -mb-4 overflow-x-auto border-t">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="border-b">
                  <th className="h-9 bg-secondary px-4 text-start text-xs font-normal text-muted-foreground">فایل</th>
                  <th className="h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">تاریخ</th>
                  <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">حجم (MB)</th>
                  <th className="h-9 bg-secondary px-4 text-end text-xs font-normal text-muted-foreground" />
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => (
                  <tr key={backup.filename} className="h-11 border-b last:border-0 hover:bg-brand/[.04]">
                    <td className="max-w-[320px] truncate px-4 font-mono text-[12.5px]">
                      <bdi>{backup.filename}</bdi>
                    </td>
                    <td className="whitespace-nowrap px-3 font-mono text-[12px] text-muted-foreground">
                      {formatJalaliDate(new Date(backup.createdAt))}
                    </td>
                    <td className="px-3 text-end font-mono text-[12px] tabular-nums">{backup.sizeInMB}</td>
                    <td className="px-4 text-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDownload(backup.downloadUrl, backup.filename)}
                      >
                        <Download className="h-4 w-4" />
                        دانلود
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsPanel>
    </>
  );
}
