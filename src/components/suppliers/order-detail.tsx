'use client';

import { useState, useEffect } from 'react';
import { closePurchaseOrderShort, receivePurchaseOrderItems } from '@/actions/supplier';
import { updatePurchaseOrderStatus, recordPurchasePartialPayment, recordArrival, payPurchaseOrderFromCredit } from '@/actions/supplier-workflow';
import { getLatestExchangeRates } from '@/actions/accounting';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { landedCostPerUnit as computeLandedCostPerUnit, isClosedShort, owedTotalInToman, shortShipmentCredit } from '@/lib/landed-cost';
import { canMovePurchaseOrder } from '@/lib/purchase-order-status';
import { Package, Check, ArrowLeft, CreditCard, Truck, Factory } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { formatJalaliDate } from '@/lib/date-utils';
import { accountLabel } from '@/lib/account-label';
import { useRequestId } from '@/components/ui/request-id';
import { Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { cn } from '@/lib/utils';
import { CURRENCY_LABELS, purchaseStatus } from './purchase-figures';

type Currency = 'TOMAN' | 'USD' | 'EUR' | 'CNY';

interface Product {
  id: string;
  name: string;
  sku: string;
}

interface Supplier {
  id: string;
  name: string;
}

interface PurchaseOrderItem {
  id: string;
  productId: string;
  quantity: number;
  unitCost: number; // absent without cost.view, and then never read
  currency: Currency;
  unitCostInToman?: number;
  exchangeRateSnapshot?: number;
  totalCostInToman?: number;
  additionalCost?: number;
  additionalCostInToman?: number;
  receivedQuantity: number;
  product: Product;
}

interface PurchaseOrderAdditionalCost {
  id: string;
  title: string;
  amount?: number;
  currency: Currency;
  amountInToman?: number;
  exchangeRateSnapshot?: number;
}

interface PurchaseOrderArrivalCost {
  id: string;
  title: string;
  amount?: number;
  currency: Currency;
  amountInToman?: number;
  exchangeRateSnapshot?: number;
}

interface PurchaseOrderPayment {
  id: string;
  amount: number;
  accountId?: string;
  accountName: string;
  /** Paid from the supplier's credit: no account moved. */
  fromCredit?: boolean;
  description?: string;
  date: Date | string;
}

interface PurchaseOrder {
  id: string;
  number: number;
  status: string;
  totalAmount?: number;
  totalAmountInToman?: number;
  createdAt: Date | string;
  supplier: Supplier;
  items: PurchaseOrderItem[];
  additionalCosts?: PurchaseOrderAdditionalCost[];
  arrivalAdditionalCosts?: PurchaseOrderArrivalCost[];
  payments?: PurchaseOrderPayment[];
  paidAmountInToman?: number;
  /** What the supplier owes us back («طلب از تأمین‌کننده»), for finance viewers. */
  supplierCreditBalance?: number;
}

interface ExchangeRate {
  currency: string;
  rateToToman: number;
  date: Date | string;
}

interface OrderDetailProps {
  order: PurchaseOrder;
  warehouses: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; name: string; currency: string; cardNumber?: string | null }>;
  /** Unit prices and landed cost (cost.view). */
  canSeeCost: boolean;
  /** Totals and payments (finance.view). */
  canSeeFinance: boolean;
  /** Send for payment, start production, cancel (stock.manage or finance.manage). */
  canChangeStatus: boolean;
  /** Record payments (finance.manage). */
  canPay: boolean;
  /** Record arrival with its costs (cost.edit and finance.manage). */
  canRecordArrival: boolean;
  /** Receive goods into a warehouse (stock.manage). */
  canReceive: boolean;
}

