'use client';

import { useState, useEffect } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { EmployeeForm } from './employee-form';
import { deleteEmployee } from '@/actions/employee';
import { toast } from 'sonner';
import { Pencil, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { formatJalaliDate } from '@/lib/date-utils';

interface Employee {
  id: string;
  name: string;
  nationalId?: string;
  phone?: string;
  email?: string;
  position?: string;
  salary: number;
  hireDate?: Date;
}

interface EmployeeListProps {
  employees: Employee[];
}

export function EmployeeList({ employees: initialEmployees }: EmployeeListProps) {
  const [employees, setEmployees] = useState(initialEmployees);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | undefined>(undefined);

  // Update employees when initialEmployees prop changes
  useEffect(() => {
    setEmployees(initialEmployees);
  }, [initialEmployees]);

  const handleEdit = (employee: Employee) => {
    setSelectedEmployee(employee);
    setEditDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    const result = await deleteEmployee(id);
    if (result.success) {
      toast.success(result.message);
      setEmployees(employees.filter((e) => e.id !== id));
    } else {
      toast.error(result.message);
    }
  };

  const handleSuccess = () => {
    setEditDialogOpen(false);
    setSelectedEmployee(undefined);
    window.location.reload();
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fa-IR').format(Math.round(amount)) + ' تومان';
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>لیست کارمندان</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>نام</TableHead>
                  <TableHead>کد ملی</TableHead>
                  <TableHead>شماره تماس</TableHead>
                  <TableHead>سمت</TableHead>
                  <TableHead>حقوق ماهانه</TableHead>
                  <TableHead>تاریخ استخدام</TableHead>
                  <TableHead className="text-left">عملیات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      هیچ کارمندی ثبت نشده است
                    </TableCell>
                  </TableRow>
                ) : (
                  employees.map((employee) => (
                    <TableRow key={employee.id}>
                      <TableCell className="font-medium">{employee.name}</TableCell>
                      <TableCell>{employee.nationalId || '-'}</TableCell>
                      <TableCell>{employee.phone || '-'}</TableCell>
                      <TableCell>{employee.position || '-'}</TableCell>
                      <TableCell>{formatCurrency(employee.salary)}</TableCell>
                      <TableCell>
                        {employee.hireDate ? formatJalaliDate(employee.hireDate) : '-'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(employee)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>حذف کارمند</AlertDialogTitle>
                                <AlertDialogDescription>
                                  آیا از حذف {employee.name} اطمینان دارید؟ این عمل قابل بازگشت نیست.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>لغو</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDelete(employee.id)}
                                  className="bg-red-500 hover:bg-red-600"
                                >
                                  حذف
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {selectedEmployee && (
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>ویرایش کارمند</DialogTitle>
            </DialogHeader>
            <EmployeeForm initialData={selectedEmployee} onSuccess={handleSuccess} />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

