'use client';

import { useLogo } from '@/components/providers/logo-provider';

export function Logo() {
  const { logo } = useLogo();

  return (
    <div className="flex items-center pl-3 mb-14">
      {logo ? (
        <div className="flex items-center gap-3">
          <img
            src={logo}
            alt="Company Logo"
            className="object-contain w-full h-[60px] min-h-[80px]"
          />
        </div>
      ) : (
        <h1 className="text-2xl font-bold mr-4">TheMoak ERP</h1>
      )}
    </div>
  );
}

