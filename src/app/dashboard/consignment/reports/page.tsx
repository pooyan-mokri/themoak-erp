import { getConsignmentReport } from '@/actions/consignment-reports';
import { ConsignmentReport } from '@/components/consignment/consignment-report';

export default async function ConsignmentReportsPage() {
  const reportData = await getConsignmentReport();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">گزارش مدیریت امانی</h1>
        <p className="text-muted-foreground mt-2">
          گزارش جامع همکاران امانی، فروش‌ها، موجودی و طلب‌ها
        </p>
      </div>

      <ConsignmentReport reportData={reportData} />
    </div>
  );
}




