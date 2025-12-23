'use client';

import { usePathname } from 'next/navigation';
import { Breadcrumb, BreadcrumbItem } from '@/components/ui/breadcrumb';
import { getBreadcrumbs } from '@/lib/breadcrumbs';
import { useEffect, useState } from 'react';

interface DashboardBreadcrumbProps {
  customLabel?: string;
}

export function DashboardBreadcrumb({ customLabel }: DashboardBreadcrumbProps) {
  const pathname = usePathname();
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);
  const [productName, setProductName] = useState<string | null>(null);
  const [warehouseName, setWarehouseName] = useState<string | null>(null);

  useEffect(() => {
    // Check if we're on a product detail page (with or without /barcode)
    const isProductDetailPage = pathname.match(/\/products\/[^/]+$/);
    const isBarcodePage = pathname.includes('/products/') && pathname.endsWith('/barcode');
    
    // Check if we're on a warehouse detail page
    const isWarehouseDetailPage = pathname.match(/\/warehouses\/[^/]+$/);
    
    if ((isProductDetailPage || isBarcodePage) && !customLabel) {
      // Extract product ID from pathname
      const segments = pathname.split('/').filter(Boolean);
      const productIdIndex = segments.indexOf('products');
      const productId = productIdIndex !== -1 && segments[productIdIndex + 1] ? segments[productIdIndex + 1] : null;
      
      if (productId) {
        // Fetch product name from API
        fetch(`/api/products/${productId}`)
          .then(res => res.json())
          .then(data => {
            if (data.name) {
              setProductName(data.name);
            }
          })
          .catch(() => {
            // If API fails, productName will remain null
          });
      }
    } else {
      setProductName(null);
    }

    if (isWarehouseDetailPage && !customLabel) {
      // Extract warehouse ID from pathname
      const segments = pathname.split('/').filter(Boolean);
      const warehouseIdIndex = segments.indexOf('warehouses');
      const warehouseId = warehouseIdIndex !== -1 && segments[warehouseIdIndex + 1] ? segments[warehouseIdIndex + 1] : null;
      
      if (warehouseId) {
        // Fetch warehouse name from API
        fetch(`/api/warehouses/${warehouseId}`)
          .then(res => res.json())
          .then(data => {
            if (data.name) {
              setWarehouseName(data.name);
            }
          })
          .catch(() => {
            // If API fails, warehouseName will remain null
          });
      }
    } else {
      setWarehouseName(null);
    }
  }, [pathname, customLabel]);

  useEffect(() => {
    let crumbs = getBreadcrumbs(pathname);
    
    // If custom label is provided, handle it specially
    // For paths like /dashboard/inventory/products/[id]/barcode, we need to split the custom label
    if (customLabel) {
      // Check if customLabel contains " > " separator (e.g., "Product Name > بارکد")
      if (customLabel.includes(' > ')) {
        const [productName, lastSegment] = customLabel.split(' > ');
        // Get parent breadcrumbs (up to products)
        const segments = pathname.split('/').filter(Boolean);
        const parentPath = '/' + segments.slice(0, -2).join('/'); // Remove [id] and barcode
        const parentCrumbs = getBreadcrumbs(parentPath);
        // Add product name and barcode as separate breadcrumbs
        crumbs = [
          ...parentCrumbs,
          { label: productName, href: `/dashboard/inventory/products/${segments[segments.length - 2]}` },
          { label: lastSegment }
        ];
      } else {
        // Simple custom label (no separator)
        if (crumbs.length > 0) {
          crumbs = [...crumbs, { label: customLabel }];
        } else {
          const segments = pathname.split('/').filter(Boolean);
          const parentPath = '/' + segments.slice(0, -1).join('/');
          const parentCrumbs = getBreadcrumbs(parentPath);
          crumbs = [...parentCrumbs, { label: customLabel }];
        }
      }
    } else if (productName && pathname.includes('/products/')) {
      // Handle product detail page or barcode page with fetched productName
      const segments = pathname.split('/').filter(Boolean);
      const productIdIndex = segments.indexOf('products');
      const productId = productIdIndex !== -1 && segments[productIdIndex + 1] ? segments[productIdIndex + 1] : null;
      
      if (productId) {
        // Get parent breadcrumbs (up to products)
        const parentPath = '/dashboard/inventory/products';
        const parentCrumbs = getBreadcrumbs(parentPath);
        
        // Make sure the last breadcrumb (products) has href
        const adjustedParentCrumbs = parentCrumbs.map((crumb, index) => {
          if (index === parentCrumbs.length - 1 && !crumb.href) {
            return { ...crumb, href: parentPath };
          }
          return crumb;
        });
        
        if (pathname.endsWith('/barcode')) {
          // For barcode page, add product name and barcode
          crumbs = [
            ...adjustedParentCrumbs,
            { label: productName, href: `/dashboard/inventory/products/${productId}` },
            { label: 'بارکد' }
          ];
        } else {
          // For product detail page, just add product name
          crumbs = [
            ...adjustedParentCrumbs,
            { label: productName }
          ];
        }
      }
    } else if (warehouseName && pathname.includes('/warehouses/')) {
      // Handle warehouse detail page with fetched warehouseName
      const segments = pathname.split('/').filter(Boolean);
      const warehouseIdIndex = segments.indexOf('warehouses');
      const warehouseId = warehouseIdIndex !== -1 && segments[warehouseIdIndex + 1] ? segments[warehouseIdIndex + 1] : null;
      
      if (warehouseId) {
        // Get parent breadcrumbs (up to warehouses)
        const parentPath = '/dashboard/inventory/warehouses';
        const parentCrumbs = getBreadcrumbs(parentPath);
        
        // Make sure the last breadcrumb (warehouses) has href
        const adjustedParentCrumbs = parentCrumbs.map((crumb, index) => {
          if (index === parentCrumbs.length - 1 && !crumb.href) {
            return { ...crumb, href: parentPath };
          }
          return crumb;
        });
        
        // For warehouse detail page, add warehouse name (without href as it's the current page)
        crumbs = [
          ...adjustedParentCrumbs,
          { label: warehouseName }
        ];
      }
    }
    
    setBreadcrumbs(crumbs);
  }, [pathname, customLabel, productName, warehouseName]);

  // Don't show breadcrumb on dashboard home
  if (pathname === '/dashboard') {
    return null;
  }

  if (breadcrumbs.length === 0) {
    return null;
  }

  // Don't show breadcrumb when there's only one item (redundant with page heading)
  if (breadcrumbs.length === 1) {
    return null;
  }

  return (
    <div className="mb-4">
      <Breadcrumb items={breadcrumbs} />
    </div>
  );
}

