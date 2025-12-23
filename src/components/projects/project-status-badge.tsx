import { Badge } from '@/components/ui/badge';

interface ProjectStatusBadgeProps {
  status: string;
}

export function ProjectStatusBadge({ status }: ProjectStatusBadgeProps) {
  switch (status) {
    case 'ACTIVE':
      return <Badge className="bg-blue-500 hover:bg-blue-600">فعال</Badge>;
    case 'COMPLETED':
      return <Badge className="bg-green-500 hover:bg-green-600">تکمیل شده</Badge>;
    case 'ON_HOLD':
      return <Badge className="bg-yellow-500 hover:bg-yellow-600 text-black">متوقف شده</Badge>;
    case 'CANCELLED':
      return <Badge variant="destructive">لغو شده</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}
