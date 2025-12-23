'use client';

import { createAsset } from '@/actions/fixed-assets';
import { useFormState } from 'react-dom';
import { SubmitButton } from '@/components/submit-button';

const initialState = {
  message: '',
  errors: {},
};

export default function NewAssetPage() {
  const [state, formAction] = useFormState(createAsset, initialState);

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">ثبت دارایی جدید</h1>

      <form action={formAction} className="bg-white p-6 rounded-lg shadow space-y-6">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
            نام دارایی
          </label>
          <input
            type="text"
            id="name"
            name="name"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="مثال: لپ‌تاپ مک‌بوک پرو"
          />
          {state?.errors?.name && (
            <p className="text-red-500 text-sm mt-1">{state.errors.name}</p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label htmlFor="purchaseDate" className="block text-sm font-medium text-gray-700 mb-1">
              تاریخ خرید
            </label>
            <input
              type="date"
              id="purchaseDate"
              name="purchaseDate"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {state?.errors?.purchaseDate && (
              <p className="text-red-500 text-sm mt-1">{state.errors.purchaseDate}</p>
            )}
          </div>

          <div>
            <label htmlFor="usefulLife" className="block text-sm font-medium text-gray-700 mb-1">
              عمر مفید (سال)
            </label>
            <input
              type="number"
              id="usefulLife"
              name="usefulLife"
              min="1"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {state?.errors?.usefulLife && (
              <p className="text-red-500 text-sm mt-1">{state.errors.usefulLife}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label htmlFor="purchasePrice" className="block text-sm font-medium text-gray-700 mb-1">
              قیمت خرید (تومان)
            </label>
            <input
              type="number"
              id="purchasePrice"
              name="purchasePrice"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {state?.errors?.purchasePrice && (
              <p className="text-red-500 text-sm mt-1">{state.errors.purchasePrice}</p>
            )}
          </div>

          <div>
            <label htmlFor="salvageValue" className="block text-sm font-medium text-gray-700 mb-1">
              ارزش اسقاط (تومان)
            </label>
            <input
              type="number"
              id="salvageValue"
              name="salvageValue"
              defaultValue="0"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="ارزش تخمینی در پایان عمر مفید"
            />
            {state?.errors?.salvageValue && (
              <p className="text-red-500 text-sm mt-1">{state.errors.salvageValue}</p>
            )}
          </div>
        </div>

        {state?.message && (
          <div className={`p-4 rounded-md ${state.message.includes('موفقیت') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {state.message}
          </div>
        )}

        <div className="flex justify-end">
          <SubmitButton text="ثبت دارایی" />
        </div>
      </form>
    </div>
  );
}
