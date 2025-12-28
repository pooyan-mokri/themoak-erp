import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';

export async function POST() {
  try {
    // Check if any admin user exists
    const existingAdmin = await prisma.user.findFirst({
      where: { role: Role.ADMIN }
    });

    if (existingAdmin) {
      return NextResponse.json({
        success: false,
        message: 'Admin user already exists',
      }, { status: 400 });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash('admin123456', 10);

    // Create admin user
    const admin = await prisma.user.create({
      data: {
        email: 'admin@themoak.com',
        name: 'Admin',
        password: hashedPassword,
        role: Role.ADMIN,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Admin user created successfully!',
      credentials: {
        email: 'admin@themoak.com',
        password: 'admin123456',
        warning: '⚠️ IMPORTANT: Change this password after first login!'
      }
    });
  } catch (error) {
    console.error('Error creating admin user:', error);
    return NextResponse.json({
      success: false,
      message: 'Error creating admin user',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
