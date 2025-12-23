import { getConsignmentCommissionsReport } from '@/actions/consignment-commissions';
import { ConsignmentCommissionsReport } from '@/components/consignment/commissions-report';

export default async function ConsignmentCommissionsPage() {
  const reportData = await getConsignmentCommissionsReport();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">گزارش کمیسیون همکاران امانی</h1>
        <p className="text-muted-foreground mt-2">
          گزارش طلب از همکاران امانی بر اساس کمیسیون فروش‌های ثبت شده
        </p>
      </div>

      <ConsignmentCommissionsReport reportData={reportData} />
    </div>
  );
}



