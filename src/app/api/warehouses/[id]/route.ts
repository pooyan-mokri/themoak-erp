import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { ACCESS_DENIED_MESSAGE, hasPermission } from '@/lib/access';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // The breadcrumb of the warehouse pages; /api is outside the sign-in middleware.
  if (!(await hasPermission('stock.view'))) {
    return NextResponse.json({ error: ACCESS_DENIED_MESSAGE }, { status: 403 });
  }
  try {
    const { id } = await params;
    const warehouse = await prisma.warehouse.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    
    if (!warehouse) {
      return NextResponse.json({ error: 'Warehouse not found' }, { status: 404 });
    }
    
    return NextResponse.json({ name: warehouse.name });
  } catch (error) {
    console.error('Error fetching warehouse:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

