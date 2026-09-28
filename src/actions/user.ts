'use server';

import { PrismaClient } from '@prisma/client';
import { Role } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { logActivity } from '@/lib/activity-log';
import { hashPassword, verifyPassword, getCurrentUser } from '@/lib/auth-utils';
import { ROLE_LABELS } from '@/lib/permissions';
import { emailTakenByOther } from '@/lib/user-email';

import { prisma } from '@/lib/prisma';

// const prisma = new PrismaClient();

const UserSchema = z.object({
  name: z.string().min(1, 'نام الزامی است'),
  // Stored lower-case: sign-in matches any letter case (src/lib/user-email.ts).
  email: z.string().trim().toLowerCase().email('ایمیل نامعتبر است'),
  password: z.string().min(6, 'رمز عبور باید حداقل ۶ کاراکتر باشد').optional(),
  role: z.nativeEnum(Role),
  phone: z.string().optional(),
});

/**
 * User management is admin-only. These actions are imported by client
 * components, so they are reachable from the browser, and without this check
 * anyone could create an ADMIN account or promote themselves.
 */
async function isAdmin() {
  const currentUser = await getCurrentUser();
  return currentUser?.role === 'ADMIN';
}

const ADMIN_ONLY = 'فقط مدیر سیستم می‌تواند کاربران را مدیریت کند.';
const LAST_ADMIN = 'دست‌کم یک مدیر سیستم باید بماند؛ اول کاربر دیگری را مدیر سیستم کنید.';

/** Taking ADMIN from the only admin would leave nobody able to manage users. */
async function removesLastAdmin(userId: string, newRole: string) {
  if (newRole === 'ADMIN') return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role !== 'ADMIN') return false;
  return (await prisma.user.count({ where: { role: 'ADMIN', NOT: { id: userId } } })) === 0;
}

/** The users page: staff emails and phones, for an admin only. */
export async function getUsers() {
  if (!(await isAdmin())) return [];
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
        // Exclude password
      }
    });

    return users.map((user: any) => ({
      ...user,
      phone: user.phone ?? undefined,
    }));
  } catch (error) {
    return [];
  }
}

/**
 * Who can be picked (a task's assignee, an audit team member): id and name
 * only, for any signed-in user. Emails and phones stay on the users page.
 */
export async function getUserOptions(): Promise<Array<{ id: string; name: string }>> {
  if (!(await getCurrentUser())) return [];
  return prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
}

export async function createUser(prevState: any, formData: FormData) {
  if (!(await isAdmin())) return { message: ADMIN_ONLY };
  const validatedFields = UserSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    role: formData.get('role'),
    phone: formData.get('phone'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { name, email, password, role, phone } = validatedFields.data;

  if (!password) {
    return { message: 'رمز عبور برای کاربر جدید الزامی است.' };
  }

  try {
    const existingUser = await emailTakenByOther(email);

    if (existingUser) {
      return { message: 'این ایمیل قبلا ثبت شده است.' };
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role,
        phone,
      },
    });

    const currentUser = await getCurrentUser();
    await logActivity(currentUser?.id, 'CREATE_USER', `کاربر ${name} با نقش ${ROLE_LABELS[role]} ایجاد شد.`);

  } catch (error) {
    return { message: 'خطا در ایجاد کاربر.' };
  }

  revalidatePath('/dashboard/settings/users');
  return { message: 'کاربر با موفقیت ایجاد شد.', success: true };
}

