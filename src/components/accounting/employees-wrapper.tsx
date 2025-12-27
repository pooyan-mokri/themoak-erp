'use client';

import { useState, useCallback } from 'react';
import { EmployeeForm } from './employee-form';
import { EmployeeList } from './employee-list';
import { getEmployees } from '@/actions/employee';

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

interface EmployeesWrapperProps {
  initialEmployees: Employee[];
}

export function EmployeesWrapper({ initialEmployees }: EmployeesWrapperProps) {
  const [employees, setEmployees] = useState(initialEmployees);

  const handleEmployeeCreated = useCallback(async () => {
    // Fetch updated employees list
    const updatedEmployees = await getEmployees();
    setEmployees(updatedEmployees);
  }, []);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <EmployeeForm onSuccess={handleEmployeeCreated} />
      <EmployeeList employees={employees} />
    </div>
  );
}

