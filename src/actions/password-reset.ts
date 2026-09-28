'use server';

import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import { headers } from 'next/headers';
import { hashPassword } from '@/lib/auth-utils';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/activity-log';
import { mailSettings, sendMail } from '@/lib/mail';
import { findUserByEmail } from '@/lib/user-email';

const SENT_IF_REGISTERED = 'اگر این ایمیل در سیستم ثبت شده باشد، لینک بازیابی برای شما ارسال خواهد شد.';
const MAIL_NOT_SET_UP = 'ارسال ایمیل بازیابی در این سامانه راه‌اندازی نشده است؛ برای تغییر رمز عبور با مدیر سیستم تماس بگیرید.';
const MAIL_FAILED = 'ایمیل بازیابی ارسال نشد؛ کمی بعد دوباره تلاش کنید یا با مدیر سیستم تماس بگیرید.';

/** The address the ERP was reached at, for the link in the email. */
function appOrigin(): string {
  try {
    const request = headers();
    const host = request.get('x-forwarded-host') ?? request.get('host');
    if (host) return `${request.get('x-forwarded-proto') ?? 'https'}://${host}`;
  } catch {
    // Outside a request (tests): the configured address.
  }
  return new URL(process.env.AUTH_URL || 'http://localhost:3000').origin;
}

/**
 * Request password reset - generates token and sends email
 */
export async function requestPasswordReset(prevState: any, formData: FormData) {
  const schema = z.object({
    email: z.string().trim().email('ایمیل نامعتبر است'),
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

  // Checked before the address is looked up, so the answer never tells whether it is registered.
  // Development without mail shows the link on the page instead.
  const showLinkOnPage = !mailSettings() && process.env.NODE_ENV === 'development';
  if (!mailSettings() && !showLinkOnPage) {
    return { success: false, message: MAIL_NOT_SET_UP };
  }

  try {
    // Find user by email
    const user = await findUserByEmail(email);

    // Always return success message for security (don't reveal if email exists)
    if (!user) {
      return {
        success: true,
        message: SENT_IF_REGISTERED,
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

    if (showLinkOnPage) {
      return { success: true, message: SENT_IF_REGISTERED, token };
    }

    // The link is never logged: whoever reads the logs could take the account.
    const link = `${appOrigin()}/reset-password/${token}`;
    try {
      await sendMail({
        to: user.email,
        subject: 'بازیابی رمز عبور TheMoak ERP',
        text: `${user.name} عزیز،\n\nبرای تعیین رمز عبور جدید این لینک را باز کنید (تا ۲۴ ساعت معتبر است):\n${link}\n\nاگر این درخواست از طرف شما نبوده، این ایمیل را نادیده بگیرید؛ رمز فعلی شما تغییری نمی‌کند.`,
        html: `<div dir="rtl" style="font-family:Tahoma,sans-serif;line-height:1.8"><p>${escapeHtml(user.name)} عزیز،</p><p>برای تعیین رمز عبور جدید این لینک را باز کنید (تا ۲۴ ساعت معتبر است):</p><p><a href="${link}">${link}</a></p><p>اگر این درخواست از طرف شما نبوده، این ایمیل را نادیده بگیرید؛ رمز فعلی شما تغییری نمی‌کند.</p></div>`,
      });
    } catch (error) {
      console.error('[Password reset] the email was not sent:', error);
      // Nobody received it, so it must not stay usable.
      await prisma.passwordResetToken.update({ where: { token }, data: { used: true } });
      return { success: false, message: MAIL_FAILED };
    }

    return {
      success: true,
      message: SENT_IF_REGISTERED,
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
    // Hash new password
    const hashedPassword = await hashPassword(password);

    // Claim the token and change the password together: a link used twice at
    // once, or one that expired meanwhile, changes nothing.
    const userId = await prisma.$transaction(async (tx: any) => {
      const { count } = await tx.passwordResetToken.updateMany({
        where: { token, used: false, expiresAt: { gt: new Date() } },
        data: { used: true },
      });
      if (count === 0) return null;
      const resetToken = await tx.passwordResetToken.findUniqueOrThrow({ where: { token }, select: { userId: true } });
      await tx.user.update({
        where: { id: resetToken.userId },
        data: { password: hashedPassword },
      });
      return resetToken.userId as string;
    });

    if (!userId) {
      return {
        success: false,
        message: 'لینک بازیابی نامعتبر یا منقضی شده است.',
      };
    }
    await logActivity(userId, 'RESET_PASSWORD', 'رمز عبور با لینک بازیابی تغییر یافت.');

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

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
