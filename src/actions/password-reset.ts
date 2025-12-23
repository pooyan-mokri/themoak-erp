'use server';

import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import { hashPassword } from '@/lib/auth-utils';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';

/**
 * Request password reset - generates token and sends email
 */
export async function requestPasswordReset(prevState: any, formData: FormData) {
  const schema = z.object({
    email: z.string().email('ایمیل نامعتبر است'),
  });

  const validatedFields = schema.safeParse({
    email: formData.get('email'),
  });

  if (!validatedFields.success) {
    return {
      success: false,
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا ایمیل معتبر وارد کنید.',
    };
  }

  const { email } = validatedFields.data;

  try {
    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    // Always return success message for security (don't reveal if email exists)
    if (!user) {
      return {
        success: true,
        message: 'اگر این ایمیل در سیستم ثبت شده باشد، لینک بازیابی برای شما ارسال خواهد شد.',
      };
    }

    // Invalidate any existing tokens for this user
    await prisma.passwordResetToken.updateMany({
      where: {
        userId: user.id,
        used: false,
      },
      data: {
        used: true,
      },
    });

    // Generate secure random token
    const token = randomBytes(32).toString('hex');
    
    // Token expires in 24 hours
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    // Create reset token
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      },
    });

    // TODO: Send email with reset link
    // For now, we'll log the token (in production, send via email)
    console.log('Password reset token:', token);
    console.log('Reset link:', `http://localhost:3000/reset-password/${token}`);

    return {
      success: true,
      message: 'اگر این ایمیل در سیستم ثبت شده باشد، لینک بازیابی برای شما ارسال خواهد شد.',
      // In development, include token for testing
      ...(process.env.NODE_ENV === 'development' && { token }),
    };
  } catch (error) {
    console.error('Error requesting password reset:', error);
    return {
      success: false,
      message: 'خطا در پردازش درخواست. لطفا دوباره تلاش کنید.',
    };
  }
}

/**
 * Verify reset token validity
 */
export async function verifyResetToken(token: string) {
  try {
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!resetToken) {
      return { valid: false, message: 'لینک بازیابی نامعتبر است.' };
    }

    if (resetToken.used) {
      return { valid: false, message: 'این لینک قبلاً استفاده شده است.' };
    }

    if (new Date() > resetToken.expiresAt) {
      return { valid: false, message: 'لینک بازیابی منقضی شده است.' };
    }

    return {
      valid: true,
      email: resetToken.user.email,
    };
  } catch (error) {
    console.error('Error verifying reset token:', error);
    return { valid: false, message: 'خطا در بررسی لینک بازیابی.' };
  }
}

/**
 * Reset password using token
 */
export async function resetPassword(token: string, prevState: any, formData: FormData) {
  const schema = z.object({
    password: z.string().min(6, 'رمز عبور باید حداقل ۶ کاراکتر باشد'),
    confirmPassword: z.string().min(1, 'تکرار رمز عبور الزامی است'),
  }).refine((data) => data.password === data.confirmPassword, {
    message: 'رمز عبور و تکرار آن مطابقت ندارند',
    path: ['confirmPassword'],
  });

  const validatedFields = schema.safeParse({
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!validatedFields.success) {
    return {
      success: false,
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا خطاها را بررسی کنید.',
    };
  }

  const { password } = validatedFields.data;

  try {
    // Verify token
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!resetToken || resetToken.used || new Date() > resetToken.expiresAt) {
      return {
        success: false,
        message: 'لینک بازیابی نامعتبر یا منقضی شده است.',
      };
    }

    // Hash new password
    const hashedPassword = await hashPassword(password);

    // Update user password
    await prisma.user.update({
      where: { id: resetToken.userId },
      data: { password: hashedPassword },
    });

    // Mark token as used
    await prisma.passwordResetToken.update({
      where: { token },
      data: { used: true },
    });

    return {
      success: true,
      message: 'رمز عبور با موفقیت تغییر یافت. اکنون می‌توانید وارد شوید.',
    };
  } catch (error) {
    console.error('Error resetting password:', error);
    return {
      success: false,
      message: 'خطا در تغییر رمز عبور. لطفا دوباره تلاش کنید.',
    };
  }
}