export function OrderDetail({
  order,
  warehouses,
  accounts,
  canSeeCost,
  canSeeFinance,
  canChangeStatus,
  canPay,
  canRecordArrival,
  canReceive,
}: OrderDetailProps) {
  const router = useRouter();
  const [showReceiveDialog, setShowReceiveDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [showArrivalDialog, setShowArrivalDialog] = useState(false);
  const [selectedWarehouse, setSelectedWarehouse] = useState('');
  const [selectedAccount, setSelectedAccount] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState<Date>(new Date());
  const [paymentDescription, setPaymentDescription] = useState('');
  const [arrivalAccount, setArrivalAccount] = useState('');
  const [arrivalCosts, setArrivalCosts] = useState<Array<{ title: string; amount: number; currency: Currency }>>([]);
  const [receivedItems, setReceivedItems] = useState<Record<string, { quantity: number }>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});
  // One id per submission of each money dialog, so a double click books once.
  const [paymentRequestId, renewPaymentRequestId] = useRequestId();
  const [arrivalRequestId, renewArrivalRequestId] = useRequestId();
  const [creditRequestId, renewCreditRequestId] = useRequestId();

  useEffect(() => {
    // Load exchange rates
    getLatestExchangeRates().then((rates: ExchangeRate[]) => {
      const ratesMap: Record<string, number> = { TOMAN: 1 };
      rates.forEach((rate) => {
        if (!ratesMap[rate.currency] || new Date(rate.date) > new Date(ratesMap[rate.currency] ? rates.find((r) => r.currency === rate.currency && ratesMap[rate.currency] === Number(r.rateToToman))?.date || rate.date : rate.date)) {
          ratesMap[rate.currency] = Number(rate.rateToToman);
        }
      });
      setExchangeRates(ratesMap);
    });

    // Initialize received items
    const initialReceivedItems: Record<string, { quantity: number }> = {};
    order.items.forEach((item) => {
      const remaining = item.quantity - (item.receivedQuantity || 0);
      if (remaining > 0) {
        initialReceivedItems[item.id] = {
          quantity: 0
        };
      }
    });
    setReceivedItems(initialReceivedItems);
  }, [order]);

  const getExchangeRate = (currency: Currency): number => {
    return exchangeRates[currency] || 1;
  };

  // Landed cost per unit — delegates to the same shared helper the server uses
  // when receiving goods, so what is displayed always equals what is stored.
  // An order closed short carries its additional costs on the units received (as its stored costs do).
  const calculateLandedCostPerUnit = (item: PurchaseOrderItem, order: PurchaseOrder): number =>
    computeLandedCostPerUnit(item, order, (currency: string) => getExchangeRate(currency as Currency), order.status === 'RECEIVED' ? 'received' : 'ordered');

  const updateReceivedItem = (itemId: string, field: string, value: number) => {
    setReceivedItems(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        [field]: value
      }
    }));
  };

  const handleReceive = async () => {
    if (!selectedWarehouse) {
      setError('لطفا انبار را انتخاب کنید');
      return;
    }

    const itemsToReceive = Object.entries(receivedItems)
      .filter(([_, data]) => data.quantity > 0)
      .map(([itemId, data]) => ({
        itemId,
        receivedQuantity: data.quantity,
      }));

    if (itemsToReceive.length === 0) {
      setError('لطفا حداقل یک آیتم را برای دریافت انتخاب کنید');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await receivePurchaseOrderItems(order.id, selectedWarehouse, itemsToReceive);
      if (result.success) {
        router.refresh();
        setShowReceiveDialog(false);
        setReceivedItems({});
        setSelectedWarehouse('');
      } else {
        setError(result.error || result.message || 'خطا در دریافت کالاها');
      }
    } catch (err) {
      setError('خطا در ارتباط با سرور');
    } finally {
      setLoading(false);
    }
  };

  const addArrivalCost = () => {
    setArrivalCosts([...arrivalCosts, { title: '', amount: 0, currency: 'TOMAN' }]);
  };

  const removeArrivalCost = (index: number) => {
    setArrivalCosts(arrivalCosts.filter((_, i) => i !== index));
  };

  const updateArrivalCost = (index: number, field: keyof { title: string; amount: number; currency: Currency }, value: string | number | Currency) => {
    const newCosts = [...arrivalCosts];
    newCosts[index] = { ...newCosts[index], [field]: value } as { title: string; amount: number; currency: Currency };
    setArrivalCosts(newCosts);
  };

  const handleCloseShort = async () => {
    const missing = order.items.reduce((sum, item) => sum + Math.max(0, item.quantity - (item.receivedQuantity || 0)), 0);
    // What was paid beyond the value of what came goes to the supplier's credit; named when the viewer sees
    // both the prices and the payments, and checked again by the server.
    const knowsCredit = canSeeCost && canSeeFinance;
    const credit = knowsCredit
      ? shortShipmentCredit(order, paidSoFar, (currency: string) => getExchangeRate(currency as Currency))
      : 0;
    const creditLine = !knowsCredit
      ? ' اگر بیش از ارزش کالای رسیده پرداخت شده باشد، مازاد به «طلب از تأمین‌کننده» منتقل می‌شود.'
      : credit > 0
        ? ` ${toman(credit)} پرداخت‌شده بابت کالای نرسیده به «طلب از تأمین‌کننده» ${order.supplier.name} منتقل می‌شود.`
        : '';
    const question = `${missing.toLocaleString('fa-IR')} عدد از این سفارش نرسیده است. دریافت با همین کسری بسته شود؟ هزینه‌های اضافی سفارش روی کالاهای دریافت‌شده سرشکن می‌شود.${creditLine}`;
    if (!window.confirm(question)) return;
    setStatusLoading(true);
    setError('');
    try {
      const result = await closePurchaseOrderShort(order.id, knowsCredit ? credit : undefined);
      if (result.success) {
        router.refresh();
      } else {
        setError(result.error || result.message || 'خطا در بستن سفارش با کسری');
      }
    } catch (err) {
      setError('خطا در ارتباط با سرور');
    } finally {
      setStatusLoading(false);
    }
  };

  const handleStatusChange = async (newStatus: string, expectedCredit?: number) => {
    setStatusLoading(true);
    setError('');
    try {
      const result = await updatePurchaseOrderStatus(order.id, newStatus, expectedCredit);
      if (result.success) {
        router.refresh();
      } else {
        setError(result.message || result.error || 'خطا در تغییر وضعیت');
      }
    } catch (err) {
      setError('خطا در ارتباط با سرور');
    } finally {
      setStatusLoading(false);
    }
  };

  // Payment figures (partial payments). An order closed short owes only for the units that came.
  const totalInToman = owedTotalInToman(order, (currency: string) => getExchangeRate(currency as Currency)) || 0;
  const totalLabel = isClosedShort(order) ? 'مبلغ کالای رسیده' : 'مبلغ کل';
  const paidSoFar = order.paidAmountInToman ?? (order.payments ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const remaining = Math.max(0, totalInToman - paidSoFar);
  const creditBalance = order.supplierCreditBalance ?? 0;
  const creditUsable = Math.min(creditBalance, remaining);
  const toman = (amount: number) => `${Math.round(amount).toLocaleString('fa-IR')} تومان`;

  // What was paid goes to the supplier's credit: the confirmation names the amount, and the server refuses if
  // the payments changed since. A viewer without the finance figures is told the rule instead.
  const handleCancel = () => {
    const question = !canSeeFinance
      ? 'این سفارش لغو شود؟ اگر پرداختی برای آن ثبت شده باشد، به «طلب از تأمین‌کننده» منتقل می‌شود.'
      : paidSoFar > 0
        ? `با لغو این سفارش، ${toman(paidSoFar)} پرداخت‌شده به «طلب از تأمین‌کننده» ${order.supplier.name} منتقل می‌شود. لغو شود؟`
        : 'این سفارش لغو شود؟';
    if (!window.confirm(question)) return;
    handleStatusChange('CANCELLED', canSeeFinance ? paidSoFar : undefined);
  };

  const handlePayFromCredit = async () => {
    if (!window.confirm(`${toman(creditUsable)} از طلب تأمین‌کننده «${order.supplier.name}» بابت این سفارش پرداخت شود؟`)) return;
    setStatusLoading(true);
    setError('');
    try {
      const result = await payPurchaseOrderFromCredit({ orderId: order.id, requestId: creditRequestId });
      if (result.success) {
        renewCreditRequestId();
        router.refresh();
      } else {
        setError(result.message || result.error || 'خطا در پرداخت از طلب تأمین‌کننده');
      }
    } catch (err) {
      setError('خطا در ارتباط با سرور');
    } finally {
      setStatusLoading(false);
    }
  };

  const openPaymentDialog = () => {
    setPaymentAmount(remaining > 0 ? String(Math.round(remaining)) : '');
    setPaymentDate(new Date());
    setPaymentDescription('');
    setSelectedAccount('');
    setError('');
    setShowPaymentDialog(true);
  };

  const handlePayment = async () => {
    if (!selectedAccount) {
      setError('لطفا حساب را انتخاب کنید');
      return;
    }
    const amountNum = Number(paymentAmount);
    if (!amountNum || amountNum <= 0) {
      setError('مبلغ پرداخت باید بیشتر از صفر باشد');
      return;
    }
    if (amountNum > remaining + 1) {
      setError(`مبلغ پرداخت نمی‌تواند از باقیمانده (${Math.round(remaining).toLocaleString('fa-IR')} تومان) بیشتر باشد`);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = await recordPurchasePartialPayment({
        orderId: order.id,
        accountId: selectedAccount,
        amount: amountNum,
        date: paymentDate.toISOString(),
        description: paymentDescription.trim() || undefined,
        requestId: paymentRequestId,
      });
      if (result.success) {
        renewPaymentRequestId();
        router.refresh();
        setShowPaymentDialog(false);
        setSelectedAccount('');
        setPaymentAmount('');
        setPaymentDescription('');
      } else {
        setError(result.message || 'خطا در ثبت پرداخت');
      }
    } catch (err) {
      setError('خطا در ارتباط با سرور');
    } finally {
      setLoading(false);
    }
  };

  const handleArrival = async () => {
    if (!arrivalAccount) {
      setError('لطفا حساب را انتخاب کنید');
      return;
    }

    const validCosts = arrivalCosts.filter(cost => cost.title && cost.amount > 0);
    if (validCosts.length === 0) {
      setError('لطفا حداقل یک هزینه اضافی وارد کنید');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = await recordArrival(order.id, validCosts, arrivalAccount, arrivalRequestId);
      if (result.success) {
        renewArrivalRequestId();
        router.refresh();
        setShowArrivalDialog(false);
        setArrivalCosts([]);
        setArrivalAccount('');
      } else {
        setError(result.message || result.error || 'خطا در ثبت رسیدن به مقصد');
      }
    } catch (err) {
      setError('خطا در ارتباط با سرور');
    } finally {
      setLoading(false);
    }
  };

  const StatusPill = ({ status }: { status: string }) => {
    const s = purchaseStatus(status);
    return <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px]', s.tone)}>{s.label}</span>;
  };

  const getWorkflowSteps = () => {
    const steps = [
      { key: 'DRAFT', label: 'ثبت سفارش' },
      { key: 'PENDING_PAYMENT', label: 'منتظر پرداخت' },
      { key: 'PAID', label: 'پرداخت شده' },
      { key: 'IN_PRODUCTION', label: 'در حال تولید' },
      { key: 'ARRIVED', label: 'رسیده به مقصد' },
      { key: 'RECEIVED', label: 'دریافت شده' },
    ];

    // A partially-paid order is still at «pending payment»; a partly received one has
    // arrived and waits on the rest (it used to match no step and showed none done).
    const effectiveStatus =
      order.status === 'PARTIALLY_PAID' ? 'PENDING_PAYMENT' : order.status === 'PARTIALLY_RECEIVED' ? 'ARRIVED' : order.status;
    const currentIndex = steps.findIndex(s => s.key === effectiveStatus);
    return steps.map((step, index) => ({
      ...step,
      completed: index <= currentIndex,
      current: index === currentIndex,
    }));
  };

  const getCurrencyLabel = (currency: string) => CURRENCY_LABELS[currency] || currency;
  const fa = (n: number) => Math.round(n).toLocaleString('fa-IR');
  const canReceiveNow = (order.status === 'ARRIVED' || order.status === 'PARTIALLY_RECEIVED') && canReceive;
  // Only the moves the server accepts (src/lib/purchase-order-status.ts): no cancel once goods came in.
  const canCancelNow = canMovePurchaseOrder(order.status, 'CANCELLED') && canChangeStatus;
  const dialogOpen = showReceiveDialog || showPaymentDialog || showArrivalDialog;
  const steps = getWorkflowSteps();

  return (
    <div className="space-y-4">
      <PageHeader
        title={`سفارش خرید PO-${order.number}`}
        description={`تامین‌کننده: ${order.supplier.name} · تاریخ: ${formatJalaliDate(order.createdAt)}`}
        actions={<StatusPill status={order.status} />}
      />

      {/* Workflow steps */}
      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-4 text-sm font-medium">مراحل سفارش</h3>
        {order.status === 'CANCELLED' ? (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">این سفارش لغو شده است.</p>
        ) : (
          <ol className="flex items-start overflow-x-auto pb-1">
            {steps.map((step, index) => (
              <li key={step.key} className="flex min-w-[96px] flex-1 items-start">
                <div className="flex flex-1 flex-col items-center gap-1.5">
                  <span
                    className={cn(
                      'grid h-8 w-8 place-items-center rounded-full border font-mono text-[12px] transition-colors duration-150',
                      step.completed ? 'border-brand bg-brand text-white' : 'bg-card text-muted-foreground',
                    )}
                  >
                    {step.completed && !step.current ? <Check className="h-4 w-4" /> : (index + 1).toLocaleString('fa-IR')}
                  </span>
                  <span className={cn('text-center text-[12px]', step.current ? 'font-medium text-brand' : 'text-muted-foreground')}>
                    {step.label}
                  </span>
                </div>
                {index < steps.length - 1 && (
                  <span className={cn('mt-4 h-px flex-1', step.completed && steps[index + 1].completed ? 'bg-brand' : 'bg-border')} />
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Actions */}
      {order.status !== 'RECEIVED' && order.status !== 'CANCELLED' && (canChangeStatus || canPay || canRecordArrival || canReceive) && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">عملیات</h3>
          {error && !dialogOpen && (
            <Alert variant="destructive" className="mb-3">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            {order.status === 'DRAFT' && canChangeStatus && (
              <Button onClick={() => handleStatusChange('PENDING_PAYMENT')} disabled={statusLoading}>
                <ArrowLeft className="h-4 w-4" />
                ارسال برای پرداخت
              </Button>
            )}
            {(order.status === 'PENDING_PAYMENT' || order.status === 'PARTIALLY_PAID') && canPay && (
              <Button onClick={openPaymentDialog}>
                <CreditCard className="h-4 w-4" />
                {order.status === 'PARTIALLY_PAID' ? 'ثبت پرداخت بعدی' : 'ثبت پرداخت'}
              </Button>
            )}
            {order.status === 'PAID' && canChangeStatus && (
              <Button onClick={() => handleStatusChange('IN_PRODUCTION')} disabled={statusLoading}>
                <Factory className="h-4 w-4" />
                شروع تولید
              </Button>
            )}
            {order.status === 'IN_PRODUCTION' && canRecordArrival && (
              <Button onClick={() => setShowArrivalDialog(true)}>
                <Truck className="h-4 w-4" />
                ثبت رسیدن به مقصد
              </Button>
            )}
            {canReceiveNow && (
              <Button onClick={() => setShowReceiveDialog(true)}>
                <Package className="h-4 w-4" />
                {order.status === 'PARTIALLY_RECEIVED' ? 'دریافت باقی کالا' : 'دریافت کالا'}
              </Button>
            )}
            {order.status === 'PARTIALLY_RECEIVED' && canReceive && (
              <Button onClick={handleCloseShort} variant="outline" disabled={statusLoading}>
                بستن دریافت با کسری
              </Button>
            )}
            {canCancelNow && (
              // The confirmation names what was paid, which goes to the supplier's credit.
              <Button onClick={handleCancel} variant="destructive" disabled={statusLoading}>
                لغو سفارش PO-{order.number}
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {canSeeFinance && (
          <div className="rounded-lg border bg-card px-4 py-3.5">
            <p className="text-xs text-muted-foreground">مبلغ کل</p>
            {order.totalAmountInToman && (
              <p className="mt-1.5 text-[19px] font-medium tabular-nums">
                {Number(order.totalAmountInToman).toLocaleString('fa-IR')}
                <small className="ms-1 text-[11px] font-normal text-muted-foreground">تومان</small>
              </p>
            )}
            {order.items && order.items.length > 0 && (
              <p className="mt-1 text-[12px] text-muted-foreground tabular-nums">
                {Number(order.totalAmount).toLocaleString('fa-IR')} {getCurrencyLabel(order.items[0]?.currency || 'TOMAN')}
              </p>
            )}
          </div>
        )}
        {(canSeeCost || canSeeFinance) && order.additionalCosts && order.additionalCosts.length > 0 && (
          <div className="rounded-lg border bg-card px-4 py-3.5">
            <p className="mb-2 text-xs text-muted-foreground">هزینه‌های اضافی</p>
            <div className="space-y-2">
              {order.additionalCosts.map((cost, index) => (
                <div key={index} className="flex items-start justify-between gap-2 text-[13px]">
                  <span>{cost.title}</span>
                  <div className="text-end">
                    <div className="font-medium tabular-nums">
                      {Number(cost.amount).toLocaleString('fa-IR')} {getCurrencyLabel(cost.currency)}
                    </div>
                    {cost.amountInToman && (
                      <div className="text-xs text-muted-foreground tabular-nums">{Number(cost.amountInToman).toLocaleString('fa-IR')} تومان</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="rounded-lg border bg-card px-4 py-3.5">
          <p className="mb-2 text-xs text-muted-foreground">وضعیت</p>
          <StatusPill status={order.status} />
        </div>
      </div>

      {/* Payments */}
      {canSeeFinance && (order.status !== 'DRAFT' && order.status !== 'CANCELLED') && totalInToman > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">پرداخت‌ها</h3>
            {remaining <= 0 ? (
              <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11.5px] text-success">تسویه کامل</span>
            ) : paidSoFar > 0 ? (
              <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11.5px] text-brand">پرداخت جزئی</span>
            ) : (
              <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11.5px] text-warning">پرداخت‌نشده</span>
            )}
          </div>
          <div className="mb-4 grid grid-cols-3 gap-2">
            {[
              { label: totalLabel, value: totalInToman },
              { label: 'پرداخت‌شده', value: paidSoFar },
              { label: 'باقیمانده', value: remaining },
            ].map((figure) => (
              <div key={figure.label} className="rounded-md bg-secondary px-3 py-2">
                <div className="text-xs text-muted-foreground">{figure.label}</div>
                <div className="mt-0.5 font-medium tabular-nums">
                  {fa(figure.value)}
                  <small className="ms-1 text-[11px] font-normal text-muted-foreground">تومان</small>
                </div>
              </div>
            ))}
          </div>

          {/* What the supplier owes us back («طلب از تأمین‌کننده») can pay this order without moving an account. */}
          {creditBalance > 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2.5 text-[13px]">
              <span>
                طلب از تأمین‌کننده «{order.supplier.name}»: <span className="font-medium tabular-nums">{toman(creditBalance)}</span>
              </span>
              {canPay && (order.status === 'PENDING_PAYMENT' || order.status === 'PARTIALLY_PAID') && creditUsable > 0 && (
                <Button size="sm" variant="outline" onClick={handlePayFromCredit} disabled={statusLoading}>
                  پرداخت {toman(creditUsable)} از طلب
                </Button>
              )}
            </div>
          )}

          {order.payments && order.payments.length > 0 ? (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>تاریخ</TableHead>
                    <TableHead>حساب</TableHead>
                    <TableHead className="text-end">مبلغ (تومان)</TableHead>
                    <TableHead>توضیحات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-[12px]">{formatJalaliDate(p.date)}</TableCell>
                      <TableCell>{p.accountName}</TableCell>
                      <TableCell className="text-end font-medium">{fa(Number(p.amount))}</TableCell>
                      <TableCell className="text-muted-foreground">{p.description || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="py-2 text-center text-[13px] text-muted-foreground">هنوز پرداختی ثبت نشده است.</p>
          )}
        </div>
      )}

      {/* Lines */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <h3 className="px-4 pb-3 pt-4 text-sm font-medium">اقلام سفارش</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>محصول</TableHead>
              <TableHead className="text-end">تعداد</TableHead>
              <TableHead className="text-end">دریافت شده</TableHead>
              <TableHead className="text-end">باقیمانده</TableHead>
              {canSeeCost && (
                <>
                  <TableHead className="text-end">قیمت واحد</TableHead>
                  <TableHead>ارز</TableHead>
                  <TableHead className="text-end">قیمت واحد (تومان)</TableHead>
                  <TableHead className="text-end">جمع (تومان)</TableHead>
                  <TableHead className="text-end">قیمت تمام شده هر واحد (تومان)</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.items.map((item) => {
              const receivedQty = item.receivedQuantity || 0;
              const remaining = item.quantity - receivedQty;
              // Ensure unitCostInToman is a number, not Decimal or string
              const unitCostInToman = Number(item.unitCostInToman) || (Number(item.unitCost) * getExchangeRate(item.currency));
              const totalInToman = Number(item.quantity) * unitCostInToman;

              // Calculate landed cost per unit
              const landedCostPerUnit = calculateLandedCostPerUnit(item, order);

              return (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">
                    {item.product.name}
                    {item.product.sku && <span className="ms-2 font-mono text-[11.5px] text-muted-foreground">{item.product.sku}</span>}
                  </TableCell>
                  <TableCell className="text-end">{item.quantity.toLocaleString('fa-IR')}</TableCell>
                  <TableCell className="text-end">{receivedQty.toLocaleString('fa-IR')}</TableCell>
                  <TableCell className="text-end">
                    {remaining > 0 ? (
                      <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11.5px] text-warning">{remaining.toLocaleString('fa-IR')}</span>
                    ) : (
                      <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11.5px] text-success">کامل</span>
                    )}
                  </TableCell>
                  {canSeeCost && (
                    <>
                      <TableCell className="text-end">{Number(item.unitCost).toLocaleString('fa-IR')}</TableCell>
                      <TableCell className="text-muted-foreground">{getCurrencyLabel(item.currency)}</TableCell>
                      <TableCell className="text-end">{unitCostInToman.toLocaleString('fa-IR')}</TableCell>
                      <TableCell className="text-end">{totalInToman.toLocaleString('fa-IR')}</TableCell>
                      <TableCell className="text-end font-medium">{landedCostPerUnit.toLocaleString('fa-IR')}</TableCell>
                    </>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={showReceiveDialog} onOpenChange={setShowReceiveDialog}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>دریافت کالا — PO-{order.number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label>انبار *</Label>
              <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse} required>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب انبار" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>اقلام دریافت شده</Label>
              <div className="divide-y rounded-lg border">
                {order.items
                  .filter((item) => {
                    const receivedQty = item.receivedQuantity || 0;
                    return item.quantity - receivedQty > 0;
                  })
                  .map((item) => {
                    const receivedQty = item.receivedQuantity || 0;
                    const remaining = item.quantity - receivedQty;
                    const receivedData = receivedItems[item.id] || { quantity: 0 };

                    return (
                      <div key={item.id} className="space-y-3 p-4">
                        <div>
                          <div className="font-medium">{item.product.name}</div>
                          <div className="text-[12.5px] text-muted-foreground">
                            سفارش: {item.quantity.toLocaleString('fa-IR')} · دریافت شده: {receivedQty.toLocaleString('fa-IR')} · باقیمانده:{' '}
                            {remaining.toLocaleString('fa-IR')}
                          </div>
                        </div>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>تعداد دریافت شده *</Label>
                            <Input
                              type="number"
                              min="1"
                              max={remaining}
                              value={receivedData.quantity}
                              onChange={(e) => updateReceivedItem(item.id, 'quantity', Number(e.target.value))}
                              placeholder="0"
                            />
                          </div>
                          {canSeeCost && (
                            <div className="space-y-1.5">
                              <Label className="text-muted-foreground">قیمت تمام شده (تخمینی)</Label>
                              <div className="pt-2 text-[13px] font-medium">
                                {receivedData.quantity > 0 ? (() => {
                                  const landedCostPerUnit = calculateLandedCostPerUnit(item, order);
                                  return (
                                    <>
                                      {landedCostPerUnit.toLocaleString('fa-IR')} تومان
                                      <span className="block text-xs text-muted-foreground">برای هر واحد</span>
                                    </>
                                  );
                                })() : (
                                  '—'
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReceiveDialog(false)}>
              انصراف
            </Button>
            <Button onClick={handleReceive} disabled={loading}>
              {loading ? 'در حال ثبت...' : 'تایید و دریافت'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Dialog */}
      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>ثبت پرداخت — PO-{order.number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Summary */}
            <div className="grid grid-cols-3 gap-2 rounded-md bg-secondary p-3 text-center text-[13px]">
              <div>
                <div className="text-xs text-muted-foreground">{totalLabel}</div>
                <div className="font-medium tabular-nums">{fa(totalInToman)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">پرداخت‌شده</div>
                <div className="font-medium tabular-nums">{fa(paidSoFar)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">باقیمانده</div>
                <div className="font-medium tabular-nums">{fa(remaining)}</div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>حساب پرداخت *</Label>
              <Select value={selectedAccount} onValueChange={setSelectedAccount} required>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب حساب" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {accountLabel(acc)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>مبلغ پرداخت (تومان) *</Label>
              <Input
                type="number"
                min="0"
                step="any"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder="مبلغ این پرداخت"
              />
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">باقیمانده: {fa(remaining)} تومان</span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={() => setPaymentAmount(String(Math.round(remaining)))}
                >
                  پرداخت کامل باقیمانده
                </Button>
              </div>
            </div>

            <JalaliDatePicker
              name="paymentDate"
              label="تاریخ پرداخت"
              defaultValue={paymentDate}
              onChange={(d) => d && setPaymentDate(d)}
            />

            <div className="space-y-1.5">
              <Label>توضیحات (اختیاری)</Label>
              <Textarea
                value={paymentDescription}
                onChange={(e) => setPaymentDescription(e.target.value)}
                rows={2}
                placeholder="مثلا: پیش‌پرداخت، قسط اول..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>
              انصراف
            </Button>
            <Button onClick={handlePayment} disabled={loading}>
              {loading ? 'در حال ثبت...' : 'ثبت پرداخت'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Arrival Dialog */}
      <Dialog open={showArrivalDialog} onOpenChange={setShowArrivalDialog}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>ثبت رسیدن به مقصد — PO-{order.number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-1.5">
              <Label>حساب پرداخت هزینه‌ها *</Label>
              <Select value={arrivalAccount} onValueChange={setArrivalAccount} required>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب حساب" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {accountLabel(acc)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>هزینه‌های اضافی</Label>
                <Button type="button" variant="outline" size="sm" onClick={addArrivalCost}>
                  <Plus className="h-4 w-4" />
                  افزودن هزینه
                </Button>
              </div>
              {arrivalCosts.length === 0 && (
                <p className="rounded-md bg-secondary px-3 py-2 text-[12.5px] text-muted-foreground">
                  هزینه‌ای مثل حمل داخلی یا ترخیص را اضافه کنید؛ روی قیمت تمام شدهٔ کالاها سرشکن می‌شود.
                </p>
              )}
              {arrivalCosts.map((cost, index) => (
                <div key={index} className="grid grid-cols-12 items-end gap-3 rounded-lg border p-3">
                  <div className="col-span-12 space-y-1.5 md:col-span-4">
                    <Label>عنوان</Label>
                    <Input
                      value={cost.title}
                      onChange={(e) => updateArrivalCost(index, 'title', e.target.value)}
                      placeholder="مثال: حمل و نقل داخلی"
                      required
                    />
                  </div>
                  <div className="col-span-6 space-y-1.5 md:col-span-3">
                    <Label>مبلغ</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={cost.amount}
                      onChange={(e) => updateArrivalCost(index, 'amount', Number(e.target.value))}
                      placeholder="0"
                      required
                    />
                  </div>
                  <div className="col-span-6 space-y-1.5 md:col-span-3">
                    <Label>ارز</Label>
                    <Select
                      value={cost.currency}
                      onValueChange={(val: Currency) => updateArrivalCost(index, 'currency', val)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="TOMAN">تومان</SelectItem>
                        <SelectItem value="USD">دلار</SelectItem>
                        <SelectItem value="EUR">یورو</SelectItem>
                        <SelectItem value="CNY">یوان</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-12 flex justify-end md:col-span-2">
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      title="حذف این هزینه"
                      onClick={() => removeArrivalCost(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowArrivalDialog(false)}>
              انصراف
            </Button>
            <Button onClick={handleArrival} disabled={loading}>
              {loading ? 'در حال ثبت...' : 'ثبت رسیدن به مقصد'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Arrival costs */}
      {(canSeeCost || canSeeFinance) && order.arrivalAdditionalCosts && order.arrivalAdditionalCosts.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">هزینه‌های رسیدن به مقصد</h3>
          <div className="space-y-2">
            {order.arrivalAdditionalCosts.map((cost, index) => (
              <div key={index} className="flex items-start justify-between gap-2 text-[13px]">
                <span>{cost.title}</span>
                <div className="text-end">
                  <div className="font-medium tabular-nums">
                    {Number(cost.amount).toLocaleString('fa-IR')} {getCurrencyLabel(cost.currency)}
                  </div>
                  {cost.amountInToman && (
                    <div className="text-xs text-muted-foreground tabular-nums">{Number(cost.amountInToman).toLocaleString('fa-IR')} تومان</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
