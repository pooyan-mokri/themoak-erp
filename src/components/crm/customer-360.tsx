import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Mail, Phone, MapPin, Calendar, Star, Edit } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

import { formatJalaliDate } from '@/lib/date-utils';
interface Customer360Props {
  customer: {
    id: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    customerType: string;
    segment?: string | null;
    loyaltyPoints: number;
    createdAt: Date;
  };
}

export function Customer360({ customer }: Customer360Props) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-bold">پروفایل مشتری</CardTitle>
        <Link href={`/dashboard/crm/customers/${customer.id}/edit`}>
          <Button variant="ghost" size="icon">
            <Edit className="h-4 w-4 text-muted-foreground" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center mb-6">
          <Avatar className="h-24 w-24 mb-4">
            <AvatarImage src={`https://api.dicebear.com/7.x/initials/svg?seed=${customer.name}`} />
            <AvatarFallback>{customer.name.substring(0, 2)}</AvatarFallback>
          </Avatar>
          <h3 className="text-xl font-bold">{customer.name}</h3>
          <div className="flex gap-2 mt-2">
            <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
              {customer.customerType === 'BUSINESS' ? 'شرکتی' : 'حقیقی'}
            </span>
            {customer.segment && (
              <span className="px-2 py-1 bg-purple-100 text-purple-800 text-xs rounded-full">
                {customer.segment}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center text-sm">
            <Phone className="h-4 w-4 ml-3 text-muted-foreground" />
            <span dir="ltr">{customer.phone || '---'}</span>
          </div>
          <div className="flex items-center text-sm">
            <Mail className="h-4 w-4 ml-3 text-muted-foreground" />
            <span>{customer.email || '---'}</span>
          </div>
          <div className="flex items-start text-sm">
            <MapPin className="h-4 w-4 ml-3 text-muted-foreground mt-1" />
            <span>{customer.address || '---'}</span>
          </div>
          <div className="flex items-center text-sm">
            <Calendar className="h-4 w-4 ml-3 text-muted-foreground" />
            <span>عضویت: {formatJalaliDate(customer.createdAt)}</span>
          </div>
          <div className="flex items-center text-sm">
            <Star className="h-4 w-4 ml-3 text-yellow-500" />
            <span>امتیاز وفاداری: {customer.loyaltyPoints}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
