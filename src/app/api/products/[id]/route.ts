import { getProductDetail } from '@/actions/product-detail';
import { NextResponse } from 'next/server';
import { getCurrentRole, hasPermission } from '@/lib/access';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await getCurrentRole())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Without stock.view the product does not exist for this user.
    if (!(await hasPermission('stock.view'))) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const { id } = await params;
    const product = await getProductDetail(id);

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    return NextResponse.json({ name: product.name });
  } catch (error) {
    console.error('Error fetching product:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
