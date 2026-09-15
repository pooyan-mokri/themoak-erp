import { getProductDetail } from '@/actions/product-detail';
import { notFound } from 'next/navigation';
import { BarcodePrintWrapper } from '@/components/inventory/barcode-print-wrapper';
import { barcodeFormatFor } from '@/lib/barcode-format';

export default async function ProductBarcodePrintPage({
  params,
}: {
  params: { id: string };
}) {
  const product = await getProductDetail(params.id);

  if (!product || !product.barcode) {
    notFound();
  }

  // TypeScript doesn't recognize that notFound() never returns, so we assert here
  const productData = product;

  // Print exactly the stored code: the count scanner looks up Product.barcode as it is.
  const barcode = productData.barcode!;

  return (
    <BarcodePrintWrapper
      productName={productData.name}
      sku={productData.sku}
      barcode={barcode}
      format={barcodeFormatFor(barcode)}
    />
  );
}
