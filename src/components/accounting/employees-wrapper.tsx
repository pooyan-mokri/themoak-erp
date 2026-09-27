'use client';

import { useState, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';
import { EmployeeForm } from './employee-form';
import { EmployeeList, type Employee } from './employee-list';
import { getEmployees } from '@/actions/employee';

interface EmployeesWrapperProps {
  initialEmployees: Employee[];
  /** May add, edit and delete employees (payroll.manage). */
  canManage?: boolean;
}

const fa = (n: number) => new Intl.NumberFormat('fa-IR').format(n);

export function EmployeesWrapper({ initialEmployees, canManage = false }: EmployeesWrapperProps) {
  const [employees, setEmployees] = useState(initialEmployees);
  const [adding, setAdding] = useState(false);

  const reload = useCallback(async () => {
    // Fetch updated employees list
    const updatedEmployees = await getEmployees();
    setEmployees(updatedEmployees);
  }, []);

  return (
    <div className="space-y-4">
      <PageHeader
        title="کارمندان"
        description={`${fa(employees.length)} نفر · حقوق، سابقه و اطلاعات تماس`}
        actions={
          canManage && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              افزودن کارمند
            </Button>
          )
        }
      />

      <EmployeeList employees={employees} canManage={canManage} onChanged={reload} />

      {canManage && (
        <Dialog open={adding} onOpenChange={setAdding}>
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>تعریف کارمند جدید</DialogTitle>
            </DialogHeader>
            <EmployeeForm
              onSuccess={async () => {
                setAdding(false);
                await reload();
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
