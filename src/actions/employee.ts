'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { ActionState, ActionResult } from '@/lib/types';

// --- Schemas ---

const EmployeeSchema = z.object({
  name: z.string().min(1, 'نام کارمند الزامی است'),
  nationalId: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('ایمیل نامعتبر است').optional().or(z.literal('')),
  address: z.string().optional(),
  position: z.string().optional(),
  hireDate: z.string().optional(),
  salary: z.coerce.number().min(0, 'حقوق باید بیشتر از صفر باشد'),
});

// --- Actions ---

export async function createEmployee(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = EmployeeSchema.safeParse({
    name: formData.get('name'),
    nationalId: formData.get('nationalId') || undefined,
    phone: formData.get('phone') || undefined,
    email: formData.get('email') || undefined,
    address: formData.get('address') || undefined,
    position: formData.get('position') || undefined,
    hireDate: formData.get('hireDate') || undefined,
    salary: formData.get('salary'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
      success: false,
    };
  }

  const { name, nationalId, phone, email, address, position, hireDate, salary } = validatedFields.data;

  try {
    // Check if nationalId is unique
    if (nationalId) {
      const existingEmployee = await prisma.employee.findUnique({
        where: { nationalId },
      });

      if (existingEmployee) {
        return {
          errors: { nationalId: ['این کد ملی قبلاً ثبت شده است.'] },
          message: 'این کد ملی قبلاً ثبت شده است.',
          success: false,
        };
      }
    }

    // Check if email is unique
    if (email) {
      const existingEmployee = await prisma.employee.findFirst({
        where: { email },
      });

      if (existingEmployee) {
        return {
          errors: { email: ['این ایمیل قبلاً ثبت شده است.'] },
          message: 'این ایمیل قبلاً ثبت شده است.',
          success: false,
        };
      }
    }

    await prisma.employee.create({
      data: {
        name,
        nationalId: nationalId || null,
        phone: phone || null,
        email: email || null,
        address: address || null,
        position: position || null,
        hireDate: hireDate ? new Date(hireDate) : null,
        salary: new Prisma.Decimal(salary),
      },
    });

    revalidatePath('/dashboard/accounting/employees');
    return { message: 'کارمند با موفقیت ثبت شد.', success: true };
  } catch (error: unknown) {
    console.error('Error creating employee:', error);
    return {
      message: error instanceof Error ? error.message : 'خطا در ثبت کارمند.',
      success: false,
    };
  }
}

export async function updateEmployee(id: string, prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = EmployeeSchema.safeParse({
    name: formData.get('name'),
    nationalId: formData.get('nationalId') || undefined,
    phone: formData.get('phone') || undefined,
    email: formData.get('email') || undefined,
    address: formData.get('address') || undefined,
    position: formData.get('position') || undefined,
    hireDate: formData.get('hireDate') || undefined,
    salary: formData.get('salary'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
      success: false,
    };
  }

  const { name, nationalId, phone, email, address, position, hireDate, salary } = validatedFields.data;

  try {
    // Check if nationalId is unique (excluding current employee)
    if (nationalId) {
      const existingEmployee = await prisma.employee.findUnique({
        where: { nationalId },
      });

      if (existingEmployee && existingEmployee.id !== id) {
        return {
          errors: { nationalId: ['این کد ملی قبلاً ثبت شده است.'] },
          message: 'این کد ملی قبلاً ثبت شده است.',
          success: false,
        };
      }
    }

    // Check if email is unique (excluding current employee)
    if (email) {
      const existingEmployee = await prisma.employee.findFirst({
        where: { 
          email,
          NOT: { id },
        },
      });

      if (existingEmployee) {
        return {
          errors: { email: ['این ایمیل قبلاً ثبت شده است.'] },
          message: 'این ایمیل قبلاً ثبت شده است.',
          success: false,
        };
      }
    }

    await prisma.employee.update({
      where: { id },
      data: {
        name,
        nationalId: nationalId || null,
        phone: phone || null,
        email: email || null,
        address: address || null,
        position: position || null,
        hireDate: hireDate ? new Date(hireDate) : null,
        salary: new Prisma.Decimal(salary),
      },
    });

    revalidatePath('/dashboard/accounting/employees');
    return { message: 'کارمند با موفقیت به‌روزرسانی شد.', success: true };
  } catch (error: unknown) {
    console.error('Error updating employee:', error);
    return {
      message: error instanceof Error ? error.message : 'خطا در به‌روزرسانی کارمند.',
      success: false,
    };
  }
}

export async function deleteEmployee(id: string) {
  try {
    // Check if employee has loans
    const loans = await prisma.loan.findMany({
      where: { employeeId: id },
    });

    if (loans.length > 0) {
      return {
        success: false,
        message: 'این کارمند قرض دارد و نمی‌تواند حذف شود.',
      };
    }

    await prisma.employee.delete({
      where: { id },
    });

    revalidatePath('/dashboard/accounting/employees');
    return { success: true, message: 'کارمند با موفقیت حذف شد.' };
  } catch (error: unknown) {
    console.error('Error deleting employee:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'خطا در حذف کارمند.',
    };
  }
}

export async function getEmployees() {
  try {
    const employees = await prisma.employee.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return employees.map((e) => ({
      ...e,
      salary: Number(e.salary),
      userId: e.userId ?? undefined,
      nationalId: e.nationalId ?? undefined,
      phone: e.phone ?? undefined,
      email: e.email ?? undefined,
      address: e.address ?? undefined,
      position: e.position ?? undefined,
      hireDate: e.hireDate ?? undefined,
    }));
  } catch (error) {
    console.error('Error fetching employees:', error);
    return [];
  }
}

export async function getEmployeeById(id: string) {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id },
    });

    if (!employee) return null;

    return {
      ...employee,
      salary: Number(employee.salary),
      userId: employee.userId ?? undefined,
      nationalId: employee.nationalId ?? undefined,
      phone: employee.phone ?? undefined,
      email: employee.email ?? undefined,
      address: employee.address ?? undefined,
      position: employee.position ?? undefined,
      hireDate: employee.hireDate ?? undefined,
    };
  } catch (error) {
    console.error('Error fetching employee:', error);
    return null;
  }
}