export async function updateUser(id: string, prevState: any, formData: FormData) {
  if (!(await isAdmin())) return { message: ADMIN_ONLY };
  const schema = UserSchema.omit({ password: true }); // Password updated separately
  const validatedFields = schema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    role: formData.get('role'),
    phone: formData.get('phone'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { name, email, role, phone } = validatedFields.data;

  try {
    // Check if email is taken by another user
    const existingUser = await emailTakenByOther(email, id);

    if (existingUser) {
      return { message: 'این ایمیل توسط کاربر دیگری استفاده شده است.' };
    }
    if (await removesLastAdmin(id, role)) return { message: LAST_ADMIN };

    const user = await prisma.user.update({
      where: { id },
      data: {
        name,
        email,
        role,
        phone,
      },
    });

    const currentUser = await getCurrentUser();
    await logActivity(currentUser?.id, 'UPDATE_USER', `اطلاعات کاربر ${name} بروزرسانی شد.`);
    
    revalidatePath('/dashboard/settings/users');
    return { message: 'کاربر با موفقیت ویرایش شد.', success: true };
  } catch (error) {
    return { message: 'خطا در ویرایش کاربر.' };
  }
}

export async function updateUserRole(userId: string, newRole: Role) {
  if (!(await isAdmin())) return { success: false, message: ADMIN_ONLY };
  try {
    if (await removesLastAdmin(userId, newRole)) return { success: false, message: LAST_ADMIN };
    const user = await prisma.user.update({
      where: { id: userId },
      data: { role: newRole },
    });

    const currentUser = await getCurrentUser();
    await logActivity(currentUser?.id, 'UPDATE_ROLE', `نقش کاربر ${user.name} به ${ROLE_LABELS[newRole] ?? newRole} تغییر یافت.`);
    revalidatePath('/dashboard/settings/users');
    return { success: true, message: 'نقش کاربر تغییر یافت.' };
  } catch (error) {
    return { success: false, message: 'خطا در تغییر نقش.' };
  }
}

export async function deleteUser(userId: string) {
  if (!(await isAdmin())) return { success: false, message: ADMIN_ONLY };
  try {
    const currentUser = await getCurrentUser();
    if (currentUser?.id === userId) {
        return { success: false, message: 'شما نمی‌توانید حساب خود را حذف کنید.' };
    }

    const deleted = await prisma.user.delete({
      where: { id: userId },
    });
    
    await logActivity(currentUser?.id, 'DELETE_USER', `کاربر ${deleted.name} (${deleted.email}) حذف شد.`);
    
    revalidatePath('/dashboard/settings/users');
    return { success: true, message: 'کاربر حذف شد.' };
  } catch (error) {
    return { success: false, message: 'خطا در حذف کاربر.' };
  }
}

export async function updateProfile(prevState: any, formData: FormData) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return { message: 'کاربر احراز هویت نشده است.' };

  const schema = z.object({
    name: z.string().min(1, 'نام الزامی است'),
    email: z.string().trim().toLowerCase().email('ایمیل نامعتبر است'),
    phone: z.string().optional(),
  });

  const validatedFields = schema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    phone: formData.get('phone'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { name, email, phone } = validatedFields.data;

  try {
    // Check email uniqueness
    const existingUser = await emailTakenByOther(email, currentUser.id);

    if (existingUser) {
      return { message: 'این ایمیل توسط کاربر دیگری استفاده شده است.' };
    }

    await prisma.user.update({
      where: { id: currentUser.id },
      data: { name, email, phone },
    });

    await logActivity(currentUser.id, 'UPDATE_PROFILE', 'پروفایل کاربری بروزرسانی شد.');
    revalidatePath('/dashboard/settings/profile');
    return { message: 'پروفایل با موفقیت بروزرسانی شد.', success: true };
  } catch (error) {
    return { message: 'خطا در بروزرسانی پروفایل.' };
  }
}

export async function changePassword(prevState: any, formData: FormData) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return { message: 'کاربر احراز هویت نشده است.' };

  const schema = z.object({
    currentPassword: z.string().min(1, 'رمز عبور فعلی الزامی است'),
    newPassword: z.string().min(6, 'رمز عبور جدید باید حداقل ۶ کاراکتر باشد'),
    confirmPassword: z.string().min(1, 'تکرار رمز عبور الزامی است'),
  }).refine((data) => data.newPassword === data.confirmPassword, {
    message: "رمز عبور جدید و تکرار آن مطابقت ندارند",
    path: ["confirmPassword"],
  });

  const validatedFields = schema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا خطاها را بررسی کنید.',
    };
  }

  const { currentPassword, newPassword } = validatedFields.data;

  try {
    // Get user with password
    const user = await prisma.user.findUnique({
      where: { id: currentUser.id },
    });

    if (!user) return { message: 'کاربر یافت نشد.' };

    const isValid = await verifyPassword(currentPassword, user.password);
    if (!isValid) {
      return { message: 'رمز عبور فعلی اشتباه است.' };
    }

    const hashedPassword = await hashPassword(newPassword);

    // Every session from before, this one included, ends: signed in anywhere
    // else with the old password, it no longer is.
    await prisma.user.update({
      where: { id: currentUser.id },
      data: { password: hashedPassword, passwordChangedAt: new Date() },
    });

    await logActivity(currentUser.id, 'CHANGE_PASSWORD', 'رمز عبور تغییر یافت.');
    return { message: 'رمز عبور با موفقیت تغییر یافت. با رمز تازه دوباره وارد شوید.', success: true };
  } catch (error) {
    return { message: 'خطا در تغییر رمز عبور.' };
  }
}
