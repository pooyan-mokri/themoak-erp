import { getAssets } from '@/actions/fixed-assets';
import Link from 'next/link';
import { FixedAsset } from '@/lib/types';
import { PostDepreciationButton } from '@/components/accounting/post-depreciation-button';

import { formatJalaliDate } from '@/lib/date-utils';
type AssetWithCurrentValue = Omit<FixedAsset, 'currentValue' | 'purchasePrice' | 'salvageValue' | 'quantity'> & {
  currentValue: number;
  purchasePrice: number;
  salvageValue: number;
  quantity?: number;
};

export default async function AssetsPage() {
  const assets = await getAssets();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">دارایی‌های ثابت</h1>
        <Link
          href="/dashboard/accounting/assets/new"
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
        >
          ثبت دارایی جدید
        </Link>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                نام دارایی
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                تاریخ خرید
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                قیمت خرید
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                ارزش فعلی (تخمین)
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                عمر مفید (سال)
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                عملیات
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {assets.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                  هیچ دارایی ثبت نشده است.
                </td>
              </tr>
            ) : (
              assets.map((asset: AssetWithCurrentValue) => (
                <tr key={asset.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {asset.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatJalaliDate(asset.purchaseDate)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {Number(asset.purchasePrice).toLocaleString()} تومان
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-bold">
                    {Math.round(asset.currentValue).toLocaleString()} تومان
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {asset.usefulLife}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <PostDepreciationButton assetId={asset.id} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
