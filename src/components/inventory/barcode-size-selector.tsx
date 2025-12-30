'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

interface BarcodeSizeSelectorProps {
  onSizeChange: (width: number, height: number) => void;
  currentWidth: number;
  currentHeight: number;
}

const PRESET_SIZES = [
  { label: '۵۰×۳۰ میلی‌متر (کوچک)', width: 50, height: 30 },
  { label: '۷۰×۴۰ میلی‌متر (متوسط)', width: 70, height: 40 },
  { label: '۱۰۰×۵۰ میلی‌متر (بزرگ)', width: 100, height: 50 },
  { label: '۱۰۰×۷۰ میلی‌متر (خیلی بزرگ)', width: 100, height: 70 },
];

export function BarcodeSizeSelector({ onSizeChange, currentWidth, currentHeight }: BarcodeSizeSelectorProps) {
  const [customWidth, setCustomWidth] = useState(currentWidth.toString());
  const [customHeight, setCustomHeight] = useState(currentHeight.toString());
  const [isCustom, setIsCustom] = useState(false);

  const handlePresetClick = (width: number, height: number) => {
    setIsCustom(false);
    setCustomWidth(width.toString());
    setCustomHeight(height.toString());
    onSizeChange(width, height);
  };

  const handleCustomApply = () => {
    const width = parseInt(customWidth);
    const height = parseInt(customHeight);

    if (width >= 30 && width <= 200 && height >= 20 && height <= 150) {
      onSizeChange(width, height);
    } else {
      alert('عرض باید بین ۳۰ تا ۲۰۰ میلی‌متر و ارتفاع باید بین ۲۰ تا ۱۵۰ میلی‌متر باشد.');
    }
  };

  return (
    <div className="space-y-4 p-4 bg-gray-50 rounded-lg border">
      <h3 className="font-semibold text-sm text-gray-700">انتخاب سایز برچسب</h3>

      {/* Preset Sizes */}
      <div className="grid grid-cols-2 gap-2">
        {PRESET_SIZES.map((size) => (
          <Button
            key={`${size.width}x${size.height}`}
            variant={
              !isCustom &&
              currentWidth === size.width &&
              currentHeight === size.height
                ? 'default'
                : 'outline'
            }
            size="sm"
            onClick={() => handlePresetClick(size.width, size.height)}
            className="text-xs"
          >
            {size.label}
          </Button>
        ))}
      </div>

      {/* Custom Size */}
      <div className="space-y-2">
        <Button
          variant={isCustom ? 'default' : 'outline'}
          size="sm"
          onClick={() => setIsCustom(true)}
          className="w-full text-xs"
        >
          سایز سفارشی
        </Button>

        {isCustom && (
          <div className="space-y-2 pt-2 border-t">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="width" className="text-xs">عرض (mm)</Label>
                <Input
                  id="width"
                  type="number"
                  min="30"
                  max="200"
                  value={customWidth}
                  onChange={(e) => setCustomWidth(e.target.value)}
                  className="text-xs h-8"
                />
              </div>
              <div>
                <Label htmlFor="height" className="text-xs">ارتفاع (mm)</Label>
                <Input
                  id="height"
                  type="number"
                  min="20"
                  max="150"
                  value={customHeight}
                  onChange={(e) => setCustomHeight(e.target.value)}
                  className="text-xs h-8"
                />
              </div>
            </div>
            <Button
              onClick={handleCustomApply}
              size="sm"
              className="w-full text-xs"
            >
              اعمال سایز سفارشی
            </Button>
          </div>
        )}
      </div>

      {/* Current Size Display */}
      <div className="text-xs text-gray-600 text-center pt-2 border-t">
        سایز فعلی: {currentWidth} × {currentHeight} میلی‌متر
      </div>
    </div>
  );
}
