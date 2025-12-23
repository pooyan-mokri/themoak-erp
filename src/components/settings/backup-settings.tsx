'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";
import { createBackup, getBackupSettings, saveBackupSettings, getLastBackup, listBackups } from "@/actions/backup";
import { toast } from "sonner";
import { Download, Database, Clock, Trash2, RefreshCw } from "lucide-react";
import { formatJalaliDate } from "@/lib/date-utils";
import { Badge } from "@/components/ui/badge";

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
  const [lastBackup, setLastBackup] = useState<any>(null);
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
    <div className="space-y-6">
      {/* Manual Backup */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            بک‌آپ دستی
          </CardTitle>
          <CardDescription>
            ایجاد بک‌آپ فوری از دیتابیس
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {lastBackup && (
            <div className="p-4 bg-muted rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">آخرین بک‌آپ</p>
                  <p className="text-sm text-muted-foreground">
                    {lastBackup.filename} - {lastBackup.sizeInMB} MB
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatJalaliDate(new Date(lastBackup.createdAt))}
                  </p>
                </div>
                {lastBackup.downloadUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDownload(lastBackup.downloadUrl, lastBackup.filename)}
                  >
                    <Download className="h-4 w-4 ml-2" />
                    دانلود
                  </Button>
                )}
              </div>
            </div>
          )}

          <Button
            onClick={handleCreateBackup}
            disabled={loading}
            className="w-full"
          >
            {loading ? (
              <>
                <RefreshCw className="h-4 w-4 ml-2 animate-spin" />
                در حال ایجاد بک‌آپ...
              </>
            ) : (
              <>
                <Database className="h-4 w-4 ml-2" />
                ایجاد بک‌آپ جدید
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Scheduled Backup Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            بک‌آپ دوره‌ای
          </CardTitle>
          <CardDescription>
            تنظیم بک‌آپ خودکار در زمان‌های مشخص
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="enabled">فعال‌سازی بک‌آپ دوره‌ای</Label>
              <p className="text-sm text-muted-foreground">
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
            <>
              <div className="space-y-2">
                <Label htmlFor="frequency">فراوانی بک‌آپ</Label>
                <Select
                  value={settings.frequency}
                  onValueChange={(value: 'daily' | 'weekly' | 'monthly') =>
                    setSettings((prev) => ({ ...prev, frequency: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">روزانه</SelectItem>
                    <SelectItem value="weekly">هفتگی</SelectItem>
                    <SelectItem value="monthly">ماهانه</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {settings.frequency === 'weekly' && (
                <div className="space-y-2">
                  <Label htmlFor="dayOfWeek">روز هفته</Label>
                  <Select
                    value={settings.dayOfWeek?.toString()}
                    onValueChange={(value) =>
                      setSettings((prev) => ({ ...prev, dayOfWeek: parseInt(value) }))
                    }
                  >
                    <SelectTrigger>
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
                </div>
              )}

              {settings.frequency === 'monthly' && (
                <div className="space-y-2">
                  <Label htmlFor="dayOfMonth">روز ماه (1-31)</Label>
                  <Input
                    id="dayOfMonth"
                    type="number"
                    min="1"
                    max="31"
                    value={settings.dayOfMonth}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        dayOfMonth: parseInt(e.target.value) || 1,
                      }))
                    }
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="time">ساعت بک‌آپ (HH:MM)</Label>
                <Input
                  id="time"
                  type="time"
                  value={settings.time}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, time: e.target.value }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="keepBackups">تعداد بک‌آپ‌های نگه‌داری شده</Label>
                <Input
                  id="keepBackups"
                  type="number"
                  min="1"
                  max="365"
                  value={settings.keepBackups}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      keepBackups: parseInt(e.target.value) || 30,
                    }))
                  }
                />
                <p className="text-sm text-muted-foreground">
                  بک‌آپ‌های قدیمی‌تر از این تعداد حذف می‌شوند
                </p>
              </div>
            </>
          )}

          <Button
            onClick={handleSaveSettings}
            disabled={loading || !settings.enabled}
            className="w-full"
          >
            {loading ? 'در حال ذخیره...' : 'ذخیره تنظیمات'}
          </Button>
        </CardContent>
      </Card>

      {/* Backup List */}
      <Card>
        <CardHeader>
          <CardTitle>لیست بک‌آپ‌ها</CardTitle>
          <CardDescription>
            بک‌آپ‌های موجود برای دانلود
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingBackups ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : backups.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              هیچ بک‌آپی وجود ندارد
            </p>
          ) : (
            <div className="space-y-2">
              {backups.map((backup) => (
                <div
                  key={backup.filename}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex-1">
                    <p className="font-medium">{backup.filename}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary">{backup.sizeInMB} MB</Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatJalaliDate(new Date(backup.createdAt))}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDownload(backup.downloadUrl, backup.filename)}
                  >
                    <Download className="h-4 w-4 ml-2" />
                    دانلود
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

